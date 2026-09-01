/**
 * WebSDR route — receivers from the live KiwiSDR public directory, nearest
 * to the client's DE location, so the 🎧 click-to-listen links can open an
 * actual receiver already tuned to a spot instead of a directory web page.
 *
 * Proxies http://rx.linkfanel.net/kiwisdr_com.js (the machine-readable feed
 * behind the rx.linkfanel.net map — see server/utils/websdrDirectory.js for
 * the shape) with a 30-minute cache, stale-on-error, and a single in-flight
 * fetch shared by all clients — one upstream request per half hour total,
 * never per-user.
 */

const { parseDirectory, pickNearest } = require('../utils/websdrDirectory');

const DIRECTORY_URL = 'http://rx.linkfanel.net/kiwisdr_com.js';
const DIRECTORY_CACHE_TTL = 30 * 60 * 1000;

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  let directoryCache = null; // { entries, timestamp }
  let inFlight = null; // shared promise so concurrent requests trigger one fetch

  const getDirectory = async () => {
    if (directoryCache && Date.now() - directoryCache.timestamp < DIRECTORY_CACHE_TTL) {
      return directoryCache.entries;
    }
    if (!inFlight) {
      inFlight = (async () => {
        const response = await fetch(DIRECTORY_URL, {
          headers: { 'User-Agent': `OpenHamClock/${ctx.CONFIG?.version || '1.0'}` },
        });
        if (!response.ok) throw new Error(`KiwiSDR directory responded ${response.status}`);
        const entries = parseDirectory(await response.text());
        if (entries.length === 0) throw new Error('KiwiSDR directory parsed to zero receivers');
        logDebug(`[WebSDR] KiwiSDR directory: ${entries.length} usable receivers`);
        directoryCache = { entries, timestamp: Date.now() };
        return entries;
      })().finally(() => {
        inFlight = null;
      });
    }
    try {
      return await inFlight;
    } catch (error) {
      // Serve stale rather than failing — receiver geography ages gracefully
      if (directoryCache) return directoryCache.entries;
      throw error;
    }
  };

  // GET /api/websdr/receivers?lat=<num>&lon=<num>
  // → { receivers: [{ url, name, dist_km, users, users_max, snr, bands, coverage, antenna }] }
  app.get('/api/websdr/receivers', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      return res.status(400).json({ error: 'lat and lon must be valid coordinates' });
    }
    try {
      const entries = await getDirectory();
      res.json({ receivers: pickNearest(entries, lat, lon) });
    } catch (error) {
      logErrorOnce('WebSDR', error.message);
      res.status(500).json({ error: 'Failed to fetch KiwiSDR directory' });
    }
  });
};
