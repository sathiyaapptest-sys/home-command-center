// Home Command Center motor node (classic ESP32, 30-pin dev board).
//
// - Two Matter on/off plugs (relay and onboard LED): Alexa (Echo) controls them natively, no cloud skill needed.
// - Reports to the Command Center backend every second: relay state plus whether the motor is
//   really turning (MPU6050 vibration), and applies on/off commands from the TV / web app.
//
// Wiring (low voltage only; never connect the relay to mains):
//   Classic ESP32 (30-pin):  MPU6050 SDA->GPIO21, SCL->GPIO22;  relay IN->GPIO26
//   ESP32-S3 (N16R8):        MPU6050 SDA->GPIO6,  SCL->GPIO7;   relay IN->GPIO4 (IN2->GPIO5 later)
//   Both: MPU6050 VCC->3V3, GND->GND, board taped to the motor body;
//         Relay VCC->5V pin, GND->GND; motor on its own 5V supply through COM/NO
//
// Hold the BOOT button for 5 s to forget the Matter pairing (to re-add it in the Alexa app).

#include <HTTPClient.h>
#include <Matter.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>
#include "secrets.h"

// ---- settings you may need to change ----
#define NODE_ID "motor1"
#define NODE_NAME "ESP32 motor"
// Pins differ by chip: on the S3 modules GPIO26-37 are used by the flash and the octal PSRAM
// (N16R8), so the classic board's pins can't be reused there.
#if CONFIG_IDF_TARGET_ESP32S3
#define RELAY_PIN 4
#define I2C_SDA 6
#define I2C_SCL 7
#else
#define RELAY_PIN 26
#define I2C_SDA 21
#define I2C_SCL 22
#endif
// Many single-channel relay modules switch ON when IN is LOW. If the motor runs when the
// dashboard says OFF (and the other way round), change this to false.
#define RELAY_ACTIVE_LOW true
// Vibration (g, standard deviation of acceleration) above which the motor counts as running.
// Watch "vib=" in the Serial Monitor with the motor off and on, and set this between the two.
#define VIBRATION_THRESHOLD 0.02f
// ------------------------------------------

// The board's own LED as a second, wiring-free device ("ESP32 LED" on the dashboard).
// ESP32-S3 dev boards carry an addressable RGB LED on GPIO48 (a few clones use GPIO38: change it here);
// the classic board has a plain LED on GPIO2.
#define LED_NODE_ID "led1"
#define LED_NODE_NAME "ESP32 LED"
#if CONFIG_IDF_TARGET_ESP32S3
#define LED_RGB_PIN 48
#else
#define LED_PIN 2
#endif

#define BOOT_BUTTON 0
#define MPU_ADDR 0x68
#define REPORT_EVERY_MS 1000

MatterOnOffPlugin plug;     // the relay
MatterOnOffPlugin ledPlug;  // the onboard LED
bool relayOn = false;
bool ledOn = false;
bool mpuOk = false;
float vibration = 0;

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(RELAY_PIN, (on != RELAY_ACTIVE_LOW) ? HIGH : LOW);
}

void setLed(bool on) {
  ledOn = on;
#if CONFIG_IDF_TARGET_ESP32S3
  rgbLedWrite(LED_RGB_PIN, 0, on ? 90 : 0, 0);  // green when on
#else
  digitalWrite(LED_PIN, on ? HIGH : LOW);
#endif
}

// Called when Alexa (or any Matter controller) switches the plug.
bool onMatterChange(bool on) {
  setRelay(on);
  Serial.printf("Matter: relay %s\n", on ? "ON" : "OFF");
  return true;
}

bool onMatterLedChange(bool on) {
  setLed(on);
  Serial.printf("Matter: LED %s\n", on ? "ON" : "OFF");
  return true;
}

bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool mpuReadAccel(float &x, float &y, float &z) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, 6) != 6) return false;
  int16_t raw[3];
  for (int i = 0; i < 3; i++) raw[i] = (Wire.read() << 8) | Wire.read();
  // Default range is +/-2 g: 16384 counts per g.
  x = raw[0] / 16384.0f;
  y = raw[1] / 16384.0f;
  z = raw[2] / 16384.0f;
  return true;
}

// Samples for ~0.5 s and returns how much the acceleration magnitude wobbles (std dev, in g).
float measureVibration() {
  const int samples = 100;
  float sum = 0, sumSq = 0;
  int ok = 0;
  for (int i = 0; i < samples; i++) {
    float x, y, z;
    if (mpuReadAccel(x, y, z)) {
      float m = sqrtf(x * x + y * y + z * z);
      sum += m;
      sumSq += m * m;
      ok++;
    }
    delay(5);
  }
  if (ok < samples / 2) {
    mpuOk = false;
    return 0;
  }
  float mean = sum / ok;
  return sqrtf(fmaxf(0, sumSq / ok - mean * mean));
}

