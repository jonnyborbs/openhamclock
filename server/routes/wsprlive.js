/**
 * WSPR "my spots" proxy for the WSPR My Spots panel.
 *
 * Queries wspr.live (public ClickHouse HTTP endpoint over the full WSPR
 * archive) for receptions of one transmitting callsign in the last 24 h.
 * The query is always time-bounded — unbounded tx_sign scans time out at
 * the wspr.live end. Per-callsign cache (10 min) keeps one instance to a
 * handful of upstream queries per hour. Data courtesy of wspr.live —
 * non-commercial use with attribution, which the panel displays.
 *
 * GET /api/wspr/mine?callsign=K0CJH
 *   → { callsign, count, spots: [...], stats, fetchedAt, source }
 */

const WSPR_LIVE_URL = 'https://db1.wspr.live/';
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;
const QUERY_LIMIT = 500;

// wspr.live `band` column: integer MHz floor of the dial frequency (−1 = LF)
const BAND_NAMES = {
  '-1': '2200m',
  0: '630m',
  1: '160m',
  3: '80m',
  5: '60m',
  7: '40m',
  10: '30m',
  14: '20m',
  18: '17m',
  21: '15m',
  24: '12m',
  28: '10m',
  50: '6m',
  70: '4m',
  144: '2m',
  432: '70cm',
  1296: '23cm',
};

const bandName = (band) => BAND_NAMES[String(band)] || `${band} MHz`;

// Uppercase + strict charset so the value can be inlined into the SQL
// string safely (no quotes or escapes can survive this filter).
function sanitizeCallsign(raw) {
  const call = String(raw || '')
    .trim()
    .toUpperCase();
  return /^[A-Z0-9/-]{3,12}$/.test(call) ? call : null;
}

function buildQuery(callsign) {
  return (
    `SELECT time, band, rx_sign, rx_loc, snr, distance, power, frequency ` +
    `FROM wspr.rx WHERE time > subtractDays(now(), 1) AND tx_sign = '${callsign}' ` +
    `ORDER BY time DESC LIMIT ${QUERY_LIMIT} FORMAT JSON`
  );
}

/** Summarize spots: per-band counts, unique receivers, best DX. */
function summarize(spots) {
  const bands = {};
  const receivers = new Set();
  let maxKm = 0;
  let best = null;
  for (const s of spots) {
    bands[s.band] = (bands[s.band] || 0) + 1;
    receivers.add(s.rx);
    if (s.km > maxKm) {
      maxKm = s.km;
      best = s;
    }
  }
  return {
    bands,
    uniqueReceivers: receivers.size,
    maxKm,
    bestRx: best ? best.rx : null,
  };
}

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  const cache = new Map(); // callsign → { data, timestamp }

  const purge = () => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.timestamp > CACHE_TTL * 6) cache.delete(key);
    }
    while (cache.size > CACHE_MAX_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
  };

  app.get('/api/wspr/mine', async (req, res) => {
    const callsign = sanitizeCallsign(req.query.callsign);
    if (!callsign) {
      return res.status(400).json({ error: 'Valid callsign required' });
    }
    try {
      const cached = cache.get(callsign);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json(cached.data);
      }

      const data = await ctx.upstream.fetch(`wsprlive:${callsign}`, async () => {
        const url = `${WSPR_LIVE_URL}?query=${encodeURIComponent(buildQuery(callsign))}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`wspr.live responded ${response.status}`);
        const payload = await response.json();
        const spots = (payload.data || []).map((row) => ({
          time: row.time.endsWith('Z') ? row.time : row.time.replace(' ', 'T') + 'Z',
          band: bandName(row.band),
          rx: row.rx_sign,
          loc: row.rx_loc,
          snr: row.snr,
          km: row.distance,
          power: row.power,
          mhz: row.frequency ? Math.round(row.frequency) / 1e6 : null,
        }));
        return {
          callsign,
          count: spots.length,
          spots,
          stats: summarize(spots),
          fetchedAt: new Date().toISOString(),
          source: 'wspr.live',
        };
      });

      cache.set(callsign, { data, timestamp: Date.now() });
      purge();
      logDebug('[WSPR mine]', callsign, data.count, 'spots');
      res.json(data);
    } catch (error) {
      logErrorOnce('WSPR mine', error.message);
      const stale = cache.get(callsign);
      if (stale) return res.json({ ...stale.data, stale: true });
      res.status(502).json({ error: 'Failed to query wspr.live' });
    }
  });
};

module.exports.sanitizeCallsign = sanitizeCallsign;
module.exports.buildQuery = buildQuery;
module.exports.bandName = bandName;
module.exports.summarize = summarize;
