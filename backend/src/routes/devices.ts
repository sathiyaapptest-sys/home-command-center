import { Router } from 'express';
import { CommandEngine } from '../engine/commandEngine';
import { TelemetryEngine } from '../engine/telemetryEngine';
import { DeviceType, ScheduleRule } from '../types';

export function devicesRouter(engine: TelemetryEngine, commandEngine: CommandEngine): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(engine.listDevices());
  });

  router.get('/:id', (req, res) => {
    const device = engine.getDevice(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
  });

  router.post('/register', (req, res) => {
    const { name, vendor, type, ratedWattage, schedule } = req.body as {
      name?: string;
      vendor?: string;
      type?: DeviceType;
      ratedWattage?: number;
      schedule?: ScheduleRule;
    };
    if (!name || !vendor || !type || typeof ratedWattage !== 'number') {
      return res.status(400).json({ error: 'name, vendor, type, ratedWattage are required' });
    }
    const device = engine.registerDevice({ name, vendor, type, ratedWattage, schedule });
    res.status(201).json(device);
  });

  router.post('/:id/power', (req, res) => {
    const { power } = req.body as { power?: 'on' | 'off' };
    if (power !== 'on' && power !== 'off') {
      return res.status(400).json({ error: 'power must be "on" or "off"' });
    }
    try {
      res.json(engine.setPower(req.params.id, power));
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/run-for', (req, res) => {
    const { minutes } = req.body as { minutes?: number };
    if (typeof minutes !== 'number' || minutes <= 0) {
      return res.status(400).json({ error: 'minutes must be a positive number' });
    }
    try {
      res.status(201).json(commandEngine.runForDuration(req.params.id, minutes));
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  return router;
}
