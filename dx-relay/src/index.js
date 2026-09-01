/**
 * dx-relay — Cloudflare Worker relay for feeds that block datacenter egress IPs.
 *
 * DX-World's Cloudflare protection tarpits/blocks fetches from Railway's IP
 * space regardless of User-Agent, so the hosted OpenHamClock server could
 * never load that news source (self-hosted installs on residential IPs are
 * fine). CF-to-origin fetches from a Worker pass, so the server prefers this
 * relay when DXWORLD_PROXY_URL is set.
 *
 * NOT an open proxy: only the paths in UPSTREAMS are served; everything else
 * is 404. Responses are edge-cached for CACHE_TTL_SECONDS so even a busy
 * fleet costs the origin at most a few requests per cache window.
 */

const UPSTREAMS = {
  '/dxworld-feed': {
    url: 'https://www.dx-world.net/feed/',
    contentType: 'application/rss+xml; charset=utf-8',
  },
};

const CACHE_TTL_SECONDS = 600;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/health') {
      return Response.json({ ok: true, service: 'dx-relay', paths: Object.keys(UPSTREAMS) });
    }

    const upstream = UPSTREAMS[pathname];
    if (!upstream) return new Response('not found', { status: 404 });

    if (env.RELAY_KEY && request.headers.get('x-relay-key') !== env.RELAY_KEY) {
      return new Response('unauthorized', { status: 401 });
    }

    try {
      const res = await fetch(upstream.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OpenHamClock-relay/1.0; +https://openhamclock.com)',
          Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
        cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
      });
      if (!res.ok) {
        return Response.json({ ok: false, upstreamStatus: res.status }, { status: 502 });
      }
      return new Response(res.body, {
        status: 200,
        headers: {
          'Content-Type': upstream.contentType,
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
          'X-Relay': 'dx-relay',
        },
      });
    } catch (err) {
      return Response.json({ ok: false, error: String(err?.message || err) }, { status: 502 });
    }
  },
};
