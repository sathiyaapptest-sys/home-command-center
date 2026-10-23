import { v4 as uuid } from 'uuid';
import { SimClock } from '../simulation/clock';
import { Alert, TimedRunResult } from '../types';
import { TelemetryEngine } from './telemetryEngine';

interface PendingRun extends TimedRunResult {
  id: string;
}

/**
 * Fixes pain point #3: Alexa's own "turn off after N minutes" is documented as
 * unreliable (sometimes turns off immediately instead of waiting). This engine
 * schedules against simulated time (evaluated every tick, not a real setTimeout),
 * so it stays correct whether time passes naturally or is fast-forwarded for a
 * demo, and it reports whether the run actually completed or hit an anomaly.
 */
export class CommandEngine {
  private pending = new Map<string, PendingRun>();

  constructor(private engine: TelemetryEngine, private clock: SimClock) {}

  runForDuration(deviceId: string, minutes: number): TimedRunResult {
    if (!this.engine.getDevice(deviceId)) {
      throw new Error(`Unknown device: ${deviceId}`);
    }
    const now = this.clock.now();
    this.engine.setPower(deviceId, 'on');
    const run: PendingRun = {
      id: uuid(),
      deviceId,
      minutes,
      startedAt: now,
      scheduledOffAt: now + minutes * 60_000,
      completed: false,
      anomalyDetected: false,
    };
    this.pending.set(run.id, run);
    return { ...run };
  }

  /** Call once per tick, right after TelemetryEngine.tick(), passing its returned alerts. */
  evaluate(alertsThisTick: Alert[]): void {
    const now = this.clock.now();
    for (const run of this.pending.values()) {
      if (run.completed) continue;

      if (alertsThisTick.some((a) => a.deviceId === run.deviceId)) {
        run.anomalyDetected = true;
      }

      if (now >= run.scheduledOffAt) {
        const device = this.engine.getDevice(run.deviceId);
        if (device && device.state.power === 'on') {
          this.engine.setPower(run.deviceId, 'off');
        }
        run.completed = true;
      }
    }
  }

  /** Drops all scheduled runs, so nothing switches off after a demo reset. */
  reset(): void {
    this.pending.clear();
  }

  listRuns(): TimedRunResult[] {
    return Array.from(this.pending.values());
  }

  getRun(id: string): TimedRunResult | undefined {
    return this.pending.get(id);
  }
}
