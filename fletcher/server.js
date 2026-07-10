/**
 * Fletcher — internal Railway service.
 *
 * Bridges HTTP fetch traffic from a dedicated Railway service so that upstream
 * sees this service's egress IP, rather than OpenHamClock's.
 * Confirmed 2026-06-03 that separate Railway services in
 * the same project get separate egress IPs (#1057).
 *
 * Reachable on Railway's private network at:
 *   http://fletcher.railway.internal:${PORT}
 *
 * Endpoints:
 *   GET /health                 — liveness probe
 *   GET /stats                  — cache + counter snapshot
 *   GET /celestrak/<path>?<qs>  — relays to https://celestrak.org/<path>?<qs>
 *   GET /amsat/<path>?<qs>      — relays to https://www.amsat.org/<path>?<qs>
 *   GET /satnogs/<path>?<qs>    — relays to https://db.satnogs.org/<path>?<qs>
 *
 * Caching: in-memory TTL (default 10 min). On upstream error, stale entries
 * are returned with X-Cache: STALE so openhamclock can degrade gracefully.
 */

const http = require('http');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '::'; // IPv6 — required for Railway private networking
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS, 10) || 20_000;
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS, 10) || 10 * 60 * 1000;

const UPSTREAMS = {
  celestrak: 'https://celestrak.org',
  amsat: 'https://www.amsat.org',
  satnogs: 'https://db.satnogs.org',
};

const cache = new Map(); // key -> { expires, status, body, contentType }

const now = () => Date.now();

const stats = {
  startedAt: now(),
  totalRequests: 0,
  cacheHits: 0,
  upstreamHits: 0,
  upstreamFails: 0,
  staleServed: 0,
  byUpstream: { celestrak: 0, amsat: 0, satnogs: 0 },
};

const log = (level, msg) => {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
};

async function fetchUpstream(targetUrl, inboundUserAgent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': inboundUserAgent || 'OpenHamClock-Fletcher/1.0',
      },
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      status: res.status,
      body,
      contentType: res.headers.get('content-type') || 'text/plain; charset=utf-8',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function relay(upstreamName, targetUrl, req, res) {
  stats.totalRequests++;
  stats.byUpstream[upstreamName] = (stats.byUpstream[upstreamName] || 0) + 1;

  const cacheKey = `${upstreamName}\0${targetUrl}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expires > now()) {
    stats.cacheHits++;
    res.writeHead(cached.status, {
      'Content-Type': cached.contentType,
      'X-Cache': 'HIT',
      'X-Upstream': upstreamName,
    });
    return res.end(cached.body);
  }

  try {
    const result = await fetchUpstream(targetUrl, req.headers['user-agent']);
    stats.upstreamHits++;

    if (result.status >= 200 && result.status < 300) {
      cache.set(cacheKey, { ...result, expires: now() + CACHE_TTL_MS });
    }

    res.writeHead(result.status, {
      'Content-Type': result.contentType,
      'X-Cache': 'MISS',
      'X-Upstream': upstreamName,
    });
    res.end(result.body);
  } catch (err) {
    stats.upstreamFails++;
    log('WARN', `${upstreamName} fetch failed (${targetUrl}): ${err.message}`);

    if (cached) {
      stats.staleServed++;
      res.writeHead(cached.status, {
        'Content-Type': cached.contentType,
        'X-Cache': 'STALE',
        'X-Upstream': upstreamName,
      });
      return res.end(cached.body);
    }

    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `${upstreamName} unreachable`, message: err.message }));
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET, HEAD' });
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, uptimeMs: now() - stats.startedAt }));
  }

  if (url.pathname === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ...stats, cacheSize: cache.size, uptimeMs: now() - stats.startedAt }, null, 2));
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const upstreamName = segments[0];
  const upstreamBase = UPSTREAMS[upstreamName];

  if (upstreamBase) {
    const rest = segments.slice(1).join('/');
    let target;
    try {
      target = new URL(`${rest}${url.search}`, `${upstreamBase}/`);
    } catch {
      target = null;
    }
    // The path/query are caller-controlled; the origin must never be.
    if (!target || target.origin !== new URL(upstreamBase).origin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'invalid relay path' }));
    }
    return relay(upstreamName, target.href, req, res);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
});

server.listen(PORT, HOST, () => {
  log('INFO', `TLE Fetcher listening on [${HOST}]:${PORT}`);
  log('INFO', `Upstreams: ${Object.keys(UPSTREAMS).join(', ')}`);
  log('INFO', `Cache TTL: ${CACHE_TTL_MS}ms, fetch timeout: ${FETCH_TIMEOUT_MS}ms`);
});

setInterval(() => {
  const t = now();
  for (const [k, v] of cache) {
    if (v.expires < t) cache.delete(k);
  }
}, 60_000).unref();

const shutdown = (signal) => {
  log('INFO', `Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