// Sends one device's report; returns the backend's pending command ("on", "off", or "" for none).
String reportNode(const char *id, const char *name, bool on, bool running, float vib, bool sensor, float watts) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.setTimeout(1500);
  http.begin(String(BACKEND_URL) + "/nodes/" + id + "/report");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  char body[240];
  snprintf(body, sizeof(body),
           "{\"name\":\"%s\",\"relayOn\":%s,\"running\":%s,\"vibration\":%.4f,\"sensor\":%s,\"ratedWattage\":%.1f}", name,
           on ? "true" : "false", running ? "true" : "false", vib, sensor ? "true" : "false", watts);
  int code = http.POST(body);
  String reply = code > 0 ? http.getString() : "";
  http.end();
  if (code != 200) {
    Serial.printf("report failed: HTTP %d %s\n", code, reply.c_str());
    return "";
  }
  if (reply.indexOf("\"desiredPower\":\"on\"") >= 0) return "on";
  if (reply.indexOf("\"desiredPower\":\"off\"") >= 0) return "off";
  return "";
}

void connectWiFi() {
  Serial.printf("Connecting to Wi-Fi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " FAILED (check secrets.h, 2.4 GHz only)");
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);  // always start OFF, for safety
#ifdef LED_PIN
  pinMode(LED_PIN, OUTPUT);
#endif
  setLed(true);  // one green flash at boot shows the LED works
  delay(400);
  setLed(false);
  pinMode(BOOT_BUTTON, INPUT_PULLUP);

  Wire.begin(I2C_SDA, I2C_SCL);
  mpuOk = mpuWrite(0x6B, 0x00);  // wake the MPU6050
  Serial.println(mpuOk ? "MPU6050 found" : "MPU6050 NOT found: check SDA/SCL wiring");

  if (strlen(WIFI_SSID) == 0) {
    Serial.println("WIFI_SSID is empty: fill in secrets.h and upload again.");
  }
  connectWiFi();

  plug.begin(false);
  plug.onChange(onMatterChange);
  ledPlug.begin(false);
  ledPlug.onChange(onMatterLedChange);
  Matter.begin();

  if (!Matter.isDeviceCommissioned()) {
    Serial.println();
    Serial.println("Not paired yet. In the Alexa app: Devices -> + -> Add Device -> Matter,");
    Serial.printf("then enter this code: %s\n", Matter.getManualPairingCode().c_str());
    Serial.printf("or open this QR code: %s\n", Matter.getOnboardingQRCodeUrl().c_str());
  } else {
    Serial.println("Matter: already paired");
  }
}

void loop() {
  static unsigned long lastReport = 0;
  static unsigned long bootPressedAt = 0;

  if (digitalRead(BOOT_BUTTON) == LOW) {
    if (bootPressedAt == 0) bootPressedAt = millis();
    if (millis() - bootPressedAt > 5000) {
      Serial.println("Forgetting Matter pairing...");
      Matter.decommission();
      bootPressedAt = 0;
    }
  } else {
    bootPressedAt = 0;
  }

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    return;
  }

  if (millis() - lastReport < REPORT_EVERY_MS) return;
  lastReport = millis();

  vibration = mpuOk ? measureVibration() : 0;
  // Without a working sensor the motor's state can't be verified, so assume it follows the relay
  // and tell the backend there is no sensor (it then skips the "on but not running" check).
  bool running = mpuOk ? vibration > VIBRATION_THRESHOLD : relayOn;
  String command = reportNode(NODE_ID, NODE_NAME, relayOn, running, vibration, mpuOk, 2.0f);
  Serial.printf("relay=%s vib=%.4f running=%s%s\n", relayOn ? "ON" : "OFF", vibration, running ? "yes" : "no",
                mpuOk ? "" : " (no sensor)");

  // A command from the TV or web app: apply it and tell Matter, so the Alexa app shows the same state.
  if (command.length() > 0) {
    bool on = command == "on";
    if (on != relayOn) {
      setRelay(on);
      plug.setOnOff(on);
      Serial.printf("Backend: relay %s\n", on ? "ON" : "OFF");
    }
  }

  // The onboard LED is its own device: no sensor, so "running" just follows its state.
  String ledCommand = reportNode(LED_NODE_ID, LED_NODE_NAME, ledOn, ledOn, 0, false, 0.2f);
  if (ledCommand.length() > 0) {
    bool on = ledCommand == "on";
    if (on != ledOn) {
      setLed(on);
      ledPlug.setOnOff(on);
      Serial.printf("Backend: LED %s\n", on ? "ON" : "OFF");
    }
  }
}
