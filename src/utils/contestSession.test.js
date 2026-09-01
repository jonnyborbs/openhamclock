import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONTEST_SESSION_KEY,
  loadContestSession,
  startContestSession,
  updateContestSession,
  clearContestSession,
  sessionQsos,
  computeSessionMults,
} from './contestSession.js';

const T0 = Date.UTC(2026, 7, 28, 12, 0, 0); // session start

const qso = (call, minsAfterStart, fields = {}) => {
  const d = new Date(T0 + minsAfterStart * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    call,
    qso_date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    time_on: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
    ...fields,
  };
};

// Deterministic resolver — no cty.dat in tests.
const resolve = (call) => {
  const map = {
    W1AW: { dxcc: 'K', entity: 'United States', cq: 5 },
    K5ZD: { dxcc: 'K', entity: 'United States', cq: 4 },
    DL1ABC: { dxcc: 'DL', entity: 'Germany', cq: 14 },
    JA1XYZ: { dxcc: 'JA', entity: 'Japan', cq: 25 },
  };
  return map[call] || null;
};

describe('session marker (localStorage)', () => {
  beforeEach(() => localStorage.clear());

  it('start → load → clear round-trip', () => {
    expect(loadContestSession()).toBeNull();
    const s = startContestSession('CQ WW', T0);
    expect(s).toEqual({ startedAt: T0, name: 'CQ WW', contestId: 'generic-dx', sentExchange: {} });
    expect(loadContestSession()).toEqual({ startedAt: T0, name: 'CQ WW', contestId: 'generic-dx', sentExchange: {} });
    clearContestSession();
    expect(loadContestSession()).toBeNull();
  });

  it('stores contestId + sentExchange and patches them via updateContestSession', () => {
    startContestSession('CQ WW', T0, { contestId: 'cq-ww', sentExchange: { zone: '5' } });
    expect(loadContestSession()).toEqual({
      startedAt: T0,
      name: 'CQ WW',
      contestId: 'cq-ww',
      sentExchange: { zone: '5' },
    });
    const updated = updateContestSession({ contestId: 'cq-wpx' });
    expect(updated.contestId).toBe('cq-wpx');
    expect(loadContestSession().contestId).toBe('cq-wpx');
    expect(loadContestSession().sentExchange).toEqual({ zone: '5' });
  });

  it('updateContestSession returns null with no stored session', () => {
    expect(updateContestSession({ contestId: 'cq-ww' })).toBeNull();
  });

  it('defaults contestId/sentExchange on legacy stored sessions', () => {
    localStorage.setItem(CONTEST_SESSION_KEY, JSON.stringify({ startedAt: T0, name: 'old' }));
    expect(loadContestSession()).toEqual({ startedAt: T0, name: 'old', contestId: 'generic-dx', sentExchange: {} });
  });

  it('trims the name and defaults it to empty', () => {
    startContestSession('  Field Day  ', T0);
    expect(loadContestSession().name).toBe('Field Day');
    startContestSession(undefined, T0);
    expect(loadContestSession().name).toBe('');
  });

  it('rejects corrupt stored values', () => {
    localStorage.setItem(CONTEST_SESSION_KEY, 'not json');
    expect(loadContestSession()).toBeNull();
    localStorage.setItem(CONTEST_SESSION_KEY, JSON.stringify({ name: 'no start' }));
    expect(loadContestSession()).toBeNull();
  });
});

describe('sessionQsos', () => {
  it('keeps only QSOs at/after startedAt', () => {
    const list = [qso('W1AW', -5), qso('K5ZD', 0), qso('DL1ABC', 10)];
    const scoped = sessionQsos(list, T0);
    expect(scoped.map((q) => q.call)).toEqual(['K5ZD', 'DL1ABC']);
  });

  it('drops records without a parseable timestamp', () => {
    expect(sessionQsos([{ call: 'W1AW' }], T0)).toEqual([]);
  });

  it('returns empty without a valid startedAt', () => {
    expect(sessionQsos([qso('W1AW', 1)], undefined)).toEqual([]);
    expect(sessionQsos([qso('W1AW', 1)], NaN)).toEqual([]);
  });
});

