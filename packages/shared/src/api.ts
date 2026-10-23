import { ActivityEntry, Alert, Device, NewActivity, Note, TimedRunResult } from './types';

export interface CommandCenterApi {
  getDevices(): Promise<Device[]>;
  getAlerts(): Promise<Alert[]>;
  getNotes(): Promise<Note[]>;
  createNote(languageInput: 'en' | 'ta', text: string): Promise<Note>;
  setPower(deviceId: string, power: 'on' | 'off'): Promise<Device>;
  runFor(deviceId: string, minutes: number): Promise<TimedRunResult>;
  advanceClock(minutes: number): Promise<{ now: number; newAlerts: Alert[] }>;
  resetDemo(): Promise<{ now: number }>;
  getHealth(): Promise<{ ok: boolean; simNow: number }>;
  getActivity(): Promise<ActivityEntry[]>;
  logActivity(entry: NewActivity): Promise<ActivityEntry>;
}

export function createApi(baseUrl: string): CommandCenterApi {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${root}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  return {
    getDevices: () => request<Device[]>('/devices'),
    getAlerts: () => request<Alert[]>('/alerts'),
    getNotes: () => request<Note[]>('/notes'),
    createNote: (languageInput, text) =>
      request<Note>('/notes', { method: 'POST', body: { languageInput, text } }),
    setPower: (deviceId, power) =>
      request<Device>(`/devices/${encodeURIComponent(deviceId)}/power`, { method: 'POST', body: { power } }),
    runFor: (deviceId, minutes) =>
      request<TimedRunResult>(`/devices/${encodeURIComponent(deviceId)}/run-for`, {
        method: 'POST',
        body: { minutes },
      }),
    advanceClock: (minutes) =>
      request<{ now: number; newAlerts: Alert[] }>('/simulate/advance', { method: 'POST', body: { minutes } }),
    resetDemo: () => request<{ now: number }>('/simulate/reset', { method: 'POST', body: {} }),
    getHealth: () => request<{ ok: boolean; simNow: number }>('/health'),
    getActivity: () => request<ActivityEntry[]>('/activity'),
    logActivity: (entry) => request<ActivityEntry>('/activity', { method: 'POST', body: entry }),
  };
}
