/**
 * Cluster-spot location search (issue #1095).
 *
 * DX cluster spots frequently carry the *operating* location — a grid pulled
 * from a POTA/WWFF/SOTA comment, or an authoritative DXpedition entity —
 * while QRZ/HamQTH return the operator's HOME QTH. For a portable op like
 * VK2IO/P at a park, the cluster spot is right and QRZ is wrong. This helper
 * searches the DX cluster path cache (routes/dxcluster.js →
 * dxSpotPathsCacheByKey) for a recent, precisely-located spot of a callsign
 * so RBN (and anything else) can consult it BEFORE the QRZ/HamQTH chain.
 *
 * Pure: no I/O, no module state — everything comes in as arguments.
 */

const { getBandFromKHz, latLonToMaidenhead } = require('./grid');

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // dxpaths accumulator holds ~1h of spots

// Only these dxLocSource values are trusted: they reflect where the station
// is actually transmitting. 'prefix'/'prefix-grid' are country centroids
// (coarser than what the QRZ chain returns) and 'hamqth-dxcc' is itself a
// home-QTH-style lookup — using those would defeat the purpose.
const PRECISE_SOURCES = new Set(['grid', 'dxpedition']);

/**
 * @param {Map} pathsByKey — Map<cacheKey, { allPaths?: [], paths?: [] }> where
 *   each path is a dxcluster path row ({ dxCall, dxLat, dxLon, dxGrid,
 *   dxCountry, dxLocSource, freq (MHz string), timestamp }).
 * @param {string} call — callsign to locate (compound forms OK).
 * @param {object} [opts]
 * @param {string} [opts.band] — RBN band ('20m', …); same-band cluster spots
 *   are preferred over other bands, then recency decides.
 * @param {number} [opts.now] — injection point for tests.
 * @param {number} [opts.maxAgeMs] — ignore cluster spots older than this.
 * @param {function} [opts.extractBaseCallsign] — base-call normalizer so
 *   'VK2IO' matches a cluster spot of 'VK2IO/P' (and vice versa).
 * @returns {{ lat, lon, grid, country, source } | null}
 */
function findClusterSpotLocation(pathsByKey, call, opts = {}) {
  if (!(pathsByKey instanceof Map) || pathsByKey.size === 0) return null;
  const target = (call || '').toUpperCase().trim();
  if (!target) return null;

  const { band = null, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, extractBaseCallsign = null } = opts;
  const targetBase = extractBaseCallsign ? extractBaseCallsign(target) : target;

  let best = null;
  let bestSameBand = false;
  for (const cache of pathsByKey.values()) {
    const paths = cache?.allPaths || cache?.paths;
    if (!Array.isArray(paths)) continue;
    for (const p of paths) {
      if (!Number.isFinite(p?.dxLat) || !Number.isFinite(p?.dxLon)) continue;
      if (!PRECISE_SOURCES.has(p.dxLocSource)) continue;
      if (!Number.isFinite(p.timestamp) || now - p.timestamp > maxAgeMs) continue;
      const pCall = (p.dxCall || '').toUpperCase();
      if (pCall !== target && (!extractBaseCallsign || extractBaseCallsign(pCall) !== targetBase)) continue;

      const freqMHz = parseFloat(p.freq);
      const sameBand = Boolean(band) && Number.isFinite(freqMHz) && getBandFromKHz(freqMHz * 1000) === band;

      // Same-band beats cross-band; within the same tier, newest wins.
      if (!best || (sameBand && !bestSameBand) || (sameBand === bestSameBand && p.timestamp > best.timestamp)) {
        best = p;
        bestSameBand = sameBand;
      }
    }
  }
  if (!best) return null;
  return {
    lat: best.dxLat,
    lon: best.dxLon,
    grid: best.dxGrid || latLonToMaidenhead({ lat: best.dxLat, lon: best.dxLon }),
    country: best.dxCountry || '',
    source: `dxcluster-${best.dxLocSource}`,
  };
}

module.exports = { findClusterSpotLocation, DEFAULT_MAX_AGE_MS };
