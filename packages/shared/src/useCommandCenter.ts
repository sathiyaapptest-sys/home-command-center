import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandCenterApi } from './api';
import { ActivityEntry, Alert, Device, Note } from './types';

export interface CommandCenterState {
  devices: Device[];
  alerts: Alert[];
  notes: Note[];
  /** Latest assistant / Alexa+ requests, newest first. */
  activity: ActivityEntry[];
  /** Simulation time (epoch ms); jumps forward when the demo fast-forwards. */
  simNow: number | null;
  error: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

/** Polls the Command Center API so alerts raised by the backend appear without a manual refresh. */
export function useCommandCenter(api: CommandCenterApi, pollMs = 2000): CommandCenterState {
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [simNow, setSimNow] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [d, a, n, h, act] = await Promise.all([
        api.getDevices(),
        api.getAlerts(),
        api.getNotes(),
        api.getHealth(),
        api.getActivity(),
      ]);
      if (!mounted.current) return;
      setDevices(d);
      setAlerts(a);
      setNotes(n);
      setSimNow(h.simNow);
      setActivity(act);
      setError(null);
      setLoaded(true);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const timer = setInterval(refresh, pollMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh, pollMs]);

  return { devices, alerts, notes, activity, simNow, error, loaded, refresh };
}
