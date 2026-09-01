/**
 * SWPC Alerts route — NOAA Space Weather Prediction Center alerts/watches/warnings.
 * Proxies https://services.swpc.noaa.gov/products/alerts.json with a 5-minute
 * cache and stale-on-error, parsing each product message into structured fields
 * (issue time, product code/serial, alert type, NOAA space weather scale).
 */

const SWPC_ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json';

// Message types in rough priority order — first match on a line start wins.
// "CONTINUED ALERT" (e.g. multi-day electron flux events) is reported as ALERT.
const TYPE_PATTERNS = [
  ['EXTENDED WARNING', /^EXTENDED WARNING:/m],
  ['CANCEL WARNING', /^CANCEL\s+WARNING:/m],
  ['CANCEL WATCH', /^CANCEL\s+WATCH:/m],
  ['ALERT', /^CONTINUED ALERT:/m],
  ['ALERT', /^ALERT:/m],
  ['WARNING', /^WARNING:/m],
  ['WATCH', /^WATCH:/m],
  ['SUMMARY', /^SUMMARY:/m],
];

/**
 * Parse a raw SWPC product into a structured alert object.
 * Message text looks like:
 *   Space Weather Message Code: ALTK07
 *   Serial Number: 123
 *   Issue Time: 2026 Aug 27 0615 UTC
 *   ALERT: Geomagnetic K-index of 7
 *   ...
 *   NOAA Scale: G3 - Strong
 */
function parseAlert(product) {
  const message = product.message || '';

  const codeMatch = message.match(/^Space Weather Message Code:\s*(\S+)/m);
  const serialMatch = message.match(/^Serial Number:\s*(\d+)/m);

  // Alert type + headline (text after the "TYPE:" tag on the same line)
  let type = 'MESSAGE';
  let title = '';
  for (const [name, re] of TYPE_PATTERNS) {
    const m = message.match(re);
    if (m) {
      type = name;
      const lineStart = message.indexOf(m[0]);
      const lineEnd = message.indexOf('\n', lineStart);
      title = message.slice(lineStart + m[0].length, lineEnd === -1 ? undefined : lineEnd).trim();
      break;
    }
  }

  // NOAA space weather scale: "NOAA Scale: G2 - Moderate" (may be "None" or absent).
  // WATCH products phrase it differently: "WATCH: Geomagnetic Storm Category G2 Predicted".
  let scale = null;
  const scaleMatch =
    message.match(/^NOAA Scale:\s*([RSG])([1-5])(?:\s*-\s*(.+))?$/m) ||
    // Fallback for active watches only — cancellations must not report a live scale
    (type === 'WATCH' ? message.match(/Category\s+([RSG])([1-5])/) : null);
  if (scaleMatch) {
    scale = {
      band: scaleMatch[1], // R = radio blackout, S = solar radiation, G = geomagnetic storm
      level: parseInt(scaleMatch[2], 10),
      text: `${scaleMatch[1]}${scaleMatch[2]}${scaleMatch[3] ? ` - ${scaleMatch[3].trim()}` : ''}`,
    };
  }

  // issue_datetime is "YYYY-MM-DD HH:MM:SS.mmm" in UTC
  const issueTime = product.issue_datetime ? `${product.issue_datetime.replace(' ', 'T')}Z` : null;

  return {
    productId: codeMatch ? codeMatch[1] : product.product_id || null,
    serial: serialMatch ? parseInt(serialMatch[1], 10) : null,
    issueTime,
    type,
    title,
    scale,
    message,
  };
}

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  // Single-entry cache, 5 minute TTL, stale-on-error
  let alertsCache = null; // { data, timestamp }
  const ALERTS_CACHE_TTL = 5 * 60 * 1000;

  // Listeners notified with the parsed alert array after every FRESH upstream
  // fetch (never on cache hits or stale-on-error). Consumers: the Web Push
  // route (server/routes/push.js) watches for new severe alerts to broadcast.
  const refreshListeners = [];

  /**
   * Fetch + parse SWPC alerts through the shared cache. Returns the cached
   * array when fresh; otherwise hits upstream, refreshes the cache and
   * notifies listeners. Throws only when upstream fails AND no stale cache
   * exists (callers decide how to surface that).
   */
  async function refreshSwpcAlerts() {
    if (alertsCache && Date.now() - alertsCache.timestamp < ALERTS_CACHE_TTL) {
      return alertsCache.data;
    }

    try {
      const response = await fetch(SWPC_ALERTS_URL, {
        headers: { 'User-Agent': `OpenHamClock/${ctx.CONFIG?.version || '1.0'}` },
      });
      if (!response.ok) throw new Error(`SWPC responded ${response.status}`);
      const json = await response.json();

      const alerts = (Array.isArray(json) ? json : [])
        .map(parseAlert)
        .filter((a) => a.issueTime)
        .sort((a, b) => new Date(b.issueTime) - new Date(a.issueTime))
        .slice(0, 50);

      logDebug(`[SWPC] Alerts: ${alerts.length} products`);
      alertsCache = { data: alerts, timestamp: Date.now() };
      for (const cb of refreshListeners) {
        try {
          cb(alerts);
        } catch (err) {
          logErrorOnce('SWPC-Alerts-Listener', err.message);
        }
      }
      return alerts;
    } catch (error) {
      logErrorOnce('SWPC-Alerts', error.message);
      // Serve stale cache rather than failing — alerts age gracefully
      if (alertsCache) return alertsCache.data;
      throw error;
    }
  }

  app.get('/api/swpc/alerts', async (req, res) => {
    try {
      const cachedBefore = alertsCache; // to detect cache-served responses (fresh hit or stale-on-error)
      const alerts = await refreshSwpcAlerts();
      if (cachedBefore && alerts === cachedBefore.data) res.set('Cache-Control', 'no-store');
      res.json(alerts);
    } catch {
      res.status(500).json({ error: 'Failed to fetch SWPC alerts' });
    }
  });

  return {
    refreshSwpcAlerts,
    /** Register a callback invoked with the alert array after each fresh fetch. */
    onSwpcAlertsRefreshed(cb) {
      if (typeof cb === 'function') refreshListeners.push(cb);
    },
  };
};
