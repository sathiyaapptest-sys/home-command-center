// Mirrors backend/src/types.ts — the wire format of the Command Center API.
export type DeviceType = 'smart_plug' | 'smart_bulb' | 'voice_hub' | 'custom';

export interface ScheduleRule {
  onTime: string;
  offTime: string;
}

export interface DeviceState {
  power: 'on' | 'off';
  responsive: boolean;
  wattage: number;
  lastChangedAt: number;
  turnedOnAt: number | null;
}

export interface DeviceHealth {
  hoursOfOperation: number;
  cumulativeEnergyWh: number;
  lastAlertAt: number | null;
}

export interface Device {
  id: string;
  name: string;
  vendor: string;
  type: DeviceType;
  controlledVia: 'alexa' | 'custom';
  ratedWattage: number;
  schedule?: ScheduleRule;
  state: DeviceState;
  health: DeviceHealth;
  custom: boolean;
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

export interface Alert {
  id: string;
  deviceId: string;
  pattern: 'drop_after_duration' | 'not_responding' | 'flapping' | 'stopped_running';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  explanation: string;
  createdAt: number;
}

export interface Note {
  id: string;
  languageInput: 'en' | 'ta';
  textOriginal: string;
  textEnglish: string;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TimedRunResult {
  deviceId: string;
  minutes: number;
  startedAt: number;
  scheduledOffAt: number;
  completed: boolean;
  anomalyDetected: boolean;
}

/** One request handled by the voice/text assistant or by Alexa+, shown on the TV. */
export interface ActivityEntry {
  id: string;
  at: number;
  source: 'assistant' | 'alexa';
  language: 'ta' | 'en';
  /** What the person said. Null for Alexa+: the MCP server never receives the utterance itself. */
  input: string | null;
  inputEnglish: string | null;
  tool: string | null;
  toolInput: Record<string, unknown> | null;
  reply: string;
  replyEnglish: string | null;
  isError: boolean;
}

export type NewActivity = Omit<ActivityEntry, 'id' | 'at'>;
