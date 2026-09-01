import { beforeEach, describe, expect, it } from 'vitest';

import logbookStore, { __resetLogbookForTests } from '../services/logbookStore.js';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  LAST_BACKUP_KEY,
  NUDGE_DISMISSED_KEY,
  backupFilename,
  buildBackup,
  dismissBackupNudge,
  getLastBackupAt,
  isBackupSettingsKey,
  markBackupDone,
  restoreBackup,
  shouldShowBackupNudge,
  validateBackup,
} from './backup.js';

const qso = (call, overrides = {}) => ({
  call,
  qso_date: '20260810',
  time_on: '120000',
  band: '20m',
  mode: 'SSB',
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  __resetLogbookForTests();
});

describe('isBackupSettingsKey', () => {
  it('includes user-state prefixes', () => {
    expect(isBackupSettingsKey('openhamclock_config')).toBe(true);
    expect(isBackupSettingsKey('openhamclock_profiles')).toBe(true);
    expect(isBackupSettingsKey('ohc_dx_sort')).toBe(true);
  });

  it('excludes browser-private secrets and bookkeeping keys', () => {
    expect(isBackupSettingsKey('ohc-callbook-auth')).toBe(false);
    expect(isBackupSettingsKey('ohc-carto-key')).toBe(false);
    expect(isBackupSettingsKey('ohc_carto_apikey')).toBe(false);
    expect(isBackupSettingsKey('ohc-relay-session')).toBe(false);
    expect(isBackupSettingsKey('ohc-wsjtx-session')).toBe(false);
    expect(isBackupSettingsKey(LAST_BACKUP_KEY)).toBe(false);
    expect(isBackupSettingsKey(NUDGE_DISMISSED_KEY)).toBe(false);
    expect(isBackupSettingsKey('some-other-app-key')).toBe(false);
  });
});

describe('buildBackup', () => {
  it('produces the bundle shape with settings and logbook', async () => {
    localStorage.setItem('openhamclock_config', '{"callsign":"K0CJH"}');
    localStorage.setItem('ohc_dx_sort', 'time');
    localStorage.setItem('ohc-callbook-auth', '{"qrzUsername":"secret"}');
    localStorage.setItem(LAST_BACKUP_KEY, '2026-01-01T00:00:00.000Z');
    await logbookStore.add(qso('W1AW'));

    const bundle = await buildBackup();

    expect(bundle.format).toBe(BACKUP_FORMAT);
    expect(bundle.version).toBe(BACKUP_VERSION);
    expect(typeof bundle.created_at).toBe('string');
    expect(Number.isFinite(Date.parse(bundle.created_at))).toBe(true);
    expect(bundle.settings).toEqual({
      openhamclock_config: '{"callsign":"K0CJH"}',
      ohc_dx_sort: 'time',
    });
    expect(bundle.logbook).toHaveLength(1);
    expect(bundle.logbook[0].call).toBe('W1AW');
    expect(bundle.logbook[0].id).toBeTruthy();
  });

  it('never includes callbook credentials or other secrets', async () => {
    localStorage.setItem('ohc-callbook-auth', 'creds');
    localStorage.setItem('ohc-carto-key', 'key');
    localStorage.setItem('ohc-relay-session', 'sess');
    const bundle = await buildBackup();
    expect(Object.keys(bundle.settings)).toEqual([]);
  });
});

describe('validateBackup', () => {
  it('rejects non-objects and wrong formats', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup([]).ok).toBe(false);
    expect(validateBackup({ format: 'nope', version: 1 }).ok).toBe(false);
  });

  it('rejects unsupported versions and malformed sections', () => {
    expect(validateBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 }).ok).toBe(false);
    expect(validateBackup({ format: BACKUP_FORMAT, version: 0 }).ok).toBe(false);
    expect(validateBackup({ format: BACKUP_FORMAT, version: 1, settings: 'x' }).ok).toBe(false);
    expect(validateBackup({ format: BACKUP_FORMAT, version: 1, logbook: {} }).ok).toBe(false);
  });

  it('accepts a well-formed bundle', () => {
    expect(validateBackup({ format: BACKUP_FORMAT, version: 1, settings: {}, logbook: [] }).ok).toBe(true);
  });
});

