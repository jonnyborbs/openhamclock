/**
 * websdrDirectory.js — parse the KiwiSDR public directory feed and pick
 * receivers near a listener.
 *
 * The feed is http://rx.linkfanel.net/kiwisdr_com.js — the machine-readable
 * snapshot behind the rx.linkfanel.net map. It's a JS file of the form:
 *
 *   var kiwisdr_com =
 *   [
 *     {
 *       "status":"active", "offline":"no",
 *       "name":"...", "url":"http://host:8073",
 *       "users":"4", "users_max":"8",
 *       "gps":"(59.546000, 12.526000)",
 *       "bands":"0-30000000",            // coverage, Hz in current snapshots
 *       "antenna":"...", "snr":"44,43",  // "all-bands,HF" SNR score
 *       ... many more fields ...
 *     },
 *     ...
 *   ]
 *   ;
 *
 * Every value is a string. `bands` has historically been kHz ("0-30000") and
 * is Hz in current snapshots ("0-30000000") — parseBands sniffs the unit.
 */

const { haversineDistance } = require('./grid');

/**
 * Parse a `bands` coverage string into kHz bounds.
 * Accepts "min-max" in Hz (current feed) or kHz (historical), sniffed by
 * magnitude: a max of 1,000,000+ can only be Hz (1 GHz in kHz is nonsense
 * for these receivers; 30 MHz in Hz is 30,000,000).
 *
 * @param {string} bands - e.g. "0-30000000" or "50000-30000000"
 * @returns {{min_khz:number, max_khz:number}|null} null when unparsable
 */
function parseBands(bands) {
  const m = typeof bands === 'string' && bands.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  let min = parseFloat(m[1]);
  let max = parseFloat(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  if (max >= 1e6) {
    // Hz → kHz
    min /= 1000;
    max /= 1000;
  }
  return { min_khz: min, max_khz: max };
}

/** Parse the feed's gps field "(lat, lon)" → {lat, lon} or null. */
function parseGps(gps) {
  const m = typeof gps === 'string' && gps.match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null; // null island = "not configured"
  return { lat, lon };
}

/**
 * Parse the raw kiwisdr_com.js feed text into normalized receiver entries.
 * Discards entries that are offline/inactive, lack usable GPS coords, or
 * lack a usable http(s) URL. Keeps full receivers — fullness is transient,
 * so it's filtered at pick time, not parse time.
 *
 * @param {string} text - raw feed body
 * @returns {Array<{url:string, name:string, lat:number, lon:number,
 *   users:number, users_max:number, snr:string|null, bands:string|null,
 *   coverage:{min_khz:number,max_khz:number}|null, antenna:string|null}>}
 */
function parseDirectory(text) {
  const m = typeof text === 'string' && text.match(/var\s+kiwisdr_com\s*=\s*(\[[\s\S]*\])/);
  if (!m) throw new Error('kiwisdr_com.js: no receiver array found');
  let raw;
  try {
    // The array is plain JSON apart from a possible trailing ",]" — tolerate it.
    raw = JSON.parse(m[1].replace(/,\s*\]\s*$/, ']'));
  } catch (e) {
    throw new Error(`kiwisdr_com.js: bad JSON (${e.message})`);
  }
  if (!Array.isArray(raw)) throw new Error('kiwisdr_com.js: not an array');

  const entries = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    if (r.offline && r.offline !== 'no') continue;
    if (r.status && r.status !== 'active') continue;
    const gps = parseGps(r.gps);
    if (!gps) continue;
    if (typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url)) continue;
    const users = parseInt(r.users, 10);
    const usersMax = parseInt(r.users_max, 10);
    entries.push({
      url: r.url.trim().replace(/\/+$/, ''),
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : r.url,
      lat: gps.lat,
      lon: gps.lon,
      users: Number.isFinite(users) ? users : 0,
      users_max: Number.isFinite(usersMax) ? usersMax : 0,
      snr: typeof r.snr === 'string' && r.snr ? r.snr : null,
      bands: typeof r.bands === 'string' && r.bands ? r.bands : null,
      coverage: parseBands(r.bands),
      antenna: typeof r.antenna === 'string' && r.antenna.trim() ? r.antenna.trim() : null,
    });
  }
  return entries;
}

/** Coverage extending above the HF ceiling — a VHF+ capable receiver. */
const isVhfCapable = (e) => e.coverage && e.coverage.max_khz > 32000;

/**
 * Pick the receivers nearest to (lat, lon) that currently have a free slot.
 * Returns nearest-first compact entries ready to serialize. Because almost
 * every KiwiSDR is HF-only, the nearest few VHF-capable receivers are
 * appended past the limit when none made the cut — otherwise a VHF/UHF spot
 * could never find a tuned receiver even though the directory has one.
 *
 * @param {ReturnType<typeof parseDirectory>} entries
 * @param {number} lat
 * @param {number} lon
 * @param {number} [limit=15]
 * @param {number} [vhfExtras=3]
 */
function pickNearest(entries, lat, lon, limit = 15, vhfExtras = 3) {
  const open = entries
    .filter((e) => e.users_max > 0 && e.users < e.users_max)
    .map((e) => ({ ...e, dist_km: Math.round(haversineDistance(lat, lon, e.lat, e.lon)) }))
    .sort((a, b) => a.dist_km - b.dist_km);

  const picked = open.slice(0, limit);
  if (!picked.some(isVhfCapable)) {
    picked.push(...open.slice(limit).filter(isVhfCapable).slice(0, vhfExtras));
  }

  return picked.map(({ url, name, dist_km, users, users_max, snr, bands, coverage, antenna }) => ({
    url,
    name,
    dist_km,
    users,
    users_max,
    snr,
    bands,
    coverage,
    antenna,
  }));
}

module.exports = { parseBands, parseGps, parseDirectory, pickNearest };
