/**
 * CANParks routes — canparks.ca (Canadian parks program) spots + park directory.
 *
 * Follows the POTA/WWFF proxy conventions in spots.js: short spots cache
 * (90s, longer than the 60–120s frontend poll), stale-on-error fallback
 * (up to 10 min), and a single in-flight upstream request so a thundering
 * herd of clients costs canparks.ca one fetch.
 *
 * The spot feed carries no coordinates — each spot is enriched from the
 * parks directory (11k+ records, cached 24h, indexed by reference) with
 * lat/lon/grid/name and the POTA/WWFF cross-references. The directory is
 * served slimmed at /api/canparks/parks (URLs/city dropped).
 */
const { normalizeSpot, slimPark, buildParkIndex } = require('../utils/canparks');

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce, APP_VERSION } = ctx;

  const UPSTREAM_HEADERS = {
    'User-Agent': `OpenHamClock/${APP_VERSION} (+https://openhamclock.com)`,
    Accept: 'application/json',
  };

  const SPOTS_TTL = 90 * 1000; // 90 seconds
  const SPOTS_STALE_MAX = 10 * 60 * 1000; // serve stale on upstream error up to 10 min
  const PARKS_TTL = 24 * 60 * 60 * 1000; // 1 day

  let spotsCache = { data: null, timestamp: 0 };
  let spotsInFlight = null;
  let parksCache = { slim: null, index: null, timestamp: 0 };
  let parksInFlight = null;

  async function refreshParks() {
    const response = await fetch('https://api.canparks.ca/parks', { headers: UPSTREAM_HEADERS });
    if (!response.ok) throw new Error(`parks HTTP ${response.status}`);
    const payload = await response.json();
    const parks = Array.isArray(payload) ? payload : Array.isArray(payload?.parks) ? payload.parks : [];
    const slim = parks.map(slimPark).filter(Boolean);
    if (slim.length === 0) throw new Error('parks directory empty/unrecognized');
    parksCache = { slim, index: buildParkIndex(slim), timestamp: Date.now() };
    logDebug(`[CANParks] Parks directory refreshed: ${slim.length} parks`);
    return parksCache;
  }

  // 24h-cached, single in-flight, never throws — spots enrichment degrades
  // gracefully to un-enriched spots when the directory is unavailable.
  async function getParks() {
    if (parksCache.slim && Date.now() - parksCache.timestamp < PARKS_TTL) return parksCache;
    if (!parksInFlight) {
      parksInFlight = refreshParks().finally(() => {
        parksInFlight = null;
      });
    }
    try {
      return await parksInFlight;
    } catch (error) {
      logErrorOnce('CANParks', `parks fetch failed: ${error.message}`);
      // Stale directory beats none at all (parks move rarely).
      return parksCache.slim ? parksCache : { slim: null, index: null, timestamp: 0 };
    }
  }

  async function refreshSpots() {
    const { index } = await getParks(); // never throws
    const response = await fetch('https://api.canparks.ca/spots', { headers: UPSTREAM_HEADERS });
    if (!response.ok) throw new Error(`spots HTTP ${response.status}`);
    const payload = await response.json();
    const rawSpots = Array.isArray(payload) ? payload : Array.isArray(payload?.spots) ? payload.spots : [];

    const spots = [];
    for (const raw of rawSpots) {
      const spot = normalizeSpot(raw, index);
      if (spot) {
        spots.push(spot);
      } else {
        // The feed is young — log the first unrecognized shape (deduped by
        // logErrorOnce) so staging logs teach us the real schema.
        logErrorOnce('CANParks', `Unrecognized spot shape: ${JSON.stringify(raw).slice(0, 400)}`);
      }
    }
    if (spots.length > 0) logDebug(`[CANParks] API returned ${spots.length} spots.`);

    const data = {
      ok: true,
      generated_at: payload?.generated_at || new Date().toISOString(),
      count: spots.length,
      spots,
    };
    spotsCache = { data, timestamp: Date.now() };
    return data;
  }

  // CANParks Spots
  app.get('/api/canparks/spots', async (req, res) => {
    try {
      // Return cached data if fresh
      if (spotsCache.data && Date.now() - spotsCache.timestamp < SPOTS_TTL) {
        res.set('Cache-Control', 'no-store');
        return res.json(spotsCache.data);
      }

      // Single in-flight upstream fetch shared by concurrent requests
      if (!spotsInFlight) {
        spotsInFlight = refreshSpots().finally(() => {
          spotsInFlight = null;
        });
      }
      const data = await spotsInFlight;

      res.set('Cache-Control', 'no-store');
      res.json(data);
    } catch (error) {
      logErrorOnce('CANParks', error.message);
      // Return stale cache on error, but only if less than 10 minutes old
      if (spotsCache.data && Date.now() - spotsCache.timestamp < SPOTS_STALE_MAX) return res.json(spotsCache.data);
      res.status(500).json({ error: 'Failed to fetch CANParks spots' });
    }
  });

  // CANParks parks directory (slimmed — reference/name/grid/coords/cross-refs)
  app.get('/api/canparks/parks', async (req, res) => {
    const parks = await getParks();
    if (!parks.slim || parks.slim.length === 0) {
      return res.status(503).json({ error: 'CANParks park directory unavailable' });
    }
    res.json({ ok: true, total: parks.slim.length, parks: parks.slim });
  });

  // Prime the directory cache at boot (same pattern as SOTA's summit list)
  getParks();
};
