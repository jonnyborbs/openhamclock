/**
 * contestDefs — the data-driven contest registry behind the Contest layout.
 *
 * Each definition describes what a contest's exchange looks like (fields,
 * widths, validation, autofill), how logged values map onto ADIF (CONTEST_ID,
 * STX/SRX serials, STX_STRING/SRX_STRING composites, and the specific fields
 * ADIF defines — CQZ, ITUZ, CLASS, ARRL_SECT, PRECEDENCE, CHECK, STATE,
 * power → RX_PWR), and which multiplier dimension(s) the session tracker
 * counts. The quick-log strip renders the exchange dynamically and the
 * MultTracker computes per-def multipliers — nothing contest-specific lives
 * in the components.
 *
 * Exchange field shape:
 *   { key, label, width, placeholder?,
 *     rst?: true,            // maps to rst_rcvd (sent side defaults 59/599)
 *     serial?: true,         // received serial → SRX (sent side is STX)
 *     core?: 'name'|'tx_pwr',// maps to a core QSO field instead of extras
 *     adif?: 'CQZ',          // received value → extras[adif]
 *     adifNonNumeric?: false,// when set, extras[adif] only for numeric values
 *                            //   (IARU: zone → ITUZ, society → SRX_STRING only)
 *     uppercase?: true,
 *     autofillRcvd?: (ctyResolved) => value,  // populate on callsign entry
 *     validate?: (v) => true | 'hint string',
 *   }
 *
 * Sent-side fields (collected once per session, stored in the session's
 * sentExchange map) use the same shape minus rst/serial, plus:
 *   autofillSent?: (myCtyResolved) => value
 *   sentAdif?: 'MY_CQ_ZONE'   // ADIF my-station field, when one exists
 * `sentFields` may be a function of the user's cty resolution (ARRL DX:
 * W/VE side sends a state, DX side sends power).
 *
 * Multiplier dimensions ('multDimension' — string or array):
 *   dxcc | cqzone | ituz | state | stprov | section | prefix | grid | none
 * ARRL DX resolves its dimension per side via `multFor(myResolved)`.
 * 'none' (Field Day) still lists `trackDimensions` for display, but they
 * don't multiply the score (FD score ≈ QSO points).
 */
import { US_STATES, WAZ_TOTAL, defaultResolve, qsoBand, vuccGrid } from './awards.js';
import { sessionQsos } from './contestSession.js';

// Canadian provinces/territories as exchanged in ARRL DX / NAQP.
export const VE_PROVINCES = new Set(['NB', 'NS', 'QC', 'ON', 'MB', 'SK', 'AB', 'BC', 'NT', 'NL', 'YT', 'PE', 'NU']);

const clean = (v) => String(v ?? '').trim();
const isIntIn = (v, lo, hi) => /^\d+$/.test(v) && +v >= lo && +v <= hi;

// ── Shared validators / fields ──────────────────────────────────────────────

const vRst = (v) => /^\d{2,3}$/.test(clean(v)) || 'RST: 2–3 digits';
const vCqZone = (v) => isIntIn(clean(v), 1, WAZ_TOTAL) || `Zone 1–${WAZ_TOTAL}`;
const vItuZoneOrSoc = (v) => {
  const s = clean(v).toUpperCase();
  if (/^\d+$/.test(s)) return isIntIn(s, 1, 90) || 'ITU zone 1–90';
  return /^[A-Z0-9]{1,8}$/.test(s) || 'Zone number or society';
};
const vSerial = (v) => isIntIn(clean(v), 1, 99999) || 'Serial 1–99999';
const vSection = (v) => (/^[A-Z]{2,4}$/.test(clean(v).toUpperCase()) ? true : 'Section, e.g. CT / STX');
const vFdClass = (v) => (/^\d{1,2}[A-F]$/.test(clean(v).toUpperCase()) ? true : 'Class, e.g. 3A');
const vPrecedence = (v) => (/^[ABQMUS]$/.test(clean(v).toUpperCase()) ? true : 'A B Q M U or S');
const vCheck = (v) => /^\d{2}$/.test(clean(v)) || 'Check: 2 digits';
const vName = (v) => (/^[A-Z]{1,12}$/.test(clean(v).toUpperCase()) ? true : 'Name (letters)');
const vStProv = (v) => {
  const s = clean(v).toUpperCase();
  return US_STATES.has(s) || VE_PROVINCES.has(s) || s === 'DX' ? true : 'State/province (or DX)';
};
const vStatePower = (v) => {
  const s = clean(v).toUpperCase();
  if (US_STATES.has(s) || VE_PROVINCES.has(s)) return true;
  if (/^\d{1,4}$/.test(s) || s === 'KW' || s === 'K') return true;
  return 'W/VE send state — DX send power';
};

