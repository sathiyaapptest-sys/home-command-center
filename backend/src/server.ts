import { existsSync, readFileSync } from 'fs';
import express from 'express';
import { SimClock } from './simulation/clock';
import { TelemetryEngine } from './engine/telemetryEngine';
import { CommandEngine } from './engine/commandEngine';
import { NotesEngine } from './engine/notesEngine';
import { StubTranslator } from './engine/translate';
import { devicesRouter } from './routes/devices';
import { alertsRouter } from './routes/alerts';
import { notesRouter } from './routes/notes';
import { simulateRouter } from './routes/simulate';
import { activityRouter } from './routes/activity';
import { nodesRouter } from './routes/nodes';
import { ActivityLog } from './engine/activityLog';

// Minimal .env loader (this service runs on Node 18, which has no process.loadEnvFile).
// Never overrides variables that are already set.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
// Real time by default, so run time and energy read like real figures. The dashboard's
// fast-forward (POST /simulate/advance) compresses time for demos; SIM_SPEED=60 makes
// 1 real second = 1 simulated minute if you want everything faster.
const SIM_SPEED = process.env.SIM_SPEED ? Number(process.env.SIM_SPEED) : 1;

const clock = new SimClock(SIM_SPEED);
const engine = new TelemetryEngine(clock);
const commandEngine = new CommandEngine(engine, clock);
const notes = new NotesEngine(new StubTranslator());
const activity = new ActivityLog();

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} -> ${res.statusCode}`));
  next();
});

app.use('/devices', devicesRouter(engine, commandEngine));
app.use('/alerts', alertsRouter(engine));
app.use('/notes', notesRouter(notes));
app.use('/simulate', simulateRouter(clock, engine, commandEngine, activity));
app.use('/activity', activityRouter(activity));
app.use('/nodes', nodesRouter(engine, process.env.DEVICE_KEY));

app.get('/health', (_req, res) => res.json({ ok: true, simNow: clock.now() }));

// Background evaluation loop so faults/schedules/timed-runs resolve even
// without a client calling /simulate/advance.
setInterval(() => {
  const alerts = engine.tick();
  commandEngine.evaluate(alerts);
}, 2000);

app.listen(PORT, () => {
  console.log(`Command Center API listening on :${PORT} (sim speed ${SIM_SPEED}x)`);
});
