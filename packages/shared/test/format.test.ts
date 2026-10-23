import { describe, expect, it } from 'vitest';
import { deviceStatus, formatEnergy, formatHours, formatSchedule, summarizeFleet } from '../src/format';
import { Device } from '../src/types';

function device(overrides: Omit<Partial<Device>, 'state'> & { state?: Partial<Device['state']> } = {}): Device {
  const { state, ...rest } = overrides;
  return {
    id: 'd1',
    name: 'Test Plug',
    vendor: 'Test',
    type: 'smart_plug',
    controlledVia: 'alexa',
    ratedWattage: 100,
    state: { power: 'off', responsive: true, wattage: 0, lastChangedAt: 0, turnedOnAt: null, ...state },
    health: { hoursOfOperation: 0, cumulativeEnergyWh: 0, lastAlertAt: null },
    custom: false,
    ...rest,
  };
}

describe('deviceStatus', () => {
  it('reports a switched-on but unresponsive device as a fault', () => {
    expect(deviceStatus(device({ state: { power: 'on', responsive: false } }))).toBe('fault');
  });
  it('reports normal on/off states', () => {
    expect(deviceStatus(device({ state: { power: 'on' } }))).toBe('on');
    expect(deviceStatus(device())).toBe('off');
  });
  it('does not call an off device a fault even if flagged unresponsive', () => {
    expect(deviceStatus(device({ state: { power: 'off', responsive: false } }))).toBe('off');
  });
});

describe('formatters', () => {
  it('formats hours across ranges', () => {
    expect(formatHours(0)).toBe('0 min');
    expect(formatHours(0.5)).toBe('30 min');
    expect(formatHours(2.25)).toBe('2.3 h');
  });
  it('formats energy in Wh and kWh', () => {
    expect(formatEnergy(450)).toBe('450 Wh');
    expect(formatEnergy(1500)).toBe('1.50 kWh');
  });
  it('formats schedule presence and absence', () => {
    expect(formatSchedule(device())).toBe('No schedule');
    expect(formatSchedule(device({ schedule: { onTime: '06:30', offTime: '07:30' } }))).toBe('06:30 - 07:30');
  });
});

describe('summarizeFleet', () => {
  it('counts on, off and fault devices', () => {
    const summary = summarizeFleet([
      device({ state: { power: 'on' } }),
      device({ state: { power: 'on', responsive: false } }),
      device(),
    ]);
    expect(summary).toEqual({ total: 3, on: 1, off: 1, faults: 1 });
  });
});
