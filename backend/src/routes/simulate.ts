import { Router } from 'express';
import { SimClock } from '../simulation/clock';
import { CommandEngine } from '../engine/commandEngine';
import { TelemetryEngine } from '../engine/telemetryEngine';
import { ActivityLog } from '../engine/activityLog';

/**
 * Demo/test-only endpoint: fast-forward the simulated clock so a fault that
 * takes 10 simulated minutes to appear can be shown in seconds during a demo,
 * or asserted deterministically in a test, without waiting on real time.
 */
export function simulateRouter(
  clock: SimClock,
  engine: TelemetryEngine,
  commandEngine: CommandEngine,
  activity: ActivityLog,
): Router {
  const router = Router();

  router.post('/advance', (req, res) => {
    const { minutes } = req.body as { minutes?: number };
    if (typeof minutes !== 'number' || minutes <= 0) {
      return res.status(400).json({ error: 'minutes must be a positive number' });
    }
    clock.advance(minutes * 60_000);
    const alerts = engine.tick();
    commandEngine.evaluate(alerts);
    res.json({ now: clock.now(), newAlerts: alerts });
  });

  // Notes are the user's own content, so a demo reset leaves them alone.
  router.post('/reset', (_req, res) => {
    clock.reset();
    engine.reset();
    commandEngine.reset();
    activity.clear();
    res.json({ now: clock.now() });
  });

  return router;
}
