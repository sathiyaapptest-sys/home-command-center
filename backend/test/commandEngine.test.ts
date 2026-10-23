import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/simulation/clock';
import { TelemetryEngine } from '../src/engine/telemetryEngine';
import { CommandEngine } from '../src/engine/commandEngine';

function fresh() {
  const clock = new SimClock(0, 1_700_000_000_000);
  const engine = new TelemetryEngine(clock);
  const commandEngine = new CommandEngine(engine, clock);
  return { clock, engine, commandEngine };
}

describe('CommandEngine reliable timed run', () => {
  it('turns the device on immediately and off exactly at the requested duration, unlike the unreliable native Alexa command', () => {
    const { clock, engine, commandEngine } = fresh();

    const run = commandEngine.runForDuration('fan-plug', 10);
    expect(engine.getDevice('fan-plug')!.state.power).toBe('on');

    clock.advance(9 * 60_000);
    let alerts = engine.tick();
    commandEngine.evaluate(alerts);
    expect(engine.getDevice('fan-plug')!.state.power).toBe('on');
    expect(commandEngine.getRun(run.id)!.completed).toBe(false);

    clock.advance(1 * 60_000 + 1); // cross the 10-minute mark
    alerts = engine.tick();
    commandEngine.evaluate(alerts);

    expect(engine.getDevice('fan-plug')!.state.power).toBe('off');
    expect(commandEngine.getRun(run.id)!.completed).toBe(true);
    expect(commandEngine.getRun(run.id)!.anomalyDetected).toBe(false);
  });

  it('flags a timed run as anomalyDetected when the device drops out mid-run', () => {
    const { clock, engine, commandEngine } = fresh();

    // pump-plug has a 10-minute drop fault; ask it to run for 20.
    const run = commandEngine.runForDuration('pump-plug', 20);

    clock.advance(11 * 60_000);
    let alerts = engine.tick();
    commandEngine.evaluate(alerts);

    expect(alerts.some((a) => a.deviceId === 'pump-plug')).toBe(true);
    expect(commandEngine.getRun(run.id)!.anomalyDetected).toBe(true);
    expect(commandEngine.getRun(run.id)!.completed).toBe(false); // scheduled off is still 9 min away
  });
});

describe('CommandEngine reset', () => {
  it('drops scheduled runs so nothing switches off after a reset', () => {
    const { clock, engine, commandEngine } = fresh();
    commandEngine.runForDuration('fan-plug', 10);
    commandEngine.reset();
    engine.setPower('fan-plug', 'on');

    clock.advance(11 * 60_000);
    commandEngine.evaluate(engine.tick());

    expect(commandEngine.listRuns()).toHaveLength(0);
    expect(engine.getDevice('fan-plug')!.state.power).toBe('on');
  });
});