const RST_FIELD = { key: 'rst', label: 'RST', width: 48, rst: true, validate: vRst };
const SERIAL_FIELD = { key: 'serial', label: 'Serial', width: 60, serial: true, validate: vSerial, placeholder: '#' };

// ── The registry ────────────────────────────────────────────────────────────

export const CONTEST_DEFS = [
  {
    id: 'generic-dx',
    name: 'General DX (no contest)',
    adifContestId: null,
    exchange: [RST_FIELD],
    multDimension: ['dxcc', 'cqzone', 'state'],
  },
  {
    id: 'cq-ww',
    name: 'CQ WW DX',
    adifContestId: (mode) => (mode === 'SSB' ? 'CQ-WW-SSB' : mode === 'RTTY' ? 'CQ-WW-RTTY' : 'CQ-WW-CW'),
    exchange: [
      RST_FIELD,
      {
        key: 'zone',
        label: 'CQ Zone',
        width: 52,
        adif: 'CQZ',
        validate: vCqZone,
        autofillRcvd: (r) => (Number.isFinite(r?.cq) ? String(r.cq) : ''),
      },
    ],
    sentFields: [
      {
        key: 'zone',
        label: 'My CQ zone',
        width: 52,
        sentAdif: 'MY_CQ_ZONE',
        validate: vCqZone,
        autofillSent: (r) => (Number.isFinite(r?.cq) ? String(r.cq) : ''),
      },
    ],
    multDimension: ['cqzone', 'dxcc'],
  },
  {
    id: 'cq-wpx',
    name: 'CQ WPX',
    adifContestId: (mode) => (mode === 'SSB' ? 'CQ-WPX-SSB' : mode === 'RTTY' ? 'CQ-WPX-RTTY' : 'CQ-WPX-CW'),
    serial: true,
    exchange: [RST_FIELD, SERIAL_FIELD],
    multDimension: 'prefix',
  },
  {
    id: 'arrl-dx',
    name: 'ARRL DX',
    adifContestId: (mode) => (mode === 'SSB' ? 'ARRL-DX-SSB' : 'ARRL-DX-CW'),
    exchange: [
      RST_FIELD,
      {
        key: 'exch',
        label: 'State/Pwr',
        width: 70,
        uppercase: true,
        statePower: true, // smart mapping: state → STATE, power → RX_PWR
        validate: vStatePower,
      },
    ],
    // W/VE stations send RST + state; everyone else sends RST + power.
    sentFields: (myResolved) =>
      isWve(myResolved)
        ? [{ key: 'state', label: 'My state', width: 52, uppercase: true, sentAdif: 'MY_STATE', validate: vStProv }]
        : [
            {
              key: 'power',
              label: 'My pwr (W)',
              width: 60,
              sentCore: 'tx_pwr',
              validate: (v) => /^\d{1,4}$|^KW$/i.test(clean(v)) || 'Power in watts (or KW)',
            },
          ],
    // Mults: W/VE side works DX → DXCC entities; DX side works W/VE → states.
    multFor: (myResolved) => (isWve(myResolved) ? ['dxcc'] : ['stprov']),
    multDimension: ['dxcc'], // fallback when the user's cty is unknown
  },
  {
    id: 'arrl-fd',
    name: 'ARRL Field Day',
    adifContestId: 'ARRL-FIELD-DAY',
    exchange: [
      {
        key: 'class',
        label: 'Class',
        width: 56,
        uppercase: true,
        adif: 'CLASS',
        validate: vFdClass,
        placeholder: '3A',
      },
      { key: 'section', label: 'Section', width: 60, uppercase: true, adif: 'ARRL_SECT', validate: vSection },
    ],
    sentFields: [
      { key: 'class', label: 'My class', width: 56, uppercase: true, validate: vFdClass },
      { key: 'section', label: 'My section', width: 60, uppercase: true, validate: vSection },
    ],
    multDimension: 'none',
    trackDimensions: ['section'],
  },
  {
    id: 'arrl-ss',
    name: 'ARRL Sweepstakes',
    adifContestId: (mode) => (mode === 'SSB' ? 'ARRL-SS-SSB' : 'ARRL-SS-CW'),
    serial: true,
    exchange: [
      SERIAL_FIELD,
      { key: 'prec', label: 'Prec', width: 40, uppercase: true, adif: 'PRECEDENCE', validate: vPrecedence },
      { key: 'check', label: 'Chk', width: 40, adif: 'CHECK', validate: vCheck, placeholder: '72' },
      { key: 'section', label: 'Sect', width: 56, uppercase: true, adif: 'ARRL_SECT', validate: vSection },
    ],
    sentFields: [
      { key: 'prec', label: 'My prec', width: 40, uppercase: true, validate: vPrecedence },
      { key: 'check', label: 'My check', width: 44, validate: vCheck },
      { key: 'section', label: 'My section', width: 56, uppercase: true, validate: vSection },
    ],
    multDimension: 'section',
  },
  {
    id: 'iaru-hf',
    name: 'IARU HF Championship',
    adifContestId: 'IARU-HF',
    exchange: [
      RST_FIELD,
      {
        key: 'zone',
        label: 'ITU/Soc',
        width: 64,
        uppercase: true,
        adif: 'ITUZ',
        adifNumericOnly: true, // society strings land in SRX_STRING only
        validate: vItuZoneOrSoc,
        autofillRcvd: (r) => (Number.isFinite(r?.itu) ? String(r.itu) : ''),
      },
    ],
    sentFields: [
      {
        key: 'zone',
        label: 'My ITU zone',
        width: 52,
        sentAdif: 'MY_ITU_ZONE',
        validate: (v) => isIntIn(clean(v), 1, 90) || 'ITU zone 1–90',
        autofillSent: (r) => (Number.isFinite(r?.itu) ? String(r.itu) : ''),
      },
    ],
    multDimension: 'ituz',
  },
  {
    id: 'naqp',
    name: 'NAQP',
    adifContestId: (mode) => `NAQP-${mode === 'SSB' ? 'SSB' : mode === 'RTTY' ? 'RTTY' : 'CW'}`,
    exchange: [
      { key: 'name', label: 'Name', width: 84, uppercase: true, core: 'name', validate: vName },
      { key: 'qth', label: 'St/Prov', width: 56, uppercase: true, adif: 'STATE', validate: vStProv },
    ],
    sentFields: [
      { key: 'name', label: 'My name', width: 84, uppercase: true, sentAdif: 'MY_NAME', validate: vName },
      { key: 'qth', label: 'My st/prov', width: 56, uppercase: true, sentAdif: 'MY_STATE', validate: vStProv },
    ],
    multDimension: 'stprov',
  },
  {
    id: 'generic-serial',
    name: 'Generic serial contest',
    adifContestId: null,
    serial: true,
    exchange: [RST_FIELD, SERIAL_FIELD],
    multDimension: ['dxcc', 'cqzone', 'state'],
  },
];

