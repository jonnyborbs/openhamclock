/**
 * contestSession — the Contest layout's session model + session-scoped
 * multiplier math.
 *
 * Session marker: localStorage `openhamclock_contestSession` =
 * { startedAt: ms, name?: string, contestId?: string, sentExchange?: object }.
 * `contestId` selects a contestDefs.js definition (exchange fields + mults);
 * `sentExchange` holds the operator's own sent-side values (my zone / class /
 * section / …) collected once per session. Starting a session only stores the
 * marker; stopping clears it. The logbook itself is never touched — it is the
 * shared native log, the session is just a lens over "QSOs made since
 * startedAt".
 *
 * Multipliers reuse the awards.js resolution rules:
 *   - DXCC entity + CQ zone via cty.dat (defaultResolve); an explicit ADIF
 *     CQZ field wins over the cty zone (same as awards.js)
 *   - States count ONLY when an ADIF STATE field is present (same reasoning
 *     as WAS — a grid can't reliably determine a state)
 *
 * The score is a deliberately generic estimate: QSOs × (entities + zones +
 * states). Real contests each have their own point/mult rules — the UI
 * labels it as an estimate.
 */
import { US_STATES, WAZ_TOTAL, defaultResolve, qsoBand } from './awards.js';
import { qsoTimestampMs } from './contestRate.js';

export const CONTEST_SESSION_KEY = 'openhamclock_contestSession';

/** Load the stored session, or null when none / unparseable. */
export const loadContestSession = () => {
  try {
    const raw = localStorage.getItem(CONTEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.startedAt !== 'number' || !Number.isFinite(parsed.startedAt)) return null;
    return {
      startedAt: parsed.startedAt,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      contestId: typeof parsed.contestId === 'string' && parsed.contestId ? parsed.contestId : 'generic-dx',
      sentExchange:
        parsed.sentExchange && typeof parsed.sentExchange === 'object' && !Array.isArray(parsed.sentExchange)
          ? parsed.sentExchange
          : {},
    };
  } catch {
    return null;
  }
};

const persistSession = (session) => {
  try {
    localStorage.setItem(CONTEST_SESSION_KEY, JSON.stringify(session));
  } catch {}
  return session;
};

/** Start a session now (or at an explicit timestamp). Returns the session. */
export const startContestSession = (
  name = '',
  startedAt = Date.now(),
  { contestId = 'generic-dx', sentExchange = {} } = {},
) =>
  persistSession({
    startedAt,
    name: String(name || '').trim(),
    contestId: String(contestId || 'generic-dx'),
    sentExchange: sentExchange && typeof sentExchange === 'object' ? { ...sentExchange } : {},
  });

/**
 * Patch the running session (contest switch, sent-exchange edits).
 * Returns the updated session, or null when no session is stored.
 */
export const updateContestSession = (patch) => {
  const current = loadContestSession();
  if (!current) return null;
  return persistSession({ ...current, ...patch });
};

/** Stop the session — clears the marker only; the logbook keeps every QSO. */
export const clearContestSession = () => {
  try {
    localStorage.removeItem(CONTEST_SESSION_KEY);
  } catch {}
};

/** QSOs logged at/after startedAt (records without a parseable time drop out). */
export const sessionQsos = (qsos, startedAt) => {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return [];
  return (Array.isArray(qsos) ? qsos : []).filter((q) => {
    const t = qsoTimestampMs(q);
    return t != null && t >= startedAt;
  });
};

/** CQ zone for a QSO: explicit ADIF CQZ field wins, else the resolved zone. */
const sessionZone = (qso, resolved) => {
  const raw = qso?.extras?.CQZ;
  if (raw != null && raw !== '') {
    const z = parseInt(raw, 10);
    if (Number.isFinite(z) && z >= 1 && z <= WAZ_TOTAL) return z;
  }
  const z = resolved?.cq;
  return Number.isFinite(z) && z >= 1 && z <= WAZ_TOTAL ? z : null;
};

/** US state for a QSO — ADIF STATE field only. */
const sessionState = (qso) => {
  const s = String(qso?.extras?.STATE || '')
    .trim()
    .toUpperCase();
  return US_STATES.has(s) ? s : null;
};

const emptyBandRec = () => ({ qsos: 0, entities: new Set(), zones: new Set(), states: new Set() });

/**
 * Session multiplier summary from logbook QSOs.
 *
 * @param {Array}    qsos full logbook QSO list
 * @param {object}   opts
 * @param {number}   opts.startedAt session start (ms) — QSOs before it are ignored
 * @param {Function} [opts.resolve] call → { entity, dxcc, cq } | null (tests)
 * @returns {{
 *   qsoCount: number,
 *   entities: Map<string, string>,  // dxcc key → display entity name
 *   zones: Set<number>,
 *   states: Set<string>,
 *   perBand: Map<string, { qsos: number, entities: Set, zones: Set, states: Set }>,
 *   multTotal: number,              // entities + zones + states
 *   score: number,                  // qsoCount × multTotal (generic estimate)
 * }}
 */
export const computeSessionMults = (qsos, { startedAt, resolve = defaultResolve } = {}) => {
  const scoped = sessionQsos(qsos, startedAt);
  const entities = new Map();
  const zones = new Set();
  const states = new Set();
  const perBand = new Map();
  let qsoCount = 0;

  for (const q of scoped) {
    if (!q || !q.call) continue;
    qsoCount += 1;
    const band = qsoBand(q);
    let bandRec = null;
    if (band) {
      bandRec = perBand.get(band);
      if (!bandRec) {
        bandRec = emptyBandRec();
        perBand.set(band, bandRec);
      }
      bandRec.qsos += 1;
    }

    // ctyLookup handles compound calls itself — pass the raw call.
    const resolved = resolve(q.call) || null;
    if (resolved?.dxcc) {
      if (!entities.has(resolved.dxcc)) entities.set(resolved.dxcc, resolved.entity || resolved.dxcc);
      if (bandRec) bandRec.entities.add(resolved.dxcc);
    }

    const zone = sessionZone(q, resolved);
    if (zone) {
      zones.add(zone);
      if (bandRec) bandRec.zones.add(zone);
    }

    const st = sessionState(q);
    if (st) {
      states.add(st);
      if (bandRec) bandRec.states.add(st);
    }
  }

  const multTotal = entities.size + zones.size + states.size;
  return { qsoCount, entities, zones, states, perBand, multTotal, score: qsoCount * multTotal };
};

export default {
  CONTEST_SESSION_KEY,
  loadContestSession,
  startContestSession,
  updateContestSession,
  clearContestSession,
  sessionQsos,
  computeSessionMults,
};
