import { describe, expect, it } from 'vitest';
import { resolveDevice } from '../src/deviceResolver.js';
import { makeDevice } from './helpers.js';

const devices = [
  makeDevice('lamp-plug', 'Lamp Plug', 'Acme'),
  makeDevice('pump-plug', 'Pump Plug', 'Acme'),
  makeDevice('fan-plug', 'Fan Plug', 'Globex'),
  makeDevice('heater-plug', 'Heater Plug', 'Initech'),
  makeDevice('hallway-bulb', 'Hallway Bulb', 'Hooli'),
];

const name = (query: string) => {
  const r = resolveDevice(devices, query);
  return r.kind === 'found' ? r.device.name : r.kind;
};

describe('resolveDevice', () => {
  it('matches loose spoken names', () => {
    expect(name('pump plug')).toBe('Pump Plug');
    expect(name('the heater plug')).toBe('Heater Plug');
    expect(name('my hallway bulb')).toBe('Hallway Bulb');
    expect(name('globex')).toBe('Fan Plug');
  });

  it('matches ids and exact names', () => {
    expect(name('lamp-plug')).toBe('Lamp Plug');
    expect(name('Lamp Plug')).toBe('Lamp Plug');
  });

  it('asks which one when a name is ambiguous', () => {
    const r = resolveDevice(devices, 'plug');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.matches).toHaveLength(4);
  });

  it('falls back to the vendor only when no name matches', () => {
    expect(name('hooli')).toBe('Hallway Bulb');
    expect(name('toaster')).toBe('none');
    expect(name('   ')).toBe('none');
  });
});