describe('computeSessionMults', () => {
  it('counts unique entities, zones, and states since the start marker', () => {
    const list = [
      qso('W1AW', -30, { freq: 14.2 }), // before session — ignored
      qso('W1AW', 1, { freq: 14.2, extras: { STATE: 'CT' } }),
      qso('K5ZD', 2, { freq: 14.25, extras: { STATE: 'MA' } }),
      qso('DL1ABC', 3, { freq: 14.03 }),
      qso('JA1XYZ', 4, { freq: 21.03 }),
      qso('DL1ABC', 5, { freq: 21.05 }), // same entity/zone again — no new mult
    ];
    const r = computeSessionMults(list, { startedAt: T0, resolve });
    expect(r.qsoCount).toBe(5);
    expect([...r.entities.keys()].sort()).toEqual(['DL', 'JA', 'K']);
    expect(r.entities.get('DL')).toBe('Germany');
    expect([...r.zones].sort((a, b) => a - b)).toEqual([4, 5, 14, 25]);
    expect([...r.states].sort()).toEqual(['CT', 'MA']);
    expect(r.multTotal).toBe(3 + 4 + 2);
    expect(r.score).toBe(5 * 9);
  });

  it('tracks mults per band', () => {
    const list = [
      qso('DL1ABC', 1, { freq: 14.03 }),
      qso('DL1ABC', 2, { freq: 21.05 }),
      qso('JA1XYZ', 3, { freq: 21.03 }),
    ];
    const r = computeSessionMults(list, { startedAt: T0, resolve });
    expect([...r.perBand.keys()].sort()).toEqual(['15m', '20m']);
    expect(r.perBand.get('20m').qsos).toBe(1);
    expect([...r.perBand.get('20m').entities]).toEqual(['DL']);
    expect(r.perBand.get('15m').qsos).toBe(2);
    expect([...r.perBand.get('15m').entities].sort()).toEqual(['DL', 'JA']);
    expect([...r.perBand.get('15m').zones].sort((a, b) => a - b)).toEqual([14, 25]);
  });

  it('uses an explicit ADIF CQZ over the resolved zone', () => {
    const list = [qso('W1AW', 1, { freq: 14.2, extras: { CQZ: '3' } })];
    const r = computeSessionMults(list, { startedAt: T0, resolve });
    expect([...r.zones]).toEqual([3]);
  });

  it('ignores invalid CQZ/STATE values', () => {
    const list = [qso('DL1ABC', 1, { freq: 14.03, extras: { CQZ: '99', STATE: 'ZZ' } })];
    const r = computeSessionMults(list, { startedAt: T0, resolve });
    expect([...r.zones]).toEqual([14]); // falls back to resolved zone
    expect(r.states.size).toBe(0);
  });

  it('unresolvable calls still count as QSOs but add no mults', () => {
    const list = [qso('X9XX', 1, { freq: 14.2 })];
    const r = computeSessionMults(list, { startedAt: T0, resolve });
    expect(r.qsoCount).toBe(1);
    expect(r.multTotal).toBe(0);
    expect(r.score).toBe(0);
  });

  it('band tags cover QSOs without a frequency', () => {
    const list = [qso('DL1ABC', 1, { band: '40M' })];
    const r = computeSessionMults(list, { startedAt: T0, resolve });
    expect([...r.perBand.keys()]).toEqual(['40m']);
  });

  it('empty session', () => {
    const r = computeSessionMults([], { startedAt: T0, resolve });
    expect(r.qsoCount).toBe(0);
    expect(r.multTotal).toBe(0);
    expect(r.score).toBe(0);
    expect(r.perBand.size).toBe(0);
  });
});
