// Copy to secrets.h (gitignored) and fill in. Never commit secrets.h.
#pragma once

// Your home Wi-Fi (2.4 GHz: the classic ESP32 has no 5 GHz radio).
#define WIFI_SSID ""
#define WIFI_PASSWORD ""

// The Mac running the backend, on your home network.
#define BACKEND_URL "http://192.168.1.x:4000"

// Must match DEVICE_KEY in backend/.env.
#define DEVICE_KEY ""
