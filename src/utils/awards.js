/**
 * awards — compute award progress (DXCC, WAZ, WAS, VUCC) from the native
 * logbook, plus the "needed" lookups that let spot panels flag a new one.
 *
 * Resolution strategy (pure client, no per-QSO API calls):
 *   - DXCC entity + CQ zone come from the in-browser cty.dat database
 *     (ctyLookup — thousands of prefixes + exact overrides, loaded once from
 *     /api/cty on startup). Entities are keyed by their cty primary prefix
 *     (e.g. 'K', 'PJ2'). A QSO whose call can't be resolved simply doesn't
 *     count — no guessing.
 *   - CQ zone prefers an explicit ADIF CQZ field (imported logs carry the
 *     zone-exact value for wide entities like K/VE/UA), falling back to the
 *     cty.dat zone for the resolved prefix.
 *   - WAS counts ONLY QSOs with an ADIF STATE field (imports from loggers /
 *     LoTW). A grid square cannot reliably determine a US state, so we don't
 *     pretend it can — the panel says so.
 *   - VUCC counts unique 4-character grids from the `gridsquare` field,
 *     overall and per band.
 *
 * Output shapes are designed for both the Awards panel and the spot-highlight
 * index: every dimension is a Map keyed by its award key with per-band /
 * per-mode Sets, so "worked at all" and "worked on this band" are O(1).
 */
import { ctyLookup, getCtyEntities, isCtyLoaded } from './ctyLookup.js';
import { bandFromFreq, normalizeMode } from './workedBefore.js';

/** The 50 US states counted for WAS (no DC, no territories). */
export const US_STATES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
]);

export const WAZ_TOTAL = 40;
export const WAS_TOTAL = 50;
/** VUCC has no finite universe; 100 grids is the entry award. */
export const VUCC_AWARD_THRESHOLD = 100;
/** Fallback DXCC universe size until cty.dat loads (current entities). */
const DXCC_TOTAL_FALLBACK = 340;

/** Default DXCC/zone resolver — cty.dat when loaded, else null. */
export const defaultResolve = (call) => ctyLookup(call);

/** Number of current DXCC entities (cty.dat list when loaded). */
export const dxccUniverseSize = () => {
  const entities = getCtyEntities();
  return isCtyLoaded() && entities.length > 0 ? entities.length : DXCC_TOTAL_FALLBACK;
};

/** Band key for a logbook QSO: freq (MHz) wins, else an ADIF band tag. */
export const qsoBand = (qso) => {
  let band = bandFromFreq(qso?.freq);
  if (!band && qso?.band) {
    const hint = String(qso.band).trim().toLowerCase();
    if (/^\d+c?m$/.test(hint)) band = hint;
  }
  return band;
};

/** 4-character VUCC grid from a gridsquare field, or null. */
export const vuccGrid = (grid) => {
  const g = String(grid || '')
    .trim()
    .toUpperCase();
  return /^[A-R]{2}[0-9]{2}/.test(g) ? g.slice(0, 4) : null;
};

/** CQ zone for a QSO: explicit ADIF CQZ field wins, else the resolved zone. */
const qsoZone = (qso, resolved) => {
  const raw = qso?.extras?.CQZ;
  if (raw != null && raw !== '') {
    const z = parseInt(raw, 10);
    if (Number.isFinite(z) && z >= 1 && z <= WAZ_TOTAL) return z;
  }
  const z = resolved?.cq;
  return Number.isFinite(z) && z >= 1 && z <= WAZ_TOTAL ? z : null;
};

/** WAS state for a QSO — ADIF STATE field only (see module docs). */
const qsoState = (qso) => {
  const s = String(qso?.extras?.STATE || '')
    .trim()
    .toUpperCase();
  return US_STATES.has(s) ? s : null;
};

const track = (map, key, meta, band, mode) => {
  let rec = map.get(key);
  if (!rec) {
    rec = { ...meta, count: 0, bands: new Set(), modes: new Set(), bandModes: new Set() };
    map.set(key, rec);
  }
  rec.count += 1;
  if (band) rec.bands.add(band);
  if (mode) rec.modes.add(mode);
  if (band && mode) rec.bandModes.add(`${band}|${mode}`);
  return rec;
};

/**
 * Compute all award dimensions from logbook QSOs.
 *
 * @param {Array}    qsos logbook QSO records (see logbookStore)
 * @param {object}   [opts]
 * @param {Function} [opts.resolve] call → { entity, dxcc, cq } | null (tests)
 * @returns {{
 *   totalQsos: number,
 *   dxcc: { worked: Map<string, object>, total: number, unresolved: number },
 *   waz:  { worked: Map<number, object>, total: number },
 *   was:  { worked: Map<string, object>, total: number, qsosWithState: number },
 *   vucc: { worked: Map<string, object>, threshold: number },
 * }}
 */
