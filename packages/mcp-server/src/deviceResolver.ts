import type { Device } from '../../shared/src/types.js';

export type Resolution =
  | { kind: 'found'; device: Device }
  | { kind: 'ambiguous'; matches: Device[] }
  | { kind: 'none' };

const FILLER = new Set(['the', 'a', 'an', 'my', 'smart', 'please']);

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Voice requests name devices loosely ("the pump plug"), so match on words rather than
 * ids. Names are tried first; vendors are only consulted if no name matches, so "pump
 * plug" finds the Pump Plug rather than every device from the same vendor.
 */
export function resolveDevice(devices: Device[], query: string): Resolution {
  const q = normalize(query);
  if (!q) return { kind: 'none' };

  const exact = devices.find((d) => normalize(d.id) === q || normalize(d.name) === q);
  if (exact) return { kind: 'found', device: exact };

  const words = q.split(' ').filter((w) => !FILLER.has(w));
  if (words.length === 0) return { kind: 'none' };

  for (const haystack of [(d: Device) => `${d.name} ${d.id}`, (d: Device) => `${d.name} ${d.id} ${d.vendor}`]) {
    const matches = devices.filter((d) => {
      const text = normalize(haystack(d));
      return words.every((w) => text.includes(w));
    });
    if (matches.length === 1) return { kind: 'found', device: matches[0] };
    if (matches.length > 1) return { kind: 'ambiguous', matches };
  }
  return { kind: 'none' };
}
