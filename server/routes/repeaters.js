/**
 * Repeater directory proxy for the Repeaters panel.
 *
 * Source: hearham.com's open repeater list (one ~9 MB JSON dump, ~22k
 * repeaters worldwide with lat/lon, tone, offset, mode). The dump is
 * fetched at most once per 24 h and held slimmed in memory; requests are
 * answered by a haversine radius filter around the caller's location.
 *
 * GET /api/repeaters?lat=&lon=&radius=<km>&limit=
 *   → { count, radiusKm, repeaters: [...], fetchedAt, source }
 */

const HEARHAM_URL = 'https://hearham.com/api/repeaters/v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const DEFAULT_RADIUS_KM = 100;
const MAX_RADIUS_KM = 500;
const MIN_RADIUS_KM = 5;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

const EARTH_R = 6371;
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Keep only the fields the panel needs; drop rows without coordinates. */
function slimRepeaters(raw) {
  const out = [];
  for (const r of raw) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    if (!Number.isFinite(Number(r.frequency)) || Number(r.frequency) <= 0) continue;
    out.push({
      callsign: r.callsign || '',
      lat,
      lon,
      mhz: Math.round(Number(r.frequency) / 100) / 10000, // Hz → MHz, 4dp
      offsetMhz: Number.isFinite(Number(r.offset)) ? Math.round(Number(r.offset) / 1000) / 1000 : 0,
      tone: r.encode || '',
      mode: r.mode || '',
      city: r.city || '',
      group: r.group || '',
      operational: r.operational !== 0 && r.operational !== false,
    });
  }
  return out;
}

/** Radius filter + sort by distance, annotated with distance/bearing. */
function nearbyRepeaters(all, lat, lon, radiusKm, limit) {
  const hits = [];
  for (const r of all) {
    // Cheap latitude prefilter before the trig
    if (Math.abs(r.lat - lat) * 111 > radiusKm) continue;
    const km = haversineKm(lat, lon, r.lat, r.lon);
    if (km <= radiusKm) hits.push({ ...r, km: Math.round(km * 10) / 10, bearing: bearingDeg(lat, lon, r.lat, r.lon) });
  }
  hits.sort((a, b) => a.km - b.km);
  return hits.slice(0, limit);
}

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };

  async function getDirectory() {
    if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) return cache.data;
    const slim = await ctx.upstream.fetch('repeaters:hearham', async () => {
      const response = await fetch(HEARHAM_URL, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: AbortSignal.timeout(60000), // ~9 MB dump
      });
      if (!response.ok) throw new Error(`hearham responded ${response.status}`);
      const raw = await response.json();
      const slimmed = slimRepeaters(raw);
      if (!slimmed.length) throw new Error('hearham dump empty');
      return slimmed;
    });
    cache = { data: slim, timestamp: Date.now() };
    logDebug('[Repeaters] hearham directory:', slim.length, 'repeaters');
    return slim;
  }

  app.get('/api/repeaters', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ error: 'lat and lon required' });
    }
    const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, Number(req.query.radius) || DEFAULT_RADIUS_KM));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));

    try {
      const all = await getDirectory();
      const repeaters = nearbyRepeaters(all, lat, lon, radiusKm, limit);
      res.json({
        count: repeaters.length,
        radiusKm,
        repeaters,
        fetchedAt: new Date(cache.timestamp).toISOString(),
        source: 'hearham.com',
      });
    } catch (error) {
      logErrorOnce('Repeaters', error.message);
      if (cache.data) {
        const repeaters = nearbyRepeaters(cache.data, lat, lon, radiusKm, limit);
        return res.json({ count: repeaters.length, radiusKm, repeaters, stale: true, source: 'hearham.com' });
      }
      res.status(502).json({ error: 'Failed to fetch repeater directory' });
    }
  });
};

module.exports.slimRepeaters = slimRepeaters;
module.exports.nearbyRepeaters = nearbyRepeaters;
module.exports.haversineKm = haversineKm;
module.exports.bearingDeg = bearingDeg;
