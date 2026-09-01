/**
 * Ionosonde route — live foF2 / MUF(3000) from GIRO digisondes, proxied from
 * KC2G's prop API (https://prop.kc2g.com/api/stations.json).
 *
 * prop.kc2g.com is a free community service run by KC2G — be a good neighbor:
 *   - 10-minute server cache (the digisondes themselves report every ~5-15 min)
 *   - a single in-flight upstream fetch shared by concurrent requests
 *   - stale-on-error: keep serving the last good payload (flagged) for up to
 *     2 hours if the upstream is down
 *   - our own User-Agent so KC2G can see who's calling
 *
 * Upstream shape (verified live 2026-08-28): array of measurement objects —
 *   { fof2, mufd, md, cs, time: "YYYY-MM-DDTHH:MM:SS" (UTC, no Z),
 *     station: { code, name, latitude, longitude (0-360°E) }, ... }
 * We slim that to { code, name, lat, lon, fof2, mufd, cs, time } and drop
 * stations with no foF2 or measurements older than 6 hours (the feed includes
 * long-dead stations with years-old timestamps).
 */

const UPSTREAM_URL = 'https://prop.kc2g.com/api/stations.json';
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // drop measurements older than this

/**
 * Slim the raw KC2G payload to what the panel needs. Pure — exported for tests.
 * @param {Array} raw    upstream JSON array
 * @param {number} nowMs reference time for age filtering
 */
function slimStations(raw, nowMs = Date.now()) {
  if (!Array.isArray(raw)) return [];
  const num = (v) => (v == null || v === '' ? NaN : Number(v)); // Number(null) is 0 — don't let nulls through
  const round4 = (v) => Math.round(v * 10000) / 10000;
  const out = [];
  for (const m of raw) {
    const st = m?.station;
    if (!st?.code) continue;

    const fof2 = num(m.fof2);
    if (!Number.isFinite(fof2)) continue; // no critical frequency → useless row

    // Timestamps arrive without a zone suffix but are UTC.
    const timeStr = typeof m.time === 'string' ? m.time : '';
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(timeStr);
    const t = Date.parse(hasZone ? timeStr : `${timeStr}Z`);
    if (!Number.isFinite(t)) continue;
    const age = nowMs - t;
    if (age > MAX_AGE_MS || age < -30 * 60 * 1000) continue; // dead station / bogus future stamp

    const lat = parseFloat(st.latitude);
    let lon = parseFloat(st.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lon > 180) lon -= 360; // upstream uses 0-360°E

    const mufd = num(m.mufd);
    const cs = num(m.cs);
    out.push({
      code: st.code,
      name: st.name || st.code,
      lat: round4(lat),
      lon: round4(lon),
      fof2,
      mufd: Number.isFinite(mufd) ? mufd : null,
      cs: Number.isFinite(cs) && cs >= 0 ? cs : null, // GIRO confidence score 0-100 (-1 sentinel → null)
      time: new Date(t).toISOString(),
    });
  }
  return out;
}

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce, APP_VERSION } = ctx;

  const CACHE_TTL = 10 * 60 * 1000; // fresh window
  const MAX_STALE = 2 * 60 * 60 * 1000; // stale-on-error window
  let cache = { data: null, timestamp: 0 };
  let inflight = null; // single upstream fetch shared across concurrent requests

  async function fetchUpstream() {
    const response = await fetch(UPSTREAM_URL, {
      headers: {
        'User-Agent': `OpenHamClock/${APP_VERSION}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
    const raw = await response.json();
    const stations = slimStations(raw, Date.now());
    return {
      stations,
      count: stations.length,
      fetched: new Date().toISOString(),
      source: 'prop.kc2g.com (GIRO ionosondes)',
    };
  }

  app.get('/api/ionosonde', async (req, res) => {
    const now = Date.now();
    if (cache.data && now - cache.timestamp < CACHE_TTL) {
      return res.json(cache.data);
    }

    try {
      if (!inflight) {
        inflight = fetchUpstream().finally(() => {
          inflight = null;
        });
      }
      const data = await inflight;
      cache = { data, timestamp: Date.now() };
      logDebug(`[Ionosonde] KC2G: ${data.count} live stations`);
      return res.json(data);
    } catch (error) {
      logErrorOnce('Ionosonde', error.message);
      if (cache.data && now - cache.timestamp < MAX_STALE) {
        return res.json({ ...cache.data, stale: true });
      }
      return res.status(502).json({ error: 'ionosonde data unavailable', stations: [] });
    }
  });
};

module.exports.slimStations = slimStations;
