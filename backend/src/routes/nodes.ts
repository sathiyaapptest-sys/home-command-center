import { timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { TelemetryEngine } from '../engine/telemetryEngine';

const NODE_ID = /^[A-Za-z0-9-]{1,40}$/;

/** True if the presented key matches; constant-time so the key can't be guessed byte by byte. */
export function deviceKeyMatches(presented: unknown, expected: string | undefined): boolean {
  if (!expected || typeof presented !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Endpoint for real hardware. Requires the shared device key, so other devices on the network can't fake readings. */
export function nodesRouter(engine: TelemetryEngine, deviceKey: string | undefined): Router {
  const router = Router();

  router.post('/:id/report', (req, res) => {
    if (!deviceKey) return res.status(503).json({ error: 'DEVICE_KEY is not configured on the backend' });
    if (!deviceKeyMatches(req.headers['x-device-key'], deviceKey)) return res.status(401).json({ error: 'bad device key' });
    if (!NODE_ID.test(req.params.id)) return res.status(400).json({ error: 'invalid node id' });

    const { name, relayOn, running, vibration, ratedWattage, sensor } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof relayOn !== 'boolean' || typeof running !== 'boolean') {
      return res.status(400).json({ error: 'relayOn and running must be booleans' });
    }
    res.json(
      engine.reportFromNode(req.params.id, {
        name: typeof name === 'string' ? name.slice(0, 60) : undefined,
        relayOn,
        running,
        vibration: typeof vibration === 'number' ? vibration : undefined,
        ratedWattage: typeof ratedWattage === 'number' ? ratedWattage : undefined,
        sensor: typeof sensor === 'boolean' ? sensor : undefined,
      }),
    );
  });

  return router;
}
