/**
 * Full backup / restore for OpenHamClock.
 *
 * The manual warns that the logbook (and all settings) live only in this
 * browser — this module answers that warning with a one-click bundle:
 *
 *   {
 *     format: 'ohc-backup',
 *     version: 1,
 *     created_at: '2026-08-28T12:34:56.000Z',
 *     settings: { 'openhamclock_config': '<raw localStorage string>', ... },
 *     logbook: [ ...QSO records from logbookStore... ],
 *   }
 *
 * Settings keys follow the same convention as the server settings sync
 * (src/utils/config.js): `openhamclock_*` and `ohc_*` (underscore) are user
 * state; `ohc-*` (dash) keys are browser-private secrets (callbook
 * credentials, CARTO key, relay sessions) and are deliberately NEVER put in
 * a backup file — a backup may be shared or stored somewhere less private
 * than this browser.
 */

import logbookStore from '../services/logbookStore.js';

export const BACKUP_FORMAT = 'ohc-backup';
export const BACKUP_VERSION = 1;

/** Timestamp of the last backup exported from this browser (ISO string). */
export const LAST_BACKUP_KEY = 'openhamclock_lastBackupAt';
/** Timestamp of the last time the user dismissed the backup reminder. */
export const NUDGE_DISMISSED_KEY = 'openhamclock_backupNudgeDismissedAt';

const INCLUDED_PREFIXES = ['openhamclock_', 'ohc_'];

// Keys that must never travel in a backup file, even if prefixed like user
// state. Everything `ohc-` (dash) prefixed is excluded by the prefix rule
// already; these cover legacy/bookkeeping stragglers.
const EXCLUDED_KEYS = new Set([
  'ohc-callbook-auth', // QRZ / HamQTH credentials — browser-private by design
  'ohc-logsync-auth', // Wavelog/QRZ Logbook/LoTW sync credentials — browser-private
  'ohc-logsync-queue', // pending log-sync pushes — transient, browser-local bookkeeping
  'ohc-carto-key', // CARTO basemap API key
  'ohc_carto_apikey', // legacy (underscore) location of the CARTO key
  'ohc-relay-session', // Rig Bridge cloud relay session
  'ohc-relay-configured',
  'ohc-wsjtx-session',
  LAST_BACKUP_KEY, // restoring must not rewind this browser's backup reminder
  NUDGE_DISMISSED_KEY,
]);

/** True when a localStorage key belongs in (and may be restored from) a backup. */
export const isBackupSettingsKey = (key) =>
  typeof key === 'string' && !EXCLUDED_KEYS.has(key) && INCLUDED_PREFIXES.some((p) => key.startsWith(p));

/**
 * Build the full backup bundle: every user-state localStorage key (including
 * saved profiles) plus the entire native logbook.
 */
export async function buildBackup() {
  await logbookStore.init();
  const settings = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!isBackupSettingsKey(key)) continue;
      const val = localStorage.getItem(key);
      if (val !== null) settings[key] = val;
    }
  } catch {
    // localStorage unavailable (private mode) — export whatever we have
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    settings,
    logbook: logbookStore.getAll().map((q) => ({ ...q })),
  };
}

/**
 * Validate a parsed backup bundle.
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateBackup(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { ok: false, error: 'not an object' };
  }
  if (bundle.format !== BACKUP_FORMAT) return { ok: false, error: 'unrecognized format' };
  if (!Number.isInteger(bundle.version) || bundle.version < 1 || bundle.version > BACKUP_VERSION) {
    return { ok: false, error: `unsupported version ${bundle.version}` };
  }
  if (bundle.settings != null && (typeof bundle.settings !== 'object' || Array.isArray(bundle.settings))) {
    return { ok: false, error: 'settings is not an object' };
  }
  if (bundle.logbook != null && !Array.isArray(bundle.logbook)) {
    return { ok: false, error: 'logbook is not an array' };
  }
  return { ok: true };
}

/**
 * Restore a backup bundle.
 *
 * Settings: every valid key in the bundle overwrites the local value. With
 * `merge: false`, local user-state keys missing from the bundle are removed
 * first (exact snapshot restore); with `merge: true` (default) they are kept.
 * Secret keys (see EXCLUDED_KEYS / `ohc-` prefix) are never written even if a
 * tampered bundle contains them.
 *
 * Logbook: QSOs are imported through logbookStore.addMany, which skips
 * duplicates (call + date + minute + band). With `merge: false` the existing
 * log is cleared first.
 *
 * The caller should reload the page afterwards so React state picks up the
 * restored settings.
 *
 * @returns {Promise<{ settingsRestored: number, imported: number, skipped: number }>}
 */
export async function restoreBackup(bundle, { merge = true } = {}) {
  const { ok, error } = validateBackup(bundle);
  if (!ok) throw new Error(`Invalid backup: ${error}`);

  const settings = bundle.settings || {};
  let settingsRestored = 0;
  try {
    if (!merge) {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (isBackupSettingsKey(key) && !(key in settings)) toRemove.push(key);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }
    for (const [key, value] of Object.entries(settings)) {
      if (!isBackupSettingsKey(key) || typeof value !== 'string') continue;
      localStorage.setItem(key, value);
      settingsRestored++;
    }
  } catch {
    // localStorage unavailable — still restore the logbook below
  }

  if (!merge) await logbookStore.clear();
  const { imported, skipped } = await logbookStore.addMany(Array.isArray(bundle.logbook) ? bundle.logbook : []);

  return { settingsRestored, imported, skipped };
}

/** Suggested download filename: ohc-backup-YYYYMMDD-HHMMSS.json (UTC). */
export function backupFilename(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp =
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `ohc-backup-${stamp}.json`;
}

/** Record that a backup was just exported from this browser. */
export function markBackupDone(now = new Date()) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, now.toISOString());
  } catch {}
}

/** ISO timestamp of the last export from this browser, or null. */
export function getLastBackupAt() {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY) || null;
  } catch {
    return null;
  }
}

/** Hide the backup reminder for the next 30 days. */
export function dismissBackupNudge(now = new Date()) {
  try {
    localStorage.setItem(NUDGE_DISMISSED_KEY, now.toISOString());
  } catch {}
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const olderThan30Days = (iso, nowMs) => {
  if (!iso) return true; // never happened → treat as infinitely old
  const t = Date.parse(iso);
  return !Number.isFinite(t) || nowMs - t > THIRTY_DAYS_MS;
};

/**
 * Should the Logbook panel show the "back up your log" reminder?
 * Yes when the log is worth protecting (>50 QSOs), the last full backup is
 * more than 30 days old (or never happened), and the user hasn't dismissed
 * the reminder in the last 30 days.
 */
export function shouldShowBackupNudge(qsoCount, now = Date.now()) {
  if (!(qsoCount > 50)) return false;
  let last = null;
  let dismissed = null;
  try {
    last = localStorage.getItem(LAST_BACKUP_KEY);
    dismissed = localStorage.getItem(NUDGE_DISMISSED_KEY);
  } catch {
    return false;
  }
  return olderThan30Days(last, now) && olderThan30Days(dismissed, now);
}
