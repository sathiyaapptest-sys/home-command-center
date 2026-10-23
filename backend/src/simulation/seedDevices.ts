import { Device } from '../types';

/**
 * Simulated household devices (fictional brands). The pump plug carries a fault profile
 * that reproduces a real failure pattern: it drops out about 10 minutes after every
 * power-on, while the app still believes it is running.
 */
export function seedDevices(now: number): Device[] {
  const baseState = (wattage = 0) => ({
    power: 'off' as const,
    responsive: true,
    wattage,
    lastChangedAt: now,
    turnedOnAt: null,
  });
  const baseHealth = () => ({
    hoursOfOperation: 0,
    cumulativeEnergyWh: 0,
    lastAlertAt: null,
  });

  const devices: Device[] = [
    {
      id: 'hub',
      name: 'Smart Hub',
      vendor: 'Acme',
      type: 'voice_hub',
      controlledVia: 'alexa',
      ratedWattage: 3,
      state: { ...baseState(3), power: 'on', turnedOnAt: now },
      health: baseHealth(),
      custom: false,
    },
    {
      id: 'lamp-plug',
      name: 'Lamp Plug',
      vendor: 'Acme',
      type: 'smart_plug',
      controlledVia: 'alexa',
      ratedWattage: 60,
      state: baseState(),
      health: baseHealth(),
      custom: false,
    },
    {
      id: 'pump-plug',
      name: 'Pump Plug',
      vendor: 'Acme',
      type: 'smart_plug',
      controlledVia: 'alexa',
      ratedWattage: 800,
      faultProfile: { kind: 'drop_after_duration', dropAfterMinutes: 10 },
      state: baseState(),
      health: baseHealth(),
      custom: false,
    },
    {
      id: 'fan-plug',
      name: 'Fan Plug',
      vendor: 'Globex',
      type: 'smart_plug',
      controlledVia: 'alexa',
      ratedWattage: 500,
      state: baseState(),
      health: baseHealth(),
      custom: false,
    },
    {
      id: 'heater-plug',
      name: 'Heater Plug',
      vendor: 'Initech',
      type: 'smart_plug',
      controlledVia: 'alexa',
      ratedWattage: 1000,
      schedule: { onTime: '06:30', offTime: '07:30' },
      state: baseState(),
      health: baseHealth(),
      custom: false,
    },
    {
      id: 'hallway-bulb',
      name: 'Hallway Bulb',
      vendor: 'Hooli',
      type: 'smart_bulb',
      controlledVia: 'alexa',
      ratedWattage: 9,
      schedule: { onTime: '18:30', offTime: '23:00' },
      state: baseState(),
      health: baseHealth(),
      custom: false,
    },
  ];

  return devices;
}