export const DEFAULT_CONTEST_ID = 'generic-dx';

const DEF_BY_ID = new Map(CONTEST_DEFS.map((d) => [d.id, d]));

/** Def by id — falls back to the generic (current-behavior) def. */
export const getContestDef = (id) => DEF_BY_ID.get(id) || DEF_BY_ID.get(DEFAULT_CONTEST_ID);

/** True when a cty resolution is US or Canada (ARRL DX "W/VE side"). */
export const isWve = (resolved) => resolved?.dxcc === 'K' || resolved?.dxcc === 'VE';

/** ADIF CONTEST_ID for a def + operating mode (null → no CONTEST_ID). */
export const resolveAdifContestId = (def, mode) => {
  if (!def?.adifContestId) return null;
  if (typeof def.adifContestId === 'function') return def.adifContestId(String(mode || '').toUpperCase());
  return def.adifContestId;
};

/** Sent-side fields for a def (may depend on the user's own cty entity). */
export const sentFieldsFor = (def, myResolved) => {
  if (!def?.sentFields) return [];
  return typeof def.sentFields === 'function' ? def.sentFields(myResolved) : def.sentFields;
};

/** True when every sent-side field the def needs has a valid value. */
export const sentExchangeReady = (def, sentExchange, myResolved) => {
  const fields = sentFieldsFor(def, myResolved);
  return fields.every((f) => {
    const v = clean(sentExchange?.[f.key]);
    if (!v) return false;
    return !f.validate || f.validate(v) === true;
  });
};

