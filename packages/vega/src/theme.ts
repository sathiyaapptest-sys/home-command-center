export const colors = {
  background: '#0B1220',
  panel: '#121A2B',
  panelRaised: '#1A2540',
  text: '#F1F5F9',
  muted: '#94A3B8',
  on: '#22C55E',
  off: '#64748B',
  fault: '#EF4444',
  warning: '#F59E0B',
  focus: '#38BDF8',
};

export const statusColor = {
  on: colors.on,
  off: colors.off,
  fault: colors.fault,
} as const;

export const statusLabel = {
  on: 'ON',
  off: 'OFF',
  fault: 'FAULT',
} as const;
