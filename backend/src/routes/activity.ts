import { Router } from 'express';
import { ActivityLog, parseActivity } from '../engine/activityLog';

export function activityRouter(log: ActivityLog): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    res.json(log.list(limit));
  });

  router.post('/', (req, res) => {
    const parsed = parseActivity(req.body);
    if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
    res.status(201).json(log.add(parsed));
  });

  return router;
}