// ── WPX prefix rule ─────────────────────────────────────────────────────────

const PORTABLE_SUFFIXES = new Set(['P', 'M', 'MM', 'AM', 'QRP', 'A', 'B', 'LH', 'R']);
const looksLikeFullCall = (s) => /^[A-Z0-9]{1,3}\d{1,4}[A-Z]{1,4}$/.test(s);

/** Prefix of a plain (non-compound) call: everything through its last leading-
 *  section digit — K5AB → K5, DL1ABC → DL1, 4X4ABC → 4X4. No digit → first
 *  two characters + '0' (WPX rule for digitless calls). */
const plainPrefix = (call) => {
  const m = call.match(/^([A-Z0-9]*\d)[A-Z]*$/);
  if (m) return m[1];
  if (!/\d/.test(call)) return call.slice(0, 2) + '0';
  return null;
};

/**
 * WPX prefix for a callsign (standard CQ WPX rules):
 *   K5AB → K5 · DL1ABC → DL1 · PJ2/W9WI → PJ2 · W9WI/7 → W7 ·
 *   PA/W1AW → PA0 · W1AW/QRP → W1 · RAEM → RA0
 * Returns null when nothing prefix-like can be extracted.
 */
export const wpxPrefix = (rawCall) => {
  const call = String(rawCall || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, '');
  if (!call) return null;

  let parts = call.split('/').filter(Boolean);
  // Strip ignorable operating suffixes (/P /MM /QRP …) from the right.
  while (parts.length > 1 && PORTABLE_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0) return null;

  if (parts.length === 1) return plainPrefix(parts[0]);

  const [left, right] = parts;

  // Portable district digit: KH6XXX/1 → KH1, W9WI/7 → W7 — replace the
  // home prefix's trailing digit(s) with the new district digit.
  if (/^\d$/.test(right)) {
    const base = plainPrefix(left);
    return base ? base.replace(/\d+$/, right) : null;
  }

  // Designator/call compound: the part that is NOT a full callsign is the
  // prefix designator (PJ2/W9WI → PJ2, W9WI/PJ2 → PJ2, PA/W1AW → PA0).
  const leftFull = looksLikeFullCall(left);
  const rightFull = looksLikeFullCall(right);
  const designator = rightFull && !leftFull ? left : leftFull && !rightFull ? right : left;

  if (/\d$/.test(designator)) return designator; // PJ2, 5Z4 — already a prefix
  if (!/\d/.test(designator)) return designator + '0'; // PA → PA0, LX → LX0
  return plainPrefix(designator);
};

// ── Serial numbering ────────────────────────────────────────────────────────

/** Next sent serial = session QSO count + 1 (recomputed from the log, so it
 *  survives reloads). */
export const nextSentSerial = (qsos, startedAt) => sessionQsos(qsos, startedAt).length + 1;

// ── ADIF mapping ────────────────────────────────────────────────────────────

/**
 * Build the contest-specific QSO fields for one logged contact.
 *
 * @param {object} def       contest definition
 * @param {object} opts
 * @param {string} opts.mode          operating mode ('CW'/'SSB'/…)
 * @param {object} opts.rcvd          received exchange { fieldKey: value }
 * @param {object} [opts.sent]        session sentExchange { fieldKey: value }
 * @param {number} [opts.serialSent]  sent serial (defs with serial: true)
 * @param {object} [opts.myResolved]  ctyLookup(userCallsign) (ARRL DX side)
 * @returns {{ rstSent: string|null, rstRcvd: string|null,
 *            core: object, extras: object }}
 *   core   → merged onto the QSO record (name, tx_pwr)
 *   extras → verbatim ADIF fields (CONTEST_ID, STX/SRX, *_STRING, CQZ, …)
 */
