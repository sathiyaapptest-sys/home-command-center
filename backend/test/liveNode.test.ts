import { describe, expect, it } from 'vitest';
import { deviceKeyMatches } from '../src/routes/nodes';
import { CommandEngine } from '../src/engine/commandEngine';
import { SimClock } from '../src/simulation/clock';
import { TelemetryEngine } from '../src/engine/telemetryEngine';

// The sim clock is frozen; a separate fake "real" clock drives spin-up and offline timing.
function fresh() {
  const clock = new SimClock(0, 1_700_000_000_000);
  let real = 1_000_000;
  const engine = new TelemetryEngine(clock, () => real);
  const commandEngine = new CommandEngine(engine, clock);
  return {
    clock,
    engine,
    commandEngine,
    wait: (ms: number) => {
      real += ms;
    },
  };
}

const on = { relayOn: true, running: true, vibration: 0.4 };
const off = { relayOn: false, running: false, vibration: 0 };

describe('live ESP32 node', () => {
  it('appears as a live device on its first report', () => {
    const { engine } = fresh();
    engine.reportFromNode('motor1', { ...off, name: 'Water motor' });
    const device = engine.getDevice('node-motor1')!;
    expect(device.source).toBe('live');
    expect(device.name).toBe('Water motor');
    expect(device.live).toMatchObject({ online: true, running: false });
  });

  it('queues on/off commands from the TV or web and clears them once the node confirms', () => {
    const { engine } = fresh();
    engine.reportFromNode('motor1', off);

    engine.setPower('node-motor1', 'on');
    expect(engine.getDevice('node-motor1')!.state.power).toBe('off'); // not on until the node says so
    expect(engine.reportFromNode('motor1', off)).toEqual({ desiredPower: 'on' });
    expect(engine.reportFromNode('motor1', on)).toEqual({ desiredPower: null });
    expect(engine.getDevice('node-motor1')!.state.power).toBe('on');
  });

  it('does not alert while the motor spins up, then alerts once if it is on but not moving', () => {
    const { engine, wait } = fresh();
    engine.reportFromNode('motor1', off);
    engine.reportFromNode('motor1', { relayOn: true, running: false });
    expect(engine.tick()).toEqual([]);

    wait(4_000);
    engine.reportFromNode('motor1', { relayOn: true, running: false });
    engine.reportFromNode('motor1', { relayOn: true, running: false });
    const alerts = engine.getAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].pattern).toBe('stopped_running');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].explanation).toContain('vibration');
    expect(engine.getDevice('node-motor1')!.state.responsive).toBe(false);
  });

  it('raises a new stop alert after the motor recovers and stops again', () => {
    const { engine, wait } = fresh();
    engine.reportFromNode('motor1', off);
    engine.reportFromNode('motor1', on);
    wait(4_000);
    engine.reportFromNode('motor1', { relayOn: true, running: false });
    engine.reportFromNode('motor1', on);
    engine.reportFromNode('motor1', { relayOn: true, running: false });
    expect(engine.getAlerts()).toHaveLength(2);
  });

  it('marks the node offline and alerts when reports stop', () => {
    const { clock, engine, wait } = fresh();
    engine.reportFromNode('motor1', on);
    wait(11_000);
    clock.advance(1_000);
    const alerts = engine.tick();
    expect(alerts.map((a) => a.pattern)).toEqual(['not_responding']);
    expect(engine.getDevice('node-motor1')!.live!.online).toBe(false);
  });

  it('lets a timed run see a real stop and switches the node off at the end', () => {
    const { clock, engine, commandEngine, wait } = fresh();
    engine.reportFromNode('motor1', off);
    const run = commandEngine.runForDuration('node-motor1', 10);
    expect(engine.reportFromNode('motor1', off)).toEqual({ desiredPower: 'on' });
    engine.reportFromNode('motor1', on);

    wait(4_000);
    engine.reportFromNode('motor1', { relayOn: true, running: false });
    clock.advance(60_000);
    commandEngine.evaluate(engine.tick());
    expect(commandEngine.getRun(run.id)!.anomalyDetected).toBe(true);

    clock.advance(10 * 60_000);
    commandEngine.evaluate(engine.tick());
    expect(engine.reportFromNode('motor1', { relayOn: true, running: false })).toEqual({ desiredPower: 'off' });
  });

  it('does not raise a stop alert when the node has no vibration sensor', () => {
    const { engine, wait } = fresh();
    engine.reportFromNode('motor1', { ...off, sensor: false });
    engine.reportFromNode('motor1', { relayOn: true, running: false, sensor: false });
    wait(10_000);
    engine.reportFromNode('motor1', { relayOn: true, running: false, sensor: false });
    expect(engine.getAlerts()).toHaveLength(0);
    expect(engine.getDevice('node-motor1')!.state.responsive).toBe(true);
  });

  it('is removed by a demo reset', () => {
    const { engine } = fresh();
    engine.reportFromNode('motor1', on);
    engine.reset();
    expect(engine.getDevice('node-motor1')).toBeUndefined();
  });
});

describe('device key check', () => {
  it('accepts only the exact key', () => {
    expect(deviceKeyMatches('abc123', 'abc123')).toBe(true);
    expect(deviceKeyMatches('abc124', 'abc123')).toBe(false);
    expect(deviceKeyMatches('abc', 'abc123')).toBe(false);
    expect(deviceKeyMatches(undefined, 'abc123')).toBe(false);
    expect(deviceKeyMatches('abc123', undefined)).toBe(false);
  });
});
