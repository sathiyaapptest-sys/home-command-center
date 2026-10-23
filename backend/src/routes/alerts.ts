import { Router } from 'express';
import { TelemetryEngine } from '../engine/telemetryEngine';

export function alertsRouter(engine: TelemetryEngine): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(engine.getAlerts());
  });

  return router;
}
