/**
 * workedBefore — cross-reference spots against the operator's logged QSOs.
 *
 * Builds an index from the two live QSO feeds the app already ingests plus
 * the native in-browser logbook:
 *   - N3FJP bridge      GET /api/n3fjp/qsos    → { qsos: [{ dx_call, freq_khz, mode, status, ... }] }
 *   - N1MM/DXLog        GET /api/contest/qsos  → { qsos: [{ dxCall, freqMHz, bandMHz, mode, ... }] }
 *   - Native logbook    logbookStore (IndexedDB) → [{ call, freq (MHz), mode, band, ... }]
 *
 * Index shape: Map<baseCall, { bands: Set<band>, combos: Set<`${band}|${mode}`> }>
 *   - baseCall via extractBaseCall (5Z4/OZ6ABL → OZ6ABL, W1ABC/6 → W1ABC)
 *   - band via getBandFromFreq (accepts MHz, kHz, or Hz; 'other' is discarded)
 *   - mode normalized (USB/LSB/PH/PHONE → SSB, PSK31/PSK63 → PSK, ...)
 *
 * Matching (lookupWorked):
 *   'dupe'   — call worked on this band+mode (or on this band when the spot's
 *              mode is unknown) — contesters can skip it
 *   'worked' — call is in the log, but not on this band+mode — still a QSO
 *              worth making
 *   null     — not in the log (implicitly a "new one"), or no data
 */
import { extractBaseCall } from '../components/CallsignLink.jsx';
import { getBandFromFreq } from './callsign.js';

/**
 * Normalize a logger/spot mode string so N3FJP, N1MM, and cluster-inferred
 * modes land on the same token. Phone submodes collapse to SSB; PSK/JT
 * submodes collapse to their family.
 */
export const normalizeMode = (mode) => {
  if (mode == null) return null;
  const m = String(mode).trim().toUpperCase();
  if (!m) return null;
  if (m === 'USB' || m === 'LSB' || m === 'PH' || m === 'PHONE') return 'SSB';
  if (m.startsWith('PSK')) return 'PSK';
  if (m.startsWith('JT')) return 'JT65';
  if (m === 'DIG' || m === 'DIGI' || m === 'DATA') return 'DATA';
  return m;
};

/** Band key from a frequency in MHz, kHz, or Hz — null when unrecognized. */
export const bandFromFreq = (freq) => {
  if (freq == null || freq === '') return null;
  const band = getBandFromFreq(freq);
  return band === 'other' ? null : band;
};

const addQsoToIndex = (index, call, freq, mode, bandHint) => {
  const base = extractBaseCall(String(call || '').trim());
  if (!base) return;
  let entry = index.get(base);
  if (!entry) {
    entry = { bands: new Set(), combos: new Set() };
    index.set(base, entry);
  }
  // Frequency wins; an ADIF-style band tag ('20m'/'20M') covers imported
  // logbook rows that carry no frequency.
  let band = bandFromFreq(freq);
  if (!band && bandHint) {
    const hint = String(bandHint).trim().toLowerCase();
    if (/^\d+c?m$/.test(hint)) band = hint;
  }
  if (!band) return;
  entry.bands.add(band);
  const m = normalizeMode(mode);
  if (m) entry.combos.add(`${band}|${m}`);
};

/**
 * Build the worked-before index from all QSO sources. Any list may be
 * empty or missing (source disabled / endpoint unavailable / empty logbook).
 *
 * @param {object} sources
 * @param {Array}  [sources.n3fjpQsos]   QSOs from /api/n3fjp/qsos (preview rows are skipped)
 * @param {Array}  [sources.contestQsos] QSOs from /api/contest/qsos
 * @param {Array}  [sources.logbookQsos] QSOs from the native logbook (freq in MHz)
 * @returns {Map} worked-before index
 */
export const buildWorkedIndex = ({ n3fjpQsos = [], contestQsos = [], logbookQsos = [] } = {}) => {
  const index = new Map();

  for (const q of Array.isArray(n3fjpQsos) ? n3fjpQsos : []) {
    if (!q || !q.dx_call) continue;
    // Previews are "as you type" entries from N3FJP — not logged contacts.
    if (q.status === 'preview') continue;
    addQsoToIndex(index, q.dx_call, q.freq_khz, q.mode);
  }

  for (const q of Array.isArray(contestQsos) ? contestQsos : []) {
    if (!q) continue;
    // freqMHz is the actual RX/TX frequency; bandMHz (N1MM band tag, e.g. 14)
    // still resolves to the right band via getBandFromFreq when freq is absent.
    addQsoToIndex(index, q.dxCall || q.call, q.freqMHz ?? q.bandMHz, q.mode);
  }

  for (const q of Array.isArray(logbookQsos) ? logbookQsos : []) {
    if (!q || !q.call) continue;
    // Native logbook records store freq in MHz; imported ADIF rows may lack
    // freq but carry an ADIF band tag. A call with neither still indexes for
    // call-level "worked" matches.
    addQsoToIndex(index, q.call, q.freq, q.mode, q.band);
  }

  return index;
};

/**
 * Look a spot up in the worked-before index.
 *
 * @param {Map}    index worked-before index from buildWorkedIndex
 * @param {string} call  spotted callsign (decorations/portable suffixes OK)
 * @param {*}      [freq] spot frequency in MHz, kHz, or Hz (optional)
 * @param {string} [mode] spot mode (optional — e.g. inferred cluster mode)
 * @returns {'dupe'|'worked'|null}
 */
export const lookupWorked = (index, call, freq, mode) => {
  if (!index || index.size === 0 || !call) return null;
  const entry = index.get(extractBaseCall(String(call).trim()));
  if (!entry) return null;

  const band = bandFromFreq(freq);
  if (band) {
    const m = normalizeMode(mode);
    if (m) {
      if (entry.combos.has(`${band}|${m}`)) return 'dupe';
    } else if (entry.bands.has(band)) {
      // Mode unknown: a same-band QSO is the best dupe signal we have.
      return 'dupe';
    }
  }
  return 'worked';
};

export default { normalizeMode, bandFromFreq, buildWorkedIndex, lookupWorked };