export const computeAwards = (qsos, { resolve = defaultResolve } = {}) => {
  const dxcc = new Map();
  const waz = new Map();
  const was = new Map();
  const vucc = new Map();
  let unresolved = 0;
  let qsosWithState = 0;
  let totalQsos = 0;

  for (const q of Array.isArray(qsos) ? qsos : []) {
    if (!q || !q.call) continue;
    totalQsos += 1;
    const band = qsoBand(q);
    const mode = normalizeMode(q.mode);

    // ctyLookup handles compound calls itself (PJ2/W9WI → PJ2), so pass the
    // raw call — extractBaseCall would strip the operating-entity prefix.
    const resolved = resolve(q.call) || null;
    if (resolved?.dxcc) {
      track(dxcc, resolved.dxcc, { entity: resolved.entity || resolved.dxcc, cont: resolved.cont ?? null }, band, mode);
    } else {
      unresolved += 1;
    }

    const zone = qsoZone(q, resolved);
    if (zone) track(waz, zone, {}, band, mode);

    const st = qsoState(q);
    if (st) {
      qsosWithState += 1;
      track(was, st, {}, band, mode);
    }

    const grid = vuccGrid(q.gridsquare);
    if (grid) track(vucc, grid, {}, band, mode);
  }

  return {
    totalQsos,
    dxcc: { worked: dxcc, total: dxccUniverseSize(), unresolved },
    waz: { worked: waz, total: WAZ_TOTAL },
    was: { worked: was, total: WAS_TOTAL, qsosWithState },
    vucc: { worked: vucc, threshold: VUCC_AWARD_THRESHOLD },
  };
};

/** Per-band summary of a worked Map: { band: countOfKeysWorkedOnBand }. */
export const bandBreakdown = (workedMap) => {
  const out = {};
  for (const rec of workedMap.values()) {
    for (const b of rec.bands) out[b] = (out[b] || 0) + 1;
  }
  return out;
};

/** Per-mode summary of a worked Map: { mode: countOfKeysWorkedOnMode }. */
export const modeBreakdown = (workedMap) => {
  const out = {};
  for (const rec of workedMap.values()) {
    for (const m of rec.modes) out[m] = (out[m] || 0) + 1;
  }
  return out;
};

/** The full key universe for a finite award dimension (null for vucc). */
const universeFor = (dimension) => {
  switch (dimension) {
    case 'dxcc': {
      if (!isCtyLoaded()) return null;
      return getCtyEntities()
        .filter((e) => e?.dxcc)
        .map((e) => e.dxcc);
    }
    case 'waz':
      return Array.from({ length: WAZ_TOTAL }, (_, i) => i + 1);
    case 'was':
      return [...US_STATES];
    default:
      return null; // vucc — open-ended, no needed set
  }
};

/**
 * Needed-set generator: keys of an award dimension NOT yet worked — or, when
 * band and/or mode are given, not yet worked on that band / band+mode.
 *
 * @param {object} awards computeAwards() result
 * @param {'dxcc'|'waz'|'was'|'vucc'} dimension
 * @param {object} [opts] { band, mode }
 * @returns {Set|null} needed keys, or null when the universe is unknown
 *                     (vucc, or dxcc before cty.dat loads)
 */
export const neededSet = (awards, dimension, { band, mode } = {}) => {
  const universe = universeFor(dimension);
  if (!universe) return null;
  const worked = awards?.[dimension]?.worked || new Map();
  const m = normalizeMode(mode);
  const needed = new Set();
  for (const key of universe) {
    const rec = worked.get(key);
    if (!rec) {
      needed.add(key);
      continue;
    }
    if (band && m) {
      if (!rec.bandModes.has(`${band}|${m}`)) needed.add(key);
    } else if (band) {
      if (!rec.bands.has(band)) needed.add(key);
    }
    // No band/mode: worked at all → not needed.
  }
  return needed;
};

/**
 * Award status for a spotted call — the "is this a new one?" check.
 *
 * @param {object}   awards computeAwards() result
 * @param {string}   call   spotted callsign (compound/decorated OK)
 * @param {*}        [freq] spot frequency (MHz, kHz, or Hz)
 * @param {object}   [opts] { resolve } (tests)
 * @returns {'new'|'new-band'|null}
 *   'new'      — the call's DXCC entity is not in the log at all (ATNO)
 *   'new-band' — entity worked, but not on the spot's band
 *   null       — nothing award-worthy, log empty, or entity unresolvable
 */
export const spotAwardStatus = (awards, call, freq, { resolve = defaultResolve } = {}) => {
  if (!awards || awards.totalQsos === 0 || !call) return null;
  // If nothing in the log resolved (cty.dat not loaded when the log was
  // indexed), every spot would look like an ATNO — stay quiet instead.
  if (awards.dxcc.worked.size === 0 && awards.dxcc.unresolved === awards.totalQsos) return null;
  const resolved = resolve(String(call).trim());
  if (!resolved?.dxcc) return null;
  const rec = awards.dxcc.worked.get(resolved.dxcc);
  if (!rec) return 'new';
  const band = bandFromFreq(freq);
  if (band && !rec.bands.has(band)) return 'new-band';
  return null;
};

/**
 * Collapse the award status and the worked-before status into the single
 * badge a spot row shows. Precedence: new > new-band > worked-status
 * ('dupe'/'worked' are already mutually exclusive from lookupWorked).
 *
 * @param {'new'|'new-band'|null} awardStatus
 * @param {'dupe'|'worked'|null}  workedStatus
 * @returns {'new'|'new-band'|'dupe'|'worked'|null}
 */
export const spotBadge = (awardStatus, workedStatus) => {
  if (awardStatus === 'new') return 'new';
  if (awardStatus === 'new-band') return 'new-band';
  return workedStatus || null;
};

export default {
  US_STATES,
  WAZ_TOTAL,
  WAS_TOTAL,
  VUCC_AWARD_THRESHOLD,
  computeAwards,
  bandBreakdown,
  modeBreakdown,
  neededSet,
  spotAwardStatus,
  spotBadge,
  qsoBand,
  vuccGrid,
  dxccUniverseSize,
};
