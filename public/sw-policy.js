/**
 * Service-worker caching policy — pure decision logic, no side effects on
 * the network or caches. This file is the single source of truth:
 *
 *   - public/sw.js loads it via importScripts('/sw-policy.js?v=...')
 *   - src/utils/swPolicy.js imports it (side-effect) and re-exports the
 *     functions so vitest can unit-test the exact code the worker runs.
 *
 * It is written as a classic script (no import/export syntax) that attaches
 * a single object to the global, which is valid both as an importScripts
 * target and as an ES module with a side effect. Keep it dependency-free.
 */
(function (global) {
  'use strict';

  /** Streaming endpoints that must never be intercepted or cached (SSE). */
  var STREAMING_API_PATHS = ['/api/pskreporter/stream', '/api/rig-bridge/relay/stream'];

  /**
   * Same-origin static content that is safe to serve cache-first within a
   * single deployed version (the whole cache is dropped on version change).
   * /assets/* files carry content hashes and are truly immutable.
   */
  var STATIC_ASSET_PREFIXES = ['/assets/', '/icons/', '/geo/', '/models/', '/wasm/'];
  var STATIC_ASSET_FILES = ['/favicon.ico', '/favicon-32x32.png', '/manifest.json'];

  /** Cap on the runtime API cache (simple oldest-first pruning). */
  var API_CACHE_MAX_ENTRIES = 150;

  /**
   * Normalize a version token (from the ?v= registration query param) into
   * something safe to embed in a Cache Storage name.
   */
  function normalizeVersion(raw) {
    var v = String(raw == null ? '' : raw).replace(/[^A-Za-z0-9._-]/g, '_');
    return v || 'dev';
  }

  /** Cache names for a given version token. */
  function cacheNames(version) {
    var v = normalizeVersion(version);
    return {
      app: 'ohc-' + v + '-app', // shell + static assets
      api: 'ohc-' + v + '-api', // runtime /api/* GET responses
    };
  }

  /**
   * Given every Cache Storage name present, return the ohc-* caches that
   * belong to a different version and should be deleted on activate.
   * Non-ohc caches (other apps on the origin, future features) are left alone.
   */
  function staleCacheNames(allNames, version) {
    var names = cacheNames(version);
    var keep = [names.app, names.api];
    return (allNames || []).filter(function (n) {
      return typeof n === 'string' && n.indexOf('ohc-') === 0 && keep.indexOf(n) === -1;
    });
  }

  /** True for API paths that stream (SSE) and must be left to the browser. */
  function isStreamingApiPath(pathname) {
    if (STREAMING_API_PATHS.indexOf(pathname) !== -1) return true;
    // Defensive: any future /api/**/stream endpoint is assumed to be SSE.
    return pathname.indexOf('/api/') === 0 && /\/stream\/?$/.test(pathname);
  }

  /**
   * Classify a fetch-event request into a handling strategy.
   *
   * @param {{url: string, method: string, mode?: string, origin: string}} req
   *   url    - absolute or origin-relative request URL
   *   method - HTTP method
   *   mode   - Request.mode ('navigate' for top-level navigations)
   *   origin - the service worker's own origin (self.location.origin)
   * @returns {'navigation'|'asset'|'api'|'bypass'}
   *   navigation - network-first with cached-shell fallback
   *   asset      - cache-first, cache-on-fetch
   *   api        - network-first with cached fallback (offline resilience)
   *   bypass     - do not call respondWith; browser default behavior
   */
  function classifyRequest(req) {
    if (!req || req.method !== 'GET') return 'bypass';
    var u;
    try {
      u = new URL(req.url, req.origin);
    } catch (e) {
      return 'bypass';
    }
    if (u.origin !== req.origin) return 'bypass'; // cross-origin: tiles, CDNs, etc.
    if (req.mode === 'navigate') return 'navigation';
    var p = u.pathname;
    if (p.indexOf('/api/') === 0) {
      return isStreamingApiPath(p) ? 'bypass' : 'api';
    }
    for (var i = 0; i < STATIC_ASSET_PREFIXES.length; i++) {
      if (p.indexOf(STATIC_ASSET_PREFIXES[i]) === 0) return 'asset';
    }
    if (STATIC_ASSET_FILES.indexOf(p) !== -1) return 'asset';
    return 'bypass';
  }

  /**
   * Whether an API response is safe to store. Rejects errors, partial
   * content, and anything that identifies as an event stream (a streaming
   * endpoint we did not know about by path).
   */
  function isCacheableApiResponse(res) {
    if (!res || !res.ok || res.status === 206) return false;
    var ct = (res.contentType || '').toLowerCase();
    if (ct.indexOf('text/event-stream') !== -1) return false;
    return true;
  }

  /**
   * Oldest-first prune: given cache keys in insertion order, return the
   * entries to delete so at most `max` remain.
   */
  function keysToPrune(keys, max) {
    var limit = typeof max === 'number' ? max : API_CACHE_MAX_ENTRIES;
    if (!keys || keys.length <= limit) return [];
    return keys.slice(0, keys.length - limit);
  }

  global.OHC_SW_POLICY = {
    API_CACHE_MAX_ENTRIES: API_CACHE_MAX_ENTRIES,
    normalizeVersion: normalizeVersion,
    cacheNames: cacheNames,
    staleCacheNames: staleCacheNames,
    isStreamingApiPath: isStreamingApiPath,
    classifyRequest: classifyRequest,
    isCacheableApiResponse: isCacheableApiResponse,
    keysToPrune: keysToPrune,
  };
})(typeof self !== 'undefined' ? self : globalThis);