export const buildQsoContestFields = (def, { mode, rcvd = {}, sent = {}, serialSent, myResolved } = {}) => {
  const extras = {};
  const core = {};
  let rstRcvd = null;

  const contestId = resolveAdifContestId(def, mode);
  if (contestId) extras.CONTEST_ID = contestId;

  const rcvdTokens = [];
  for (const field of def?.exchange || []) {
    let value = clean(rcvd[field.key]);
    if (field.uppercase) value = value.toUpperCase();
    if (!value) continue;

    if (field.rst) {
      rstRcvd = value;
      continue; // RST is not part of the *_STRING composite
    }
    rcvdTokens.push(value);

    if (field.serial) {
      extras.SRX = value;
      continue;
    }
    if (field.core) {
      core[field.core] = value;
      continue;
    }
    if (field.statePower) {
      // ARRL DX smart mapping: a state/province token → STATE,
      // anything power-shaped → RX_PWR (numeric watts; KW → 1000).
      const up = value.toUpperCase();
      if (US_STATES.has(up) || VE_PROVINCES.has(up)) extras.STATE = up;
      else if (/^\d{1,4}$/.test(up)) extras.RX_PWR = up;
      else if (up === 'KW' || up === 'K') extras.RX_PWR = '1000';
      continue;
    }
    if (field.adif) {
      if (field.adifNumericOnly && !/^\d+$/.test(value)) continue; // SRX_STRING only
      extras[field.adif] = field.uppercase ? value.toUpperCase() : value;
    }
  }
  if (rcvdTokens.length > 0) extras.SRX_STRING = rcvdTokens.join(' ');

  const sentTokens = [];
  if (def?.serial && Number.isFinite(serialSent)) {
    extras.STX = String(serialSent);
    sentTokens.push(String(serialSent));
  }
  for (const field of sentFieldsFor(def, myResolved)) {
    let value = clean(sent[field.key]);
    if (field.uppercase) value = value.toUpperCase();
    if (!value) continue;
    sentTokens.push(value);
    if (field.sentAdif) extras[field.sentAdif] = value;
    if (field.sentCore) core[field.sentCore] = value;
  }
  if (sentTokens.length > 0) extras.STX_STRING = sentTokens.join(' ');

  return { rstSent: null, rstRcvd, core, extras };
};

/** Compact received-exchange summary for the session-log tail row. */
export const formatRcvdExchange = (qso) => {
  const x = qso?.extras || {};
  if (x.SRX_STRING) return x.SRX_STRING;
  if (x.SRX != null && x.SRX !== '') return `#${x.SRX}`;
  return qso?.rst_rcvd || '';
};

// ── Multiplier dimensions ───────────────────────────────────────────────────

export const DIM_META = {
  dxcc: { label: 'DXCC', short: 'DXCC' },
  cqzone: { label: 'Zones', short: 'Zn' },
  ituz: { label: 'ITU/Soc', short: 'IZ' },
  state: { label: 'States', short: 'St' },
  stprov: { label: 'St/Prov', short: 'St' },
  section: { label: 'Sections', short: 'Sec' },
  prefix: { label: 'Prefixes', short: 'Pfx' },
  grid: { label: 'Grids', short: 'Gr' },
};

/** Active multiplier dimension keys for a def (ARRL DX picks per side). */
export const multDimsFor = (def, myResolved) => {
  let dims = typeof def?.multFor === 'function' ? def.multFor(myResolved) : def?.multDimension;
  if (dims === 'none' || dims == null) return [];
  if (!Array.isArray(dims)) dims = [dims];
  return dims.filter((d) => DIM_META[d]);
};

/** Non-scoring dimensions a def wants displayed anyway (Field Day sections). */
export const trackDimsFor = (def) =>
  (Array.isArray(def?.trackDimensions) ? def.trackDimensions : []).filter((d) => DIM_META[d]);

