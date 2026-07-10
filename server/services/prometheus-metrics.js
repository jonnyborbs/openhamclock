/**
 * Prometheus metrics service.
 *
 * Collects Node.js default metrics and defines custom business metrics.
 * Uses the global default registry — all metrics are exposed by a single
 * /metrics endpoint.
 *
 * Usage in other modules:
 *   const { upstreamFailures } = require('../services/prometheus-metrics');
 *   upstreamFailures.labels('pskreporter').inc();
 */

const client = require('prom-client');
const { logInfo } = require('../utils/logging');

// ── Collect Node.js default metrics ──────────────────────────────────────────
// These include process memory, GC, event loop lag, HTTP request metrics, etc.
// Collected lazily on scrape — zero overhead between scrapes.
client.collectDefaultMetrics({ prefix: 'ohc_' });

// ── Custom metrics ───────────────────────────────────────────────────────────

// Total failed upstream API calls, grouped by service name
const upstreamFailures = new client.Counter({
  name: 'ohc_upstream_failures_total',
  help: 'Total number of failed upstream API calls',
  labelNames: ['service'],
});

// Currently active user sessions (read at scrape time)
let _sessionTracker = null;
const sessionActive = new client.Gauge({
  name: 'ohc_session_active',
  help: 'Currently active user sessions',
  collect() {
    this.set(_sessionTracker?.activeSessions?.size ?? 0);
  },
});

// All-time unique visitors (read at scrape time)
let _visitorStats = null;
const visitorsTotal = new client.Gauge({
  name: 'ohc_visitors_total',
  help: 'All-time unique visitors',
  collect() {
    this.set(_visitorStats?.allTimeVisitors ?? 0);
  },
});

// Today's unique visitors (read at scrape time)
const visitorsToday = new client.Gauge({
  name: 'ohc_visitors_today',
  help: 'Unique visitors today',
  collect() {
    this.set(_visitorStats?.uniqueVisitorsToday ?? 0);
  },
});

// Total API requests (counted per-route)
const apiRequestsTotal = new client.Counter({
  name: 'ohc_api_requests_total',
  help: 'Total API requests',
  labelNames: ['route', 'method', 'status'],
});

