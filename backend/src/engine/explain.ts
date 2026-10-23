import { Alert, Device } from '../types';

/**
 * Turns a raw alert into a plain-language explanation. Swap the body of this
 * function for a Bedrock call (see PROJECT_NOTES.md / plan Week 3) — kept as a
 * pluggable single function so that swap doesn't touch the detection logic.
 */
export function explainAlert(device: Device, pattern: Alert['pattern']): string {
  switch (pattern) {
    case 'drop_after_duration':
      return `${device.name} stopped drawing power ${device.faultProfile?.kind === 'drop_after_duration' ? device.faultProfile.dropAfterMinutes : '?'} minutes after being turned on — the same pattern seen before on a damaged plug. Worth checking the plug and whatever is connected to it before it fails completely.`;
    case 'not_responding':
      return `${device.name} stopped responding while it was supposed to be on. It may have lost power, lost Wi-Fi, or failed silently.`;
    case 'stopped_running':
      return `${device.name} is switched on but has stopped running: its vibration sensor detects no movement. The motor may be jammed or disconnected, or its power supply has failed.`;
    case 'flapping':
      return `${device.name} is rapidly switching on and off. This can indicate a wiring fault, an overloaded circuit, or a failing relay inside the plug.`;
    default:
      return `${device.name} reported an unrecognized fault pattern.`;
  }
}
