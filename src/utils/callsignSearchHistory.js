/**
 * Callsign search history + validation — pure logic for the Callsign Lookup
 * panel (`callsign-search`).
 *
 * History is a most-recent-first list of plain callsign strings, capped at
 * HISTORY_MAX, stored in localStorage under
 * `openhamclock_callsignSearchHistory`; the key is listed in config.js
 * SYNC_KEYS and profiles.js so it server-syncs, profiles, and backs up like
 * the rest of the user state.
 */

export const CALLSIGN_SEARCH_HISTORY_KEY = 'openhamclock_callsignSearchHistory';
export const HISTORY_MAX = 10;

/**
 * Loose search-input validator: uppercase letters/digits with optional
 * portable/prefix slashes (EA8/K1ABC, K1ABC/P). Requires at least one letter
 * and one digit somewhere — the shape every real callsign shares — without
 * trying to encode ITU allocations.
 */
export function isValidCallsignQuery(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim().toUpperCase();
  if (s.length < 3 || s.length > 16) return false;
  if (!/^[A-Z0-9/]+$/.test(s)) return false;
  if (s.startsWith('/') || s.endsWith('/') || s.includes('//')) return false;
  return /[A-Z]/.test(s) && /\d/.test(s);
}

/** Normalize a query for lookup/history: trimmed, uppercased. */
export const normalizeCallsignQuery = (raw) => (typeof raw === 'string' ? raw.trim().toUpperCase() : '');

/**
 * New history list with `call` at the front: dedupes (case-insensitive,
 * moves to front) and caps at HISTORY_MAX. Pure — never mutates the input.
 */
export function pushHistory(list, call) {
  const c = normalizeCallsignQuery(call);
  const arr = (Array.isArray(list) ? list : []).filter((x) => typeof x === 'string');
  if (!c) return arr.slice(0, HISTORY_MAX);
  return [c, ...arr.filter((x) => x.toUpperCase() !== c)].slice(0, HISTORY_MAX);
}

/** Load history from localStorage ([] on absence/corruption). */
export function loadCallsignSearchHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CALLSIGN_SEARCH_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string').slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

/** Persist history (the settings-sync interceptor picks up the write). */
export function saveCallsignSearchHistory(list) {
  try {
    localStorage.setItem(CALLSIGN_SEARCH_HISTORY_KEY, JSON.stringify(list));
  } catch {}
}
