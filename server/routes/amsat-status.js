/**
 * AMSAT satellite status board proxy for the AMSAT Status panel.
 *
 * One call to the documented AMSAT status API summary endpoint
 * (https://www.amsat.org/status/api/) returns report counts per satellite
 * per report value over a rolling window. We collapse that into one row
 * per satellite with a "current" status = the report value with the most
 * recent report time (ties go to the higher count).
 *
 * GET /api/amsat/status → { satellites: [...], hours, fetchedAt, source }
 */

const SUMMARY_URL = 'https://www.amsat.org/status/api/v1/summary.php';
const HOURS = 96;
const CACHE_TTL = 30 * 60 * 1000;

// Display order/severity for the status pill (worst-case tie-breaking)
const STATUS_RANK = { 'Crew Active': 0, Heard: 1, 'Telemetry Only': 2, 'Not Heard': 3 };

/**
 * Collapse summary rows ({name, satellite_display_name, report,
 * report_count, latest_reported_time}) into one entry per satellite.
 */
function collapseSummary(rows) {
  const bySat = new Map();
  for (const row of rows) {
    const key = row.satellite_display_name || row.name;
    if (!key) continue;
    let sat = bySat.get(key);
    if (!sat) {
      sat = { name: key, reports: [] };
      bySat.set(key, sat);
    }
    sat.reports.push({
      report: row.report,
      count: row.report_count || 0,
      latest: row.latest_reported_time || null,
    });
  }

  const satellites = [];
  for (const sat of bySat.values()) {
    // Current status: most recent report wins; same-time ties go to count
    const sorted = [...sat.reports].sort((a, b) => {
      const ta = a.latest ? Date.parse(a.latest) : 0;
      const tb = b.latest ? Date.parse(b.latest) : 0;
      if (tb !== ta) return tb - ta;
      return b.count - a.count;
    });
    const current = sorted[0];
    const counts = {};
    let total = 0;
    let lastHeard = null;
    for (const r of sat.reports) {
      counts[r.report] = r.count;
      total += r.count;
      if (r.report === 'Heard' || r.report === 'Crew Active') {
        if (r.latest && (!lastHeard || Date.parse(r.latest) > Date.parse(lastHeard))) lastHeard = r.latest;
      }
    }
    satellites.push({
      name: sat.name,
      status: current?.report || 'Unknown',
      statusTime: current?.latest || null,
      lastHeard,
      counts,
      total,
    });
  }

  // Active/heard birds first, then alphabetical
  satellites.sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 9;
    const rb = STATUS_RANK[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  return satellites;
}

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  let cache = { data: null, timestamp: 0 };

  app.get('/api/amsat/status', async (req, res) => {
    try {
      if (cache.data && Date.now() - cache.timestamp < CACHE_TTL) {
        return res.json(cache.data);
      }
      const data = await ctx.upstream.fetch('amsat:summary', async () => {
        const response = await fetch(`${SUMMARY_URL}?hours=${HOURS}`, {
          headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`AMSAT status responded ${response.status}`);
        const payload = await response.json();
        const satellites = collapseSummary(payload.data || []);
        if (!satellites.length) throw new Error('AMSAT summary empty');
        return {
          satellites,
          hours: HOURS,
          fetchedAt: new Date().toISOString(),
          source: 'amsat.org',
        };
      });
      cache = { data, timestamp: Date.now() };
      logDebug('[AMSAT]', data.satellites.length, 'satellites');
      res.json(data);
    } catch (error) {
      logErrorOnce('AMSAT status', error.message);
      if (cache.data) return res.json({ ...cache.data, stale: true });
      res.status(502).json({ error: 'Failed to fetch AMSAT status' });
    }
  });
};

module.exports.collapseSummary = collapseSummary;
