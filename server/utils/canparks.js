/**
 * CANParks (canparks.ca) upstream normalization helpers.
 *
 * The CANParks program is young and its spot feed was empty when the
 * integration was written, so `normalizeSpot` is deliberately defensive:
 * it accepts the field-name variants seen across the sibling programs
 * (POTA/WWFF/SOTA) plus the shape observed live from api.canparks.ca:
 *
 *   { id, activator_callsign, spotter_callsign, frequency_khz, band, mode,
 *     comment, source, created_at, expires_at, reference ("QC-0071"),
 *     park_name, city, province_code, ... }
 *
 * Spots arrive WITHOUT coordinates — enrichment happens via the parks
 * directory (`/parks`), indexed by reference. Unknown extra fields are
 * preserved by spreading the raw record under the normalized keys.
 *
 * Pure functions only — the route in server/routes/canparks.js owns all
 * caching and I/O so these are trivially unit-testable.
 */

const { latLonToMaidenhead } = require('./grid');

/** First present, non-empty string value among `keys`. */
function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** First present, finite numeric value (number or numeric string) among `keys`. */
function firstNumber(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Normalize a frequency to MHz.
 * `unit` may be 'khz' | 'mhz' | 'hz' when the source field name told us the
 * unit; otherwise detect by magnitude the same way the client's
 * normalizeFrequencyToMHz does: >=1e6 → Hz, >=1000 → kHz, else already MHz.
 * Returns a finite MHz number or null.
 */
function toMhz(value, unit = null) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'mhz') return n;
  if (unit === 'khz') return n / 1000;
  if (unit === 'hz') return n / 1e6;
  if (n >= 1e6) return n / 1e6;
  if (n >= 1000) return n / 1000;
  return n;
}

/**
 * Normalize a timestamp to an ISO-8601 UTC string.
 * Accepts ISO strings (with or without zone), epoch seconds, and epoch ms.
 * Returns null for anything unparseable.
 */
function toIsoTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
    let n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1e12) n *= 1000; // epoch seconds → ms
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== 'string') return null;
  // Bare "YYYY-MM-DDTHH:MM:SS" without a zone is UTC upstream (same POTA
  // quirk the client already defends against) — force UTC interpretation.
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Slim a park directory record to the fields the client (and spot
 * enrichment) actually needs. Drops URLs/city/province-name — the full
 * directory is ~11k records and the fat version is megabytes.
 * Returns null for records without a reference.
 */
function slimPark(park) {
  if (!park || typeof park !== 'object' || Array.isArray(park)) return null;
  const reference = firstString(park, ['reference', 'ref', 'id']);
  if (!reference) return null;
  return {
    reference,
    name: firstString(park, ['name', 'park_name']),
    grid: firstString(park, ['grid', 'grid6', 'grid4']),
    latitude: firstNumber(park, ['latitude', 'lat']),
    longitude: firstNumber(park, ['longitude', 'lon', 'lng', 'long']),
    province_code: firstString(park, ['province_code']),
    status: firstString(park, ['status']),
    pota_reference: firstString(park, ['pota_reference']),
    wwff_reference: firstString(park, ['wwff_reference']),
  };
}

/** Index slimmed parks by uppercased reference for O(1) enrichment joins. */
function buildParkIndex(parks) {
  const index = Object.create(null);
  if (!Array.isArray(parks)) return index;
  for (const p of parks) {
    if (p && typeof p.reference === 'string') index[p.reference.toUpperCase()] = p;
  }
  return index;
}

/**
 * Normalize a raw CANParks spot into the shape the client hook consumes:
 *   { ...raw, call, spotter, freq (MHz number|null), mode, ref, name,
 *     comments, time (ISO|null), lat, lon, grid, potaRef, wwffRef }
 *
 * `parkIndex` (from buildParkIndex) supplies lat/lon/grid/name and the
 * POTA/WWFF cross-references when the spot itself lacks them.
 * Returns null when the record is not recognizable as a spot (no activator
 * callsign under any accepted name) so the route can log the shape once.
 */
function normalizeSpot(raw, parkIndex = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const call = firstString(raw, ['activator_callsign', 'activator', 'activatorCallsign', 'callsign', 'call']);
  if (!call) return null;

  const spotter = firstString(raw, ['spotter_callsign', 'spotter', 'spotterCallsign']);
  const ref = firstString(raw, ['reference', 'park_reference', 'park', 'ref']);
  const modeRaw = firstString(raw, ['mode']);
  const mode = modeRaw && modeRaw.toUpperCase() !== 'UNKNOWN' ? modeRaw : '';
  const comments = firstString(raw, ['comment', 'comments', 'remarks']) || '';

  // Frequency — explicit-unit field names win, then magnitude detection.
  let freq = toMhz(firstNumber(raw, ['frequency_khz', 'freq_khz']), 'khz');
  if (freq == null) freq = toMhz(firstNumber(raw, ['frequency_mhz', 'freq_mhz']), 'mhz');
  if (freq == null) freq = toMhz(firstNumber(raw, ['frequency_hz', 'freq_hz']), 'hz');
  if (freq == null) freq = toMhz(firstNumber(raw, ['frequency', 'freq']));

  const time = toIsoTime(
    raw.spotTime ?? raw.spot_time ?? raw.time ?? raw.timestamp ?? raw.created_at ?? raw.createdAt ?? null,
  );

  let lat = firstNumber(raw, ['latitude', 'lat']);
  let lon = firstNumber(raw, ['longitude', 'lon', 'lng', 'long']);
  let grid = firstString(raw, ['grid', 'grid6', 'grid4']);
  let name = firstString(raw, ['park_name', 'name', 'reference_name']);
  let potaRef = firstString(raw, ['pota_reference']);
  let wwffRef = firstString(raw, ['wwff_reference']);

  // Enrich from the parks directory when the spot itself is bare.
  const park = parkIndex && ref ? parkIndex[ref.toUpperCase()] : null;
  if (park) {
    if (lat == null && park.latitude != null) lat = park.latitude;
    if (lon == null && park.longitude != null) lon = park.longitude;
    if (!grid && park.grid) grid = park.grid;
    if (!name && park.name) name = park.name;
    if (!potaRef && park.pota_reference) potaRef = park.pota_reference;
    if (!wwffRef && park.wwff_reference) wwffRef = park.wwff_reference;
  }
  if (!grid && lat != null && lon != null) {
    try {
      grid = latLonToMaidenhead({ lat, lon }) || null;
    } catch {
      grid = null;
    }
  }

  // Spread raw first so unknown upstream fields survive; normalized keys win.
  return {
    ...raw,
    call,
    spotter: spotter || '',
    freq,
    mode,
    ref: ref || '',
    name: name || '',
    comments,
    time,
    lat,
    lon,
    grid: grid || '',
    potaRef: potaRef || null,
    wwffRef: wwffRef || null,
  };
}

module.exports = { normalizeSpot, slimPark, buildParkIndex, toMhz, toIsoTime };
