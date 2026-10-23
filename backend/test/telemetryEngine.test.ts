import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/simulation/clock';
import { TelemetryEngine } from '../src/engine/telemetryEngine';

// speed=0 freezes auto-advance from real time so tests are fully deterministic;
// time only moves via explicit clock.advance() calls.
function freshEngine() {
  const clock = new SimClock(0, 1_700_000_000_000);
  const engine = new TelemetryEngine(clock);
  return { clock, engine };
}

describe('TelemetryEngine anomaly detection', () => {
  it('does not raise an alert before the fault threshold', () => {
    const { clock, engine } = freshEngine();
    engine.setPower('pump-plug', 'on');

    clock.advance(9 * 60_000); // 9 simulated minutes
    const alerts = engine.tick();

    expect(alerts).toHaveLength(0);
    expect(engine.getDevice('pump-plug')!.state.responsive).toBe(true);
  });

  it('raises a drop_after_duration alert once the device has been on past the fault threshold, reproducing the real incident', () => {
    const { clock, engine } = freshEngine();
    engine.setPower('pump-plug', 'on');

    clock.advance(11 * 60_000); // past the 10-minute fault threshold
    const alerts = engine.tick();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].deviceId).toBe('pump-plug');
    expect(alerts[0].pattern).toBe('drop_after_duration');
    expect(alerts[0].severity).toBe('critical');

    const device = engine.getDevice('pump-plug')!;
    expect(device.state.responsive).toBe(false);
    expect(device.state.wattage).toBe(0);
    expect(device.health.lastAlertAt).not.toBeNull();
  });

  it('does not raise the fault for a device with no fault profile even after a long time on', () => {
    const { clock, engine } = freshEngine();
    engine.setPower('lamp-plug', 'on');

    clock.advance(60 * 60_000); // a full simulated hour
    const alerts = engine.tick();

    expect(alerts).toHaveLength(0);
    expect(engine.getDevice('lamp-plug')!.state.responsive).toBe(true);
  });

  it('accumulates hours-of-operation and energy for a device left on', () => {
    const { clock, engine } = freshEngine();
    engine.setPower('hallway-bulb', 'on'); // rated 9W

    clock.advance(60 * 60_000); // 1 simulated hour
    engine.tick();

    const device = engine.getDevice('hallway-bulb')!;
    expect(device.health.hoursOfOperation).toBeCloseTo(1, 5);
    expect(device.health.cumulativeEnergyWh).toBeCloseTo(9, 5);
  });

  it('lets a custom onboarded device be registered and controlled the same way as a seeded one', () => {
    const { engine } = freshEngine();
    const device = engine.registerDevice({
      name: 'Living Room ESP32 Sensor Plug',
      vendor: 'DIY',
      type: 'custom',
      ratedWattage: 40,
    });

    expect(device.custom).toBe(true);
    engine.setPower(device.id, 'on');
    expect(engine.getDevice(device.id)!.state.power).toBe('on');
  });
});

describe('demo reset', () => {
  it('restores the seeded devices and clears alerts and custom devices', () => {
    const { clock, engine } = freshEngine();
    engine.setPower('pump-plug', 'on');
    clock.advance(11 * 60_000);
    engine.tick();
    engine.registerDevice({ name: 'Extra', vendor: 'DIY', type: 'custom', ratedWattage: 5 });
    expect(engine.getAlerts()).toHaveLength(1);

    engine.reset();

    expect(engine.getAlerts()).toHaveLength(0);
    expect(engine.listDevices().map((d) => d.id)).toEqual(['hub', 'lamp-plug', 'pump-plug', 'fan-plug', 'heater-plug', 'hallway-bulb']);
    const plug = engine.getDevice('pump-plug')!;
    expect(plug.state.power).toBe('off');
    expect(plug.state.responsive).toBe(true);
    expect(plug.health.hoursOfOperation).toBe(0);
  });

  it('returns the clock to real time after a fast-forward', () => {
    const { clock } = freshEngine();
    clock.advance(60 * 60_000);
    const before = Date.now();
    const now = clock.reset();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