const numToken = (raw, lo, hi) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** Value of a multiplier dimension for one QSO (null = doesn't count). */
export const dimValue = (dim, qso, resolved) => {
  const x = qso?.extras || {};
  switch (dim) {
    case 'dxcc':
      return resolved?.dxcc || null;
    case 'cqzone': {
      const explicit = x.CQZ != null && x.CQZ !== '' ? numToken(x.CQZ, 1, WAZ_TOTAL) : null;
      if (explicit) return explicit;
      return Number.isFinite(resolved?.cq) && resolved.cq >= 1 && resolved.cq <= WAZ_TOTAL ? resolved.cq : null;
    }
    case 'ituz': {
      const explicit = x.ITUZ != null && x.ITUZ !== '' ? numToken(x.ITUZ, 1, 90) : null;
      if (explicit) return explicit;
      // IARU: an HQ-society exchange is a mult too — it lives in SRX_STRING.
      const s = String(x.SRX_STRING || '')
        .trim()
        .toUpperCase();
      if (s && /[A-Z]/.test(s)) return s;
      return Number.isFinite(resolved?.itu) && resolved.itu >= 1 && resolved.itu <= 90 ? resolved.itu : null;
    }
    case 'state': {
      const s = String(x.STATE || '')
        .trim()
        .toUpperCase();
      return US_STATES.has(s) ? s : null;
    }
    case 'stprov': {
      const s = String(x.STATE || '')
        .trim()
        .toUpperCase();
      return US_STATES.has(s) || VE_PROVINCES.has(s) ? s : null;
    }
    case 'section': {
      const s = String(x.ARRL_SECT || '')
        .trim()
        .toUpperCase();
      return /^[A-Z]{2,4}$/.test(s) ? s : null;
    }
    case 'prefix':
      return wpxPrefix(qso?.call);
    case 'grid':
      return vuccGrid(qso?.gridsquare);
    default:
      return null;
  }
};

/**
 * Session multipliers per the active contest definition.
 *
 * @param {Array}  qsos full logbook
 * @param {object} opts { startedAt, def, myResolved?, resolve? }
 * @returns {{
 *   qsoCount: number,
 *   dims: Array<{ key, label, short, scoring: boolean, values: Set }>,
 *   perBand: Map<string, { qsos: number, values: Map<dimKey, Set> }>,
 *   multTotal: number,   // sum of scoring dims' sizes
 *   scoring: boolean,    // false = no-mult contest (Field Day)
 *   score: number,       // QSOs × mults (or plain QSOs when no mults)
 * }}
 */
export const computeContestMults = (qsos, { startedAt, def, myResolved, resolve = defaultResolve } = {}) => {
  const d = def || getContestDef(DEFAULT_CONTEST_ID);
  const scoringKeys = multDimsFor(d, myResolved);
  const trackKeys = trackDimsFor(d).filter((k) => !scoringKeys.includes(k));
  const dims = [
    ...scoringKeys.map((key) => ({ key, ...DIM_META[key], scoring: true, values: new Set() })),
    ...trackKeys.map((key) => ({ key, ...DIM_META[key], scoring: false, values: new Set() })),
  ];

  const perBand = new Map();
  let qsoCount = 0;

  for (const q of sessionQsos(qsos, startedAt)) {
    if (!q || !q.call) continue;
    qsoCount += 1;
    const band = qsoBand(q);
    let bandRec = null;
    if (band) {
      bandRec = perBand.get(band);
      if (!bandRec) {
        bandRec = { qsos: 0, values: new Map(dims.map((dim) => [dim.key, new Set()])) };
        perBand.set(band, bandRec);
      }
      bandRec.qsos += 1;
    }

    // ctyLookup handles compound calls itself — pass the raw call.
    const resolved = resolve(q.call) || null;
    for (const dim of dims) {
      const v = dimValue(dim.key, q, resolved);
      if (v == null) continue;
      dim.values.add(v);
      if (bandRec) bandRec.values.get(dim.key).add(v);
    }
  }

  const scoring = scoringKeys.length > 0;
  const multTotal = dims.filter((dim) => dim.scoring).reduce((sum, dim) => sum + dim.values.size, 0);
  const score = scoring ? qsoCount * multTotal : qsoCount;
  return { qsoCount, dims, perBand, multTotal, scoring, score };
};

export default {
  CONTEST_DEFS,
  DEFAULT_CONTEST_ID,
  VE_PROVINCES,
  DIM_META,
  getContestDef,
  isWve,
  resolveAdifContestId,
  sentFieldsFor,
  sentExchangeReady,
  wpxPrefix,
  nextSentSerial,
  buildQsoContestFields,
  formatRcvdExchange,
  multDimsFor,
  trackDimsFor,
  dimValue,
  computeContestMults,
};
