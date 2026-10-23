import { v4 as uuid } from 'uuid';
import { SimClock } from '../simulation/clock';
import { seedDevices } from '../simulation/seedDevices';
import { Alert, AlertPattern, Device, DeviceType, ScheduleRule } from '../types';
import { explainAlert } from './explain';

/** What a real hardware node (the ESP32 motor controller) reports every second. */
export interface NodeReport {
  name?: string;
  /** What the relay is actually doing. */
  relayOn: boolean;
  /** Whether the motor is really turning, measured by the node's vibration sensor. */
  running: boolean;
  vibration?: number;
  ratedWattage?: number;
  /** False when the node has no working vibration sensor: "running" is then only an assumption. */
  sensor?: boolean;
}

// A motor needs a moment to spin up before "on but not vibrating" means anything.
const SPIN_UP_MS = 3_000;
// Nodes report every second; this long without one means it's off the network or unpowered.
const OFFLINE_MS = 10_000;

export interface RegisterDeviceInput {
  name: string;
  vendor: string;
  type: DeviceType;
  ratedWattage: number;
  schedule?: ScheduleRule;
}

/**
 * Owns the simulated device registry, advances device state on each tick,
 * accumulates health metrics, and raises Alerts when a known fault pattern
 * is observed. Single source of truth consumed by the REST API, the MCP
 * server, and (via the REST API) the Fire TV app.
 */
export class TelemetryEngine {
  private devices = new Map<string, Device>();
  private alerts: Alert[] = [];
  private lastEvaluatedAt: number;
  private flapCounts = new Map<string, number>();
  // Live (hardware) devices: commands waiting for the node, alerts raised between ticks,
  // and real-time bookkeeping that must not jump when the demo fast-forwards the sim clock.
  private desired = new Map<string, 'on' | 'off'>();
  private queued: Alert[] = [];
  private stoppedAlerted = new Set<string>();
  private realTurnedOnAt = new Map<string, number>();

  constructor(
    private clock: SimClock,
    private realNow: () => number = Date.now,
  ) {
    this.lastEvaluatedAt = clock.now();
    for (const device of seedDevices(this.lastEvaluatedAt)) {
      this.devices.set(device.id, device);
    }
  }

  /** Back to the seeded starting state: original devices, no alerts. Custom devices are removed. */
  reset(): void {
    const now = this.clock.now();
    this.devices.clear();
    for (const device of seedDevices(now)) this.devices.set(device.id, device);
    this.alerts = [];
    this.flapCounts.clear();
    this.desired.clear();
    this.queued = [];
    this.stoppedAlerted.clear();
    this.realTurnedOnAt.clear();
    this.lastEvaluatedAt = now;
  }

  /**
   * Applies a report from a real node and returns any command waiting for it. The node is the
   * source of truth for its state: commands only take effect once it reports them done.
   */
  reportFromNode(nodeId: string, report: NodeReport): { desiredPower: 'on' | 'off' | null } {
    const id = `node-${nodeId}`;
    const now = this.clock.now();
    const realNow = this.realNow();
    let device = this.devices.get(id);
    if (!device) {
      device = {
        id,
        name: report.name ?? 'ESP32 motor',
        vendor: 'ESP32',
        type: 'custom',
        controlledVia: 'custom',
        ratedWattage: report.ratedWattage ?? 2,
        state: { power: 'off', responsive: true, wattage: 0, lastChangedAt: now, turnedOnAt: null },
        health: { hoursOfOperation: 0, cumulativeEnergyWh: 0, lastAlertAt: null },
        custom: true,
        source: 'live',
      };
      this.devices.set(id, device);
    }
    if (report.name) device.name = report.name;

    const power = report.relayOn ? 'on' : 'off';
    if (device.state.power !== power) {
      device.state.power = power;
      device.state.lastChangedAt = now;
      device.state.turnedOnAt = power === 'on' ? now : null;
      if (power === 'on') this.realTurnedOnAt.set(id, realNow);
      else this.stoppedAlerted.delete(id);
    }
    device.live = { running: report.running, vibration: report.vibration ?? 0, online: true, lastReportAt: realNow };

    const spinningUp = power === 'on' && realNow - (this.realTurnedOnAt.get(id) ?? realNow) < SPIN_UP_MS;
    const stopped = power === 'on' && !report.running && !spinningUp && report.sensor !== false;
    device.state.responsive = !stopped;
    device.state.wattage = power === 'on' && report.running ? device.ratedWattage : 0;
    if (stopped && !this.stoppedAlerted.has(id)) {
      this.stoppedAlerted.add(id);
      this.queued.push(this.raiseAlert(device, 'stopped_running', now));
    }
    if (report.running) this.stoppedAlerted.delete(id);

    if (this.desired.get(id) === power) this.desired.delete(id);
    return { desiredPower: this.desired.get(id) ?? null };
  }

  listDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }

  registerDevice(input: RegisterDeviceInput): Device {
    const now = this.clock.now();
    const device: Device = {
      id: `custom-${uuid()}`,
      name: input.name,
      vendor: input.vendor,
      type: input.type,
      controlledVia: 'custom',
      ratedWattage: input.ratedWattage,
      schedule: input.schedule,
      state: { power: 'off', responsive: true, wattage: 0, lastChangedAt: now, turnedOnAt: null },
      health: { hoursOfOperation: 0, cumulativeEnergyWh: 0, lastAlertAt: null },
      custom: true,
    };
    this.devices.set(device.id, device);
    return device;
  }

  setPower(id: string, power: 'on' | 'off'): Device {
    const device = this.requireDevice(id);
    if (device.source === 'live') {
      // Real hardware: queue the command; the node applies it and its next report confirms.
      this.desired.set(id, power);
      return device;
    }
    const now = this.clock.now();
    if (device.state.power !== power) {
      this.flapCounts.set(id, (this.flapCounts.get(id) ?? 0) + 1);
    }
    device.state.power = power;
    device.state.lastChangedAt = now;
    if (power === 'on') {
      device.state.turnedOnAt = now;
      device.state.responsive = true;
      device.state.wattage = device.ratedWattage;
    } else {
      device.state.turnedOnAt = null;
      device.state.responsive = true;
      device.state.wattage = 0;
    }
    return device;
  }

  getAlerts(): Alert[] {
    return [...this.alerts].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Advance simulated state to "now" and return any newly raised alerts. */
  tick(): Alert[] {
    const now = this.clock.now();
    const elapsedMs = now - this.lastEvaluatedAt;
    // Alerts from node reports since the last tick come first, so timed runs see them too.
    const newAlerts: Alert[] = this.queued.splice(0);
    if (elapsedMs <= 0) return newAlerts;

    for (const device of this.devices.values()) {
      if (device.source === 'live') {
        if (device.live?.online && this.realNow() - device.live.lastReportAt > OFFLINE_MS) {
          device.live.online = false;
          device.live.running = false;
          if (device.state.power === 'on') {
            device.state.responsive = false;
            device.state.wattage = 0;
          }
          newAlerts.push(this.raiseAlert(device, 'not_responding', now));
        }
        if (device.state.power === 'on' && device.state.responsive) {
          const elapsedHours = elapsedMs / 3_600_000;
          device.health.hoursOfOperation += elapsedHours;
          device.health.cumulativeEnergyWh += device.state.wattage * elapsedHours;
        }
        continue;
      }

      this.applySchedule(device, now);

      if (device.state.power === 'on' && device.state.responsive) {
        const elapsedHours = elapsedMs / 3_600_000;
        device.health.hoursOfOperation += elapsedHours;
        device.health.cumulativeEnergyWh += device.state.wattage * elapsedHours;

        if (device.faultProfile?.kind === 'drop_after_duration' && device.state.turnedOnAt !== null) {
          const onForMs = now - device.state.turnedOnAt;
          const thresholdMs = device.faultProfile.dropAfterMinutes * 60_000;
          if (onForMs >= thresholdMs) {
            device.state.responsive = false;
            device.state.wattage = 0;
            newAlerts.push(this.raiseAlert(device, 'drop_after_duration', now));
          }
        }
      }
    }

    this.lastEvaluatedAt = now;
    return newAlerts;
  }

  private applySchedule(device: Device, now: number) {
    if (!device.schedule) return;
    const local = new Date(now);
    const hhmm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
    if (hhmm === device.schedule.onTime && device.state.power !== 'on') {
      this.setPower(device.id, 'on');
    } else if (hhmm === device.schedule.offTime && device.state.power !== 'off') {
      this.setPower(device.id, 'off');
    }
  }

  private raiseAlert(device: Device, pattern: AlertPattern, now: number): Alert {
    const alert: Alert = {
      id: uuid(),
      deviceId: device.id,
      pattern,
      severity: pattern === 'drop_after_duration' || pattern === 'stopped_running' ? 'critical' : 'warning',
      message:
        pattern === 'stopped_running'
          ? `${device.name} is switched on but not running.`
          : `${device.name} went unresponsive while it should have been on.`,
      explanation: explainAlert(device, pattern),
      createdAt: now,
    };
    device.health.lastAlertAt = now;
    this.alerts.push(alert);
    return alert;
  }

  private requireDevice(id: string): Device {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Unknown device: ${id}`);
    return device;
  }
}
