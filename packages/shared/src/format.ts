import { Alert, Device } from './types';

export type DeviceStatus = 'on' | 'off' | 'fault';

/** A device that is switched on but not responding is a fault, whatever the plug reports. */
export function deviceStatus(device: Device): DeviceStatus {
  if (device.state.power === 'on' && !device.state.responsive) return 'fault';
  return device.state.power;
}

export function formatHours(hours: number): string {
  if (hours < 1 / 60) return '0 min';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}

export function formatEnergy(wattHours: number): string {
  if (wattHours >= 1000) return `${(wattHours / 1000).toFixed(2)} kWh`;
  return `${Math.round(wattHours)} Wh`;
}

export function formatWatts(watts: number): string {
  return `${Math.round(watts)} W`;
}

export function formatSchedule(device: Device): string {
  if (!device.schedule) return 'No schedule';
  return `${device.schedule.onTime} - ${device.schedule.offTime}`;
}

export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface FleetSummary {
  total: number;
  on: number;
  off: number;
  faults: number;
}

export function summarizeFleet(devices: Device[]): FleetSummary {
  const summary: FleetSummary = { total: devices.length, on: 0, off: 0, faults: 0 };
  for (const device of devices) {
    const status = deviceStatus(device);
    if (status === 'fault') summary.faults += 1;
    else if (status === 'on') summary.on += 1;
    else summary.off += 1;
  }
  return summary;
}

export function deviceName(devices: Device[], alert: Alert): string {
  return devices.find((d) => d.id === alert.deviceId)?.name ?? alert.deviceId;
}
