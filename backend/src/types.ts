export type DeviceType = 'smart_plug' | 'smart_bulb' | 'voice_hub' | 'custom';

export interface ScheduleRule {
  onTime: string; // "HH:MM", 24h local time
  offTime: string; // "HH:MM", 24h local time
}

export interface FaultProfile {
  kind: 'drop_after_duration';
  dropAfterMinutes: number;
}

export interface DeviceState {
  power: 'on' | 'off';
  responsive: boolean;
  wattage: number;
  lastChangedAt: number; // sim epoch ms of last on/off transition
  turnedOnAt: number | null; // sim epoch ms of the current ON cycle's start, null if off
}

export interface DeviceHealth {
  hoursOfOperation: number; // cumulative hours the device has reported ON
  cumulativeEnergyWh: number; // watt-hours consumed, cumulative
  lastAlertAt: number | null;
}

export interface Device {
  id: string;
  name: string;
  vendor: string;
  type: DeviceType;
  controlledVia: 'alexa' | 'custom';
  ratedWattage: number; // nominal wattage while on and healthy
  schedule?: ScheduleRule;
  faultProfile?: FaultProfile;
  state: DeviceState;
  health: DeviceHealth;
  custom: boolean; // true if registered via the onboarding API rather than seeded
  /** 'live' = real hardware reporting in (e.g. the ESP32 motor node); otherwise simulated. */
  source?: 'simulated' | 'live';
  live?: LiveStatus;
}

export interface LiveStatus {
  /** Measured by the node itself (vibration), not just what it was told to do. */
  running: boolean;
  vibration: number;
  online: boolean;
  lastReportAt: number;
}

export type AlertPattern = 'drop_after_duration' | 'not_responding' | 'flapping' | 'stopped_running';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: string;
  deviceId: string;
  pattern: AlertPattern;
  severity: AlertSeverity;
  message: string;
  explanation: string;
  createdAt: number; // sim epoch ms
}

export interface TimedRunResult {
  deviceId: string;
  minutes: number;
  startedAt: number;
  scheduledOffAt: number;
  completed: boolean;
  anomalyDetected: boolean;
}

export interface Note {
  id: string;
  languageInput: 'en' | 'ta';
  textOriginal: string;
  textEnglish: string;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
  history: { text: string; at: number }[];
}

export interface ActivityEntry {
  id: string;
  at: number;
  source: 'assistant' | 'alexa';
  language: 'ta' | 'en';
  input: string | null;
  inputEnglish: string | null;
  tool: string | null;
  toolInput: Record<string, unknown> | null;
  reply: string;
  replyEnglish: string | null;
  isError: boolean;
}

export type NewActivity = Omit<ActivityEntry, 'id' | 'at'>;
