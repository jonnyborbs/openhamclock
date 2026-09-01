/**
 * Frequency memories — pure logic for the Frequencies panel (`freq-memories`).
 *
 * A memory is a user-named channel:
 *   { id, label, freq_mhz, mode?, notes? }
 *
 * freq_mhz is always stored in MHz. Stored in localStorage under
 * `openhamclock_freqMemories`; the key is listed in config.js SYNC_KEYS and
 * profiles.js so it server-syncs, profiles, and backs up like the rest of
 * the user state.
 */

export const FREQ_MEMORIES_KEY = 'openhamclock_freqMemories';

/**
 * Parse a user-typed frequency into MHz. Accepts plain numbers ("14.074",
 * "7.2") — always interpreted as MHz, no kHz/Hz magnitude guessing: this is
 * a form field labeled MHz, and 7200 kHz typed as "7200" would otherwise
 * silently become a valid-looking 7.2 GHz channel. Returns a number or null.
 */
export function parseFreqMHz(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 && input < 300000 ? input : null;
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const f = parseFloat(trimmed);
  // 0 < f < 300000 MHz (300 GHz) — covers 2200 m through microwave bands.
  return f > 0 && f < 300000 ? f : null;
}

/** Build a new memory record with a unique id; returns null on bad input. */
export function makeMemory({ label, freq_mhz, mode, notes }) {
  const freq = parseFreqMHz(freq_mhz);
  const name = typeof label === 'string' ? label.trim() : '';
  if (!name || freq == null) return null;
  const memory = {
    id: `fm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: name,
    freq_mhz: freq,
  };
  const m = typeof mode === 'string' ? mode.trim().toUpperCase() : '';
  if (m) memory.mode = m;
  const n = typeof notes === 'string' ? notes.trim() : '';
  if (n) memory.notes = n;
  return memory;
}

/** New list with the memory moved by delta (-1 up, +1 down); clamped, pure. */
export function moveMemory(list, id, delta) {
  const arr = Array.isArray(list) ? [...list] : [];
  const from = arr.findIndex((m) => m?.id === id);
  if (from === -1) return arr;
  const to = Math.max(0, Math.min(arr.length - 1, from + delta));
  if (to === from) return arr;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return arr;
}

/** Display formatting: trim trailing zeros but keep at least 3 decimals. */
export function formatMemoryFreq(freqMHz) {
  if (!Number.isFinite(freqMHz)) return '';
  const s = freqMHz.toFixed(6).replace(/0+$/, '');
  const [int, dec = ''] = s.split('.');
  return `${int}.${dec.padEnd(3, '0')}`;
}

/** Load the memory list from localStorage ([] on absence/corruption). */
export function loadFreqMemories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FREQ_MEMORIES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist the memory list (the settings-sync interceptor picks up the write). */
export function saveFreqMemories(list) {
  try {
    localStorage.setItem(FREQ_MEMORIES_KEY, JSON.stringify(list));
  } catch {}
}