// API response duration histogram (seconds)
const apiDuration = new client.Histogram({
  name: 'ohc_api_duration_seconds',
  help: 'API response duration in seconds',
  labelNames: ['route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// API request body size histogram (bytes) — OpenTelemetry http.request.body.size
const apiRequestSize = new client.Histogram({
  name: 'ohc_api_request_body_size_bytes',
  help: 'API request body size in bytes',
  labelNames: ['route'],
  buckets: [0, 64, 256, 1024, 4096, 16384, 65536],
});

// API response body size histogram (bytes) — OpenTelemetry http.response.body.size
const apiResponseSize = new client.Histogram({
  name: 'ohc_api_response_body_size_bytes',
  help: 'API response body size in bytes',
  labelNames: ['route'],
  buckets: [0, 128, 512, 1024, 4096, 16384, 65536, 262144, 1048576],
});

// ── Subsystem health gauges ──────────────────────────────────────────────────
// 1 = ok/unknown, 2 = degraded, 3 = down
// Read at scrape time from ctx

let _subsystemsHealth = null;
const subsystemStatus = new client.Gauge({
  name: 'ohc_subsystem_status',
  help: 'Subsystem health status (1=ok/unknown, 2=degraded, 3=down)',
  labelNames: ['subsystem'],
  collect() {
    if (!_subsystemsHealth) return;
    const severity = { ok: 1, unknown: 1, degraded: 2, down: 3 };
    for (const [name, info] of Object.entries(_subsystemsHealth)) {
      subsystemStatus.labels(name).set(severity[info.status] ?? 1);
    }
  },
});

// ── Extract route patterns from Express app's internal router tree ───────────
// Transforms :param → {param} for each route definition.
// Used at boot to build a lookup for runtime route normalization.

function extractRoutePatterns(app) {
  const patterns = [];

  function traverse(layer) {
    if (layer.route) {
      // Only process string paths (skip RegExp routes, catch-all, etc.)
      if (typeof layer.route.path !== 'string') return;
      if (layer.route.path === '*' || layer.route.path === '/*') return;
      // /api/wsjtx/relay/download/:platform
      //        → /api/wsjtx/relay/download/{platform}
      const normalized = layer.route.path.replace(/\/:([^/]+)/g, '/{$1}');
      patterns.push(normalized);
    }
    // Handle nested routers (express.Router instances)
    if (layer.handle && layer.handle.stack) {
      layer.handle.stack.forEach(traverse);
    }
  }

  app._router.stack.forEach(traverse);
  return patterns;
}

// ── Match a request path against known route patterns ────────────────────────
// Returns the normalized pattern if matched, otherwise returns "{unknown}".
// Unknown routes are grouped together to prevent unbounded time series cardinality.

function normalizeRoute(reqPath, patterns) {
  const segments = reqPath.split('/').filter(Boolean);

  for (const pattern of patterns) {
    const patSegments = pattern.split('/').filter(Boolean);
    if (patSegments.length !== segments.length) continue;

    let match = true;
    for (let i = 0; i < patSegments.length; i++) {
      if (patSegments[i].startsWith('{')) continue; // param — match anything
      if (patSegments[i] !== segments[i]) {
        match = false;
        break;
      }
    }

    if (match) return pattern;
  }

  return '{unknown}'; // group all unknown routes together
}

// ── Middleware: track API requests ───────────────────────────────────────────
// Patterns are extracted lazily on first request to avoid chicken-and-egg
// (middleware must run before routes register, but patterns come from routes).

function apiMetricsMiddleware() {
  let patterns = null;

  return (req, res, next) => {
    // Skip metrics endpoint itself
    if (req.path === '/metrics') return next();

    // Extract patterns on first request (one-time cost, cached thereafter)
    if (!patterns) {
      patterns = extractRoutePatterns(req.app);
      logInfo(`[Prometheus] Extracted ${patterns.length} route patterns from app router`);
    }

    const startTime = Date.now();
    const route = normalizeRoute(req.path, patterns);

    res.on('finish', () => {
      const duration = (Date.now() - startTime) / 1000;
      const isUnknown = route === '{unknown}';

      apiRequestsTotal.labels(route, req.method, String(res.statusCode)).inc();

      // Only record duration/size histograms for known routes.
      if (!isUnknown) {
        apiDuration.labels(route).observe(duration);
        apiRequestSize.labels(route).observe(req.headers['content-length'] ? Number(req.headers['content-length']) : 0);
        apiResponseSize
          .labels(route)
          .observe(res.getHeader('Content-Length') ? Number(res.getHeader('Content-Length')) : 0);
      }
    });

    next();
  };
}

// ── Inject references into collect() functions ───────────────────────────────
// collect() functions use closure variables (_sessionTracker, etc.) instead of
// ctx to avoid circular dependency issues. These are set once at boot.

function setSessionTracker(sessionTracker) {
  _sessionTracker = sessionTracker;
}

function setVisitorStats(visitorStats) {
  _visitorStats = visitorStats;
}

function setSubsystemsHealth(getSubsystems) {
  _subsystemsHealth = null; // reset
  // Snapshot is refreshed every 30s by server/health.js
  setInterval(() => {
    _subsystemsHealth = getSubsystems?.();
  }, 5000).unref(); // read every 5s, stale between scrapes is fine
}

// ── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  // Metrics (exported for direct use in other modules)
  upstreamFailures,
  apiRequestsTotal,
  apiDuration,
  apiRequestSize,
  apiResponseSize,

  // Injectors (call once at boot to wire collect() functions)
  setSessionTracker,
  setVisitorStats,
  setSubsystemsHealth,

  // Middleware
  apiMetricsMiddleware,

  // Route extraction (called from server.js after all routes registered)
  extractRoutePatterns,

  // Registry (for /metrics endpoint)
  registry: client.register,
};
