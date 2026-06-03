/**
 * Convert classical Two-Line Element (TLE) set to an OMM-shaped JSON object
 * matching what CelesTrak returns from /NORAD/elements/gp.php?FORMAT=json.
 *
 * Used by the satellite resolver to pour TLE data from AMSAT and SatNOGS
 * (TLE-only feeds) into the same ommCache structure the rest of the code expects.
 *
 * TLE column layout reference: https://celestrak.org/NORAD/documentation/tle-fmt.php
 * OMM format reference:        https://celestrak.org/NORAD/documentation/gp-data-formats.php
 */

'use strict';

/**
 * Parse a TLE scientific-notation field with an implied decimal point.
 * TLE encodes values like 0.18407e-3 as " 18407-3" (no leading sign means +,
 * no decimal point — it sits to the left of the first significant digit).
 */
function parseExpField(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed === '0' || trimmed === '00000-0' || trimmed === '+00000-0') return 0;
  const sign = trimmed[0] === '-' ? -1 : 1;
  const body = trimmed[0] === '+' || trimmed[0] === '-' ? trimmed.slice(1) : trimmed;
  // body looks like "18407-3" → mantissa "18407", exponent "-3"
  const m = body.match(/^(\d+)([+-]\d+)$/);
  if (!m) return 0;
  const mantissa = parseInt(m[1], 10) / Math.pow(10, m[1].length);
  const exponent = parseInt(m[2], 10);
  return sign * mantissa * Math.pow(10, exponent);
}

/**
 * Parse a TLE decimal field with an implied leading decimal point.
 * TLE encodes eccentricity 0.0007169 as " 0007169" (7 digits, leading "0.").
 */
function parseImpliedDecimal(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed) return 0;
  const sign = trimmed[0] === '-' ? -1 : 1;
  const body = trimmed[0] === '+' || trimmed[0] === '-' ? trimmed.slice(1) : trimmed;
  return sign * parseFloat('0.' + body);
}

/**
 * Convert TLE epoch (YYDDD.DDDDDDDD) to ISO 8601 datetime string.
 * Year is 2-digit: 57-99 → 19xx, 00-56 → 20xx per CelesTrak convention.
 */
function epochToIso(epochField) {
  const trimmed = String(epochField).trim();
  const yy = parseInt(trimmed.slice(0, 2), 10);
  const doyFrac = parseFloat(trimmed.slice(2));
  const fullYear = yy < 57 ? 2000 + yy : 1900 + yy;
  const dayOfYearInt = Math.floor(doyFrac);
  const fractionalDay = doyFrac - dayOfYearInt;
  // Day 1 = January 1
  const base = Date.UTC(fullYear, 0, dayOfYearInt);
  const ms = base + fractionalDay * 86400000;
  return new Date(ms).toISOString().replace('Z', '');
}

/**
 * Convert a TLE (name + line1 + line2) into an OMM-shaped JSON object.
 * Returns null if parsing fails so callers can skip bad records cleanly.
 *
 * @param {string} name   Satellite name (line 0)
 * @param {string} line1  TLE line 1
 * @param {string} line2  TLE line 2
 * @returns {object|null}
 */
function tleToOmm(name, line1, line2) {
  if (typeof line1 !== 'string' || typeof line2 !== 'string') return null;
  if (line1.length < 68 || line2.length < 68) return null;
  if (line1[0] !== '1' || line2[0] !== '2') return null;

  try {
    // Line 1 columns (0-indexed for slice, TLE spec is 1-indexed)
    const noradCatId = parseInt(line1.slice(2, 7), 10);
    const classification = line1.slice(7, 8) || 'U';
    const intlDesignatorRaw = line1.slice(9, 17).trim();
    // Format the international designator like "1998-067A" if it parses cleanly
    let objectId = intlDesignatorRaw;
    const intlMatch = intlDesignatorRaw.match(/^(\d{2})(\d{3})([A-Z]+)$/);
    if (intlMatch) {
      const yy = parseInt(intlMatch[1], 10);
      const year = yy < 57 ? 2000 + yy : 1900 + yy;
      objectId = `${year}-${intlMatch[2]}${intlMatch[3]}`;
    }
    const epoch = epochToIso(line1.slice(18, 32));
    // CelesTrak's OMM endpoint preserves the TLE's /2 and /6 conventions for
    // these fields, and satellite.js's json2satrec expects the same. Don't undo.
    const meanMotionDot = parseFloat(line1.slice(33, 43));
    const meanMotionDdot = parseExpField(line1.slice(44, 52));
    const bstar = parseExpField(line1.slice(53, 61));
    const ephemerisType = parseInt(line1.slice(62, 63), 10) || 0;
    const elementSetNo = parseInt(line1.slice(64, 68).trim(), 10) || 0;

    // Line 2 columns
    const inclination = parseFloat(line2.slice(8, 16));
    const raOfAscNode = parseFloat(line2.slice(17, 25));
    const eccentricity = parseImpliedDecimal(line2.slice(26, 33));
    const argOfPerigee = parseFloat(line2.slice(34, 42));
    const meanAnomaly = parseFloat(line2.slice(43, 51));
    const meanMotion = parseFloat(line2.slice(52, 63));
    const revAtEpoch = parseInt(line2.slice(63, 68).trim(), 10) || 0;

    // Sanity check: NORAD ID must agree between the two lines
    const noradLine2 = parseInt(line2.slice(2, 7), 10);
    if (noradCatId !== noradLine2) return null;
    if (!Number.isFinite(inclination) || !Number.isFinite(meanMotion)) return null;

    return {
      OBJECT_NAME: String(name || '')
        .replace(/^0\s+/, '')
        .trim(),
      OBJECT_ID: objectId,
      EPOCH: epoch,
      MEAN_MOTION: meanMotion,
      ECCENTRICITY: eccentricity,
      INCLINATION: inclination,
      RA_OF_ASC_NODE: raOfAscNode,
      ARG_OF_PERICENTER: argOfPerigee,
      MEAN_ANOMALY: meanAnomaly,
      EPHEMERIS_TYPE: ephemerisType,
      CLASSIFICATION_TYPE: classification,
      NORAD_CAT_ID: noradCatId,
      ELEMENT_SET_NO: elementSetNo,
      REV_AT_EPOCH: revAtEpoch,
      BSTAR: bstar,
      MEAN_MOTION_DOT: meanMotionDot,
      MEAN_MOTION_DDOT: meanMotionDdot,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a concatenated TLE text blob (AMSAT nasabare.txt format) into an
 * array of OMM objects. Returns an empty array on parse failure.
 *
 * Format:
 *   NAME
 *   1 NNNNN...
 *   2 NNNNN...
 *   NAME
 *   1 NNNNN...
 *   2 NNNNN...
 */
function parseTleBlock(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const out = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const l0 = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1.startsWith('1 ') && l2.startsWith('2 ')) {
      const omm = tleToOmm(l0, l1, l2);
      if (omm) out.push(omm);
      i += 2; // skip the lines we just consumed
    }
  }
  return out;
}

module.exports = { tleToOmm, parseTleBlock, parseImpliedDecimal, parseExpField, epochToIso };