describe('restoreBackup', () => {
  it('throws on invalid bundles', async () => {
    await expect(restoreBackup({ format: 'zip' })).rejects.toThrow(/Invalid backup/);
  });

  it('round-trips settings and QSOs and reports counts', async () => {
    localStorage.setItem('openhamclock_config', '{"callsign":"K0CJH"}');
    localStorage.setItem('openhamclock_use12Hour', 'true');
    await logbookStore.add(qso('W1AW'));
    await logbookStore.add(qso('JA1XYZ', { band: '40m' }));
    const bundle = await buildBackup();

    // Simulate a fresh browser
    localStorage.clear();
    __resetLogbookForTests();

    const result = await restoreBackup(bundle);
    expect(result).toEqual({ settingsRestored: 2, imported: 2, skipped: 0 });
    expect(localStorage.getItem('openhamclock_config')).toBe('{"callsign":"K0CJH"}');
    expect(
      logbookStore
        .getAll()
        .map((q) => q.call)
        .sort(),
    ).toEqual(['JA1XYZ', 'W1AW']);
  });

  it('dedups QSOs already in the log (merge default)', async () => {
    await logbookStore.add(qso('W1AW'));
    const bundle = await buildBackup();
    const result = await restoreBackup(bundle);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(logbookStore.getAll()).toHaveLength(1);
  });

  it('merge keeps local keys missing from the bundle; merge:false removes them', async () => {
    const bundle = {
      format: BACKUP_FORMAT,
      version: 1,
      settings: { openhamclock_config: '{"callsign":"AA1A"}' },
      logbook: [qso('AA1A')],
    };

    localStorage.setItem('openhamclock_extra', 'keep-me');
    await logbookStore.add(qso('W1AW'));
    await restoreBackup(bundle, { merge: true });
    expect(localStorage.getItem('openhamclock_extra')).toBe('keep-me');
    expect(logbookStore.getAll()).toHaveLength(2);

    await restoreBackup(bundle, { merge: false });
    expect(localStorage.getItem('openhamclock_extra')).toBe(null);
    expect(logbookStore.getAll().map((q) => q.call)).toEqual(['AA1A']);
  });

  it('refuses to write secret keys from a tampered bundle', async () => {
    localStorage.setItem(LAST_BACKUP_KEY, '2026-08-01T00:00:00.000Z');
    const result = await restoreBackup({
      format: BACKUP_FORMAT,
      version: 1,
      settings: {
        'ohc-callbook-auth': '{"qrzUsername":"evil"}',
        [LAST_BACKUP_KEY]: '1999-01-01T00:00:00.000Z',
        openhamclock_use12Hour: 'false',
      },
      logbook: [],
    });
    expect(result.settingsRestored).toBe(1);
    expect(localStorage.getItem('ohc-callbook-auth')).toBe(null);
    expect(localStorage.getItem(LAST_BACKUP_KEY)).toBe('2026-08-01T00:00:00.000Z');
    expect(localStorage.getItem('openhamclock_use12Hour')).toBe('false');
  });
});

describe('backupFilename', () => {
  it('formats as ohc-backup-YYYYMMDD-HHMMSS.json in UTC', () => {
    expect(backupFilename(new Date('2026-08-28T09:05:07Z'))).toBe('ohc-backup-20260828-090507.json');
    expect(backupFilename()).toMatch(/^ohc-backup-\d{8}-\d{6}\.json$/);
  });
});

describe('backup nudge', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-08-28T00:00:00Z');

  it('needs more than 50 QSOs', () => {
    expect(shouldShowBackupNudge(50, now)).toBe(false);
    expect(shouldShowBackupNudge(51, now)).toBe(true);
  });

  it('is silent within 30 days of a backup, nags after', () => {
    markBackupDone(new Date(now - 29 * DAY));
    expect(shouldShowBackupNudge(100, now)).toBe(false);
    markBackupDone(new Date(now - 31 * DAY));
    expect(shouldShowBackupNudge(100, now)).toBe(true);
  });

  it('stays dismissed for 30 days', () => {
    dismissBackupNudge(new Date(now - 5 * DAY));
    expect(shouldShowBackupNudge(100, now)).toBe(false);
    dismissBackupNudge(new Date(now - 31 * DAY));
    expect(shouldShowBackupNudge(100, now)).toBe(true);
  });

  it('records and reads the last backup timestamp', () => {
    expect(getLastBackupAt()).toBe(null);
    markBackupDone(new Date('2026-08-28T12:00:00Z'));
    expect(getLastBackupAt()).toBe('2026-08-28T12:00:00.000Z');
  });
});
