/**
 * Band-opening detection routes.
 *
 * GET /api/band-openings — per (band × continent-pair) activity surges,
 * computed from the spot streams the server already holds in memory:
 *
 *   • RBN telnet stream  — ctx.rbnSpotsByDX (exported by routes/rbn.js;
 *     fills autonomously, ~30 min retention)
 *   • DX cluster paths   — ctx.dxSpotPathsCacheByKey (exported by
 *     routes/dxcluster.js; populated while clients poll /api/dxpaths,
 *     ~1 h accumulator)
 *
 * Both caches are read-only here — this module never mutates them. A 60 s
 * background sampler ingests snapshots into the analysis tracker (which
 * dedupes on stable spot ids), so short-retention caches still build up the
 * 3 h baseline. Analysis itself is pure: server/utils/bandOpenings.js.
 *
 * Continents come from the synchronous cty.dat lookup with a coarse
 * prefix-table fallback (server/utils/continent.js) — never the async,
 * quota-bound QRZ/HamQTH chain.
 */

const { createBandOpeningTracker } = require('../utils/bandOpenings');
const { continentForCall } = require('../utils/continent');
const { getBandFromHz } = require('../utils/grid');

let ctyLookupCall = null;
try {
  ({ lookupCall: ctyLookupCall } = require('../../src/server/ctydat.js'));
} catch {
  /* cty module unavailable — coarse prefix fallback still works */
}

const SAMPLE_INTERVAL_MS = 60 * 1000; // ingest + recompute cadence (and response cache TTL)
const BASELINE_WINDOW_MS = 3 * 60 * 60 * 1000;
const CONTINENT_CACHE_MAX = 20000;

module.exports = function (app, ctx) {
  const { logDebug, logErrorOnce } = ctx;

  const tracker = createBandOpeningTracker();
  const startedAt = Date.now();

  // Continent lookups are cheap but not free (longest-prefix scans); the same
  // calls repeat constantly in spot traffic, so memoize.
  const continentCache = new Map(); // call → continent|null
  function contFor(call) {
    if (!call) return null;
    const upper = String(call).toUpperCase();
    if (continentCache.has(upper)) return continentCache.get(upper);
    const cont = continentForCall(upper, ctyLookupCall);
    if (continentCache.size >= CONTINENT_CACHE_MAX) {
      const oldest = continentCache.keys().next().value;
      if (oldest !== undefined) continentCache.delete(oldest);
    }
    continentCache.set(upper, cont);
    return cont;
  }

  // Snapshot the in-memory spot stores into the tracker's spot shape.
  // fromContinent = DX (transmitting) station, toContinent = spotter/skimmer.
  function collectSpots() {
    const out = [];

    // RBN telnet stream — Map<dxCall, spot[]>
    const rbnMap = ctx.rbnSpotsByDX;
    if (rbnMap instanceof Map) {
      for (const [dxCall, spots] of rbnMap) {
        if (!Array.isArray(spots)) continue;
        for (const s of spots) {
          out.push({
            id: `rbn|${s.callsign}|${dxCall}|${s.frequency}|${s.timestampMs}`,
            call: dxCall,
            band: s.band,
            fromContinent: contFor(dxCall),
            toContinent: contFor(s.callsign),
            timestamp: s.timestampMs,
          });
        }
      }
    }

    // DX cluster path accumulator — Map<cacheKey, { allPaths, paths }>
    const pathsByKey = ctx.dxSpotPathsCacheByKey;
    if (pathsByKey instanceof Map) {
      for (const cache of pathsByKey.values()) {
        const paths = cache?.allPaths || cache?.paths;
        if (!Array.isArray(paths)) continue;
        for (const p of paths) {
          const freqMHz = parseFloat(p.freq);
          if (!Number.isFinite(freqMHz) || freqMHz <= 0) continue;
          out.push({
            id: `dxc|${p.id || `${p.dxCall}|${p.spotter}|${p.freq}|${p.timestamp}`}`,
            call: p.dxCall,
            band: getBandFromHz(freqMHz * 1e6),
            fromContinent: contFor(p.dxCall),
            toContinent: contFor(p.spotter),
            timestamp: p.timestamp,
          });
        }
      }
    }

    return out;
  }

  let cachedPayload = null;
  let lastComputedAt = 0;

  function recompute(now = Date.now()) {
    try {
      const accepted = tracker.ingest(collectSpots(), now);
      const openings = tracker.analyze(now);
      const uptimeMs = now - startedAt;
      // Warming until we either have 3 h of uptime or the observed spot
      // history already spans the full baseline window (cluster paths can
      // carry timestamps older than the process).
      const warming = uptimeMs < BASELINE_WINDOW_MS && !tracker.hasFullBaseline(now);
      const s = tracker.stats();
      cachedPayload = {
        generated_at: new Date(now).toISOString(),
        warming,
        baseline_coverage_seconds: Math.round(tracker.dataSpanMs(now) / 1000),
        tracked: { pairs: s.keys, spots: s.spots },
        openings,
      };
      lastComputedAt = now;
      if (accepted > 0 || openings.length > 0) {
        logDebug(`[BandOpenings] +${accepted} spots, ${s.keys} pairs, ${openings.length} openings`);
      }
    } catch (err) {
      logErrorOnce('BandOpenings', err.message);
    }
    return cachedPayload;
  }

  // Background sampler: keeps ingesting even when nobody polls the endpoint,
  // so the 3 h baseline survives the RBN cache's 30 min retention.
  const sampler = setInterval(() => recompute(), SAMPLE_INTERVAL_MS);
  if (sampler.unref) sampler.unref();
  // First sample shortly after boot (give RBN telnet a moment to authenticate).
  const primer = setTimeout(() => recompute(), 15 * 1000);
  if (primer.unref) primer.unref();

  app.get('/api/band-openings', (req, res) => {
    const now = Date.now();
    // Recomputed at most every SAMPLE_INTERVAL_MS; the background sampler
    // normally keeps this fresh, so requests just serve the cached payload.
    if (!cachedPayload || now - lastComputedAt >= SAMPLE_INTERVAL_MS) {
      recompute(now);
    }
    res.set('Cache-Control', 'no-store');
    res.json(
      cachedPayload || {
        generated_at: new Date(now).toISOString(),
        warming: true,
        baseline_coverage_seconds: 0,
        tracked: { pairs: 0, spots: 0 },
        openings: [],
      },
    );
  });

  return { bandOpeningTracker: tracker };
};
