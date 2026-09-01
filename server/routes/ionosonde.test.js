/**
 * Tests for server/routes/ionosonde.js — the KC2G GIRO ionosonde proxy.
 *
 * Unit-tests slimStations (the pure payload transform) and exercises the
 * route end-to-end against a stub app with an injected ctx.fetch:
 * cache hit (single upstream fetch), stale-on-error, and hard-failure paths.
 */
import { describe, expect, it, vi } from 'vitest';

const route = require('./ionosonde.js');
const { slimStations } = route;

const NOW = Date.parse('2026-08-28T12:00:00Z');

const freshMeasurement = (over = {}) => ({
  fof2: 8.6,
  mufd: 28.827,
  cs: 100,
  time: '2026-08-28T11:52:05', // UTC, no zone suffix — as upstream sends it
  station: { code: 'AU930', name: 'Austin, TX, USA', latitude: '30.4', longitude: '262.3' },
  ...over,
});

describe('slimStations', () => {
  it('slims a fresh station and normalizes 0-360 longitude', () => {
    const out = slimStations([freshMeasurement()], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      code: 'AU930',
      name: 'Austin, TX, USA',
      lat: 30.4,
      lon: -97.7,
      fof2: 8.6,
      mufd: 28.827,
      cs: 100,
      time: '2026-08-28T11:52:05.000Z',
    });
  });

  it('drops stations with no foF2, unparseable time, or missing coordinates', () => {
    const out = slimStations(
      [
        freshMeasurement({ fof2: null }),
        freshMeasurement({ time: 'garbage' }),
        freshMeasurement({ station: { code: 'X', latitude: 'nope', longitude: '10' } }),
        freshMeasurement({ station: null }),
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('drops long-dead stations (the feed keeps years-old measurements)', () => {
    const out = slimStations([freshMeasurement({ time: '2026-03-19T22:10:05' })], NOW);
    expect(out).toEqual([]);
  });

  it('nulls out sentinel confidence scores and missing mufd', () => {
    const out = slimStations([freshMeasurement({ cs: 'nope', mufd: null })], NOW);
    expect(out[0].cs).toBeNull();
    expect(out[0].mufd).toBeNull();
  });

  it('tolerates a non-array payload', () => {
    expect(slimStations(null, NOW)).toEqual([]);
    expect(slimStations({ error: 'x' }, NOW)).toEqual([]);
  });
});

// ─── Route integration against a stub app ────────────────────────────────────

function makeApp() {
  const handlers = {};
  return {
    get: (path, handler) => {
      handlers[`GET ${path}`] = handler;
    },
    handlers,
  };
}

async function callRoute(app, path) {
  const handler = app.handlers[`GET ${path}`];
  let captured;
  const res = {
    json: (body) => {
      captured = { status: 200, body };
      return res;
    },
    status: (code) => ({
      json: (body) => {
        captured = { status: code, body };
        return res;
      },
    }),
  };
  await handler({}, res);
  return captured;
}

const makeCtx = (fetchImpl) => ({
  fetch: fetchImpl,
  logDebug: () => {},
  logErrorOnce: () => {},
  APP_VERSION: 'test',
});

const okResponse = (payload) => ({ ok: true, json: async () => payload });

describe('GET /api/ionosonde', () => {
  it('serves slimmed stations and caches — one upstream fetch for two requests', async () => {
    const app = makeApp();
    const fetchMock = vi.fn().mockResolvedValue(okResponse([freshMeasurement({ time: new Date().toISOString() })]));
    route(app, makeCtx(fetchMock));

    const first = await callRoute(app, '/api/ionosonde');
    expect(first.status).toBe(200);
    expect(first.body.stations).toHaveLength(1);
    expect(first.body.source).toContain('kc2g');
    expect(first.body.stale).toBeUndefined();

    const second = await callRoute(app, '/api/ionosonde');
    expect(second.body).toEqual(first.body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves stale data flagged when the upstream starts failing', async () => {
    const app = makeApp();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse([freshMeasurement({ time: new Date().toISOString() })]))
      .mockRejectedValue(new Error('boom'));
    const ctx = makeCtx(fetchMock);
    route(app, ctx);

    const first = await callRoute(app, '/api/ionosonde');
    expect(first.status).toBe(200);

    // Force the fresh-cache window to lapse so the route re-fetches and fails.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    try {
      const second = await callRoute(app, '/api/ionosonde');
      expect(second.status).toBe(200);
      expect(second.body.stale).toBe(true);
      expect(second.body.stations).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns 502 with an empty station list when there is no cache to fall back on', async () => {
    const app = makeApp();
    route(app, makeCtx(vi.fn().mockRejectedValue(new Error('down'))));
    const result = await callRoute(app, '/api/ionosonde');
    expect(result.status).toBe(502);
    expect(result.body.stations).toEqual([]);
  });
});
