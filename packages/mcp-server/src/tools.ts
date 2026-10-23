import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CommandCenterApi } from '../../shared/src/api.js';
import {
  deviceName,
  deviceStatus,
  formatClock,
  formatEnergy,
  formatHours,
  formatSchedule,
  formatWatts,
  summarizeFleet,
} from '../../shared/src/format.js';
import type { Device } from '../../shared/src/types.js';
import { resolveDevice } from './deviceResolver.js';

export interface ToolActivity {
  tool: string;
  input: Record<string, unknown>;
  text: string;
  isError: boolean;
}

type ToolReply = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (message: string) => ({ content: [{ type: 'text' as const, text: message }] });
const failure = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeDevice(device: Device): string {
  const status = deviceStatus(device);
  if (status === 'fault') return `${device.name} is faulty: it is switched on but not responding`;
  if (status === 'on') return `${device.name} is on, using ${formatWatts(device.state.wattage)}`;
  return `${device.name} is off`;
}

/** Tool replies are written to be read aloud: short sentences, no ids or tables. */
export function createMcpServer(api: CommandCenterApi, onActivity?: (event: ToolActivity) => void): McpServer {
  const server = new McpServer({ name: 'home-command-center', version: '0.1.0' });

  // registerTool, plus a report of every call so the TV can show what Alexa+ did. Tools
  // without an input schema receive only the request context, not arguments.
  const register = ((name: string, config: { inputSchema?: unknown }, handler: (...args: unknown[]) => Promise<ToolReply>) =>
    server.registerTool(name, config as never, (async (...args: unknown[]) => {
      const result = await handler(...args);
      try {
        onActivity?.({
          tool: name,
          input: config.inputSchema ? ((args[0] ?? {}) as Record<string, unknown>) : {},
          text: result.content.map((part) => part.text).join(' '),
          isError: result.isError === true,
        });
      } catch {
        // reporting must never break the tool call
      }
      return result;
    }) as never)) as McpServer['registerTool'];

  async function withDevice(query: string, run: (device: Device, devices: Device[]) => Promise<ReturnType<typeof text>>) {
    const devices = await api.getDevices();
    const resolved = resolveDevice(devices, query);
    if (resolved.kind === 'none') {
      return failure(`I couldn't find a device called ${query}. Your devices are: ${devices.map((d) => d.name).join(', ')}.`);
    }
    if (resolved.kind === 'ambiguous') {
      return failure(`${query} could mean ${resolved.matches.map((d) => d.name).join(' or ')}. Which one do you want?`);
    }
    return run(resolved.device, devices);
  }

  register(
    'list_devices',
    {
      title: 'List devices',
      description:
        'Gives an overview of every smart plug, bulb and hub in the home: how many are on, off or faulty, and which ones need attention.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const devices = await api.getDevices();
      const summary = summarizeFleet(devices);
      const faulty = devices.filter((d) => deviceStatus(d) === 'fault').map((d) => d.name);
      const on = devices.filter((d) => deviceStatus(d) === 'on').map((d) => d.name);
      const parts = [
        `You have ${plural(summary.total, 'device')}: ${summary.on} on, ${summary.off} off and ${plural(summary.faults, 'fault')}.`,
      ];
      if (faulty.length) parts.push(`Needs attention: ${faulty.join(', ')}.`);
      if (on.length) parts.push(`Currently on: ${on.join(', ')}.`);
      return text(parts.join(' '));
    },
  );

  register(
    'get_device_status',
    {
      title: 'Get device status',
      description:
        'Reports one device: whether it is on, off or faulty, its power draw, how long it has run, energy used, and its schedule. Accepts a spoken name such as "pump plug".',
      inputSchema: { device: z.string().describe('The device name as the customer said it, e.g. "heater plug" or "living room bulb".') },
      annotations: { readOnlyHint: true },
    },
    async ({ device }) =>
      withDevice(device, async (d) =>
        text(
          `${describeDevice(d)}. It has run for ${formatHours(d.health.hoursOfOperation)} and used ${formatEnergy(d.health.cumulativeEnergyWh)}. Schedule: ${
            d.schedule ? `on at ${d.schedule.onTime}, off at ${d.schedule.offTime}` : formatSchedule(d).toLowerCase()
          }.`,
        ),
      ),
  );

  register(
    'get_recent_alerts',
    {
      title: 'Get recent alerts',
      description:
        'Lists the latest problems the home monitor detected, such as a plug that stops drawing power shortly after being switched on, with a plain-language explanation of each.',
      inputSchema: { limit: z.number().int().min(1).max(10).optional().describe('How many alerts to read out. Defaults to 3.') },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const [alerts, devices] = await Promise.all([api.getAlerts(), api.getDevices()]);
      if (alerts.length === 0) return text('There are no alerts. All your devices look healthy.');
      const lines = alerts
        .slice(0, limit ?? 3)
        .map((a) => `At ${formatClock(a.createdAt)}, ${deviceName(devices, a)}: ${a.explanation}`);
      return text(`${plural(alerts.length, 'alert')} in total. ${lines.join(' ')}`);
    },
  );

  register(
    'set_device_power',
    {
      title: 'Turn a device on or off',
      description: 'Switches one device on or off.',
      inputSchema: {
        device: z.string().describe('The device name as the customer said it.'),
        power: z.enum(['on', 'off']).describe('Whether to switch the device on or off.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ device, power }) =>
      withDevice(device, async (d) => {
        await api.setPower(d.id, power);
        return text(`Okay, ${d.name} is now ${power}.`);
      }),
  );

  register(
    'run_device_for_duration',
    {
      title: 'Run a device for a set time',
      description:
        'Turns a device on now and reliably turns it off again after the requested number of minutes, for example running a water pump for 10 minutes. Reports a problem if the device fails during the run.',
      inputSchema: {
        device: z.string().describe('The device name as the customer said it, e.g. "motor plug".'),
        minutes: z.number().int().min(1).max(720).describe('How many minutes to keep the device on.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ device, minutes }) =>
      withDevice(device, async (d) => {
        if (deviceStatus(d) === 'fault') {
          return failure(`${d.name} is faulty, so I didn't start it. Check the device first.`);
        }
        await api.runFor(d.id, minutes);
        return text(`Okay, ${d.name} is on and will switch off by itself in ${plural(minutes, 'minute')}.`);
      }),
  );

  register(
    'add_note',
    {
      title: 'Save a note',
      description: 'Saves a short note or plan so it can be shown on the TV dashboard and read back later.',
      inputSchema: { text: z.string().min(1).max(2000).describe('The note to save, in the customer\'s own words.') },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ text: note }) => {
      await api.createNote('en', note);
      return text('Saved. It will show on your dashboard.');
    },
  );

  register(
    'list_notes',
    {
      title: 'Read notes',
      description: 'Reads back the most recent saved notes.',
      inputSchema: { limit: z.number().int().min(1).max(10).optional().describe('How many notes to read. Defaults to 3.') },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const notes = await api.getNotes();
      if (notes.length === 0) return text('You have no saved notes.');
      const lines = notes.slice(0, limit ?? 3).map((n, i) => `${i + 1}. ${n.summary ?? n.textEnglish}`);
      return text(`${plural(notes.length, 'note')}. ${lines.join(' ')}`);
    },
  );

  return server;
}
