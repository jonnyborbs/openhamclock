/**
 * Tests for server/routes/repeaters.js — the hearham repeater directory proxy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./repeaters.js');
const { slimRepeaters, nearbyRepeaters, haversineKm, bearingDeg } = route;

const raw = (over = {}) => ({
  callsign: 'VE7RHS',
  latitude: 49.26973,
  longitude: -123.24992,
  city: 'Vancouver, BC Canada',
  group: 'IRLP',
  mode: 'FM',
  encode: '100.0',
  decode: '100.0',
  frequency: 145270000,
  offset: -600000,
  operational: 1,
  ...over,
});

describe('slimRepeaters', () => {
  it('converts Hz to MHz and keeps the panel fields', () => {
    const [r] = slimRepeaters([raw()]);
    expect(r.mhz).toBe(145.27);
    expect(r.offsetMhz).toBe(-0.6);
    expect(r.tone).toBe('100.0');
    expect(r.operational).toBe(true);
  });

  it('drops rows without usable coordinates or frequency', () => {
    expect(slimRepeaters([raw({ latitude: 0, longitude: 0 })])).toEqual([]);
    expect(slimRepeaters([raw({ latitude: 'x' })])).toEqual([]);
    expect(slimRepeaters([raw({ frequency: 0 })])).toEqual([]);
  });
});

describe('nearbyRepeaters', () => {
  const all = slimRepeaters([
    raw(), // Vancouver
    raw({ callsign: 'W0FAR', latitude: 39.0, longitude: -94.5, city: 'KC' }),
  ]);

  it('filters by radius, sorts by distance, annotates km + bearing', () => {
    const hits = nearbyRepeaters(all, 49.2, -123.1, 50, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].callsign).toBe('VE7RHS');
    expect(hits[0].km).toBeGreaterThan(0);
    expect(hits[0].bearing).toBeGreaterThanOrEqual(0);
    expect(hits[0].bearing).toBeLessThan(360);
  });

  it('respects the limit', () => {
    const hits = nearbyRepeaters(all, 45, -110, 5000, 1);
    expect(hits).toHaveLength(1);
  });
});

describe('geometry helpers', () => {
  it('haversine and bearing sanity', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.19, 0);
    expect(bearingDeg(0, 0, 1, 0)).toBe(0); // due north
    expect(bearingDeg(0, 0, 0, 1)).toBe(90); // due east
  });
});

describe('GET /api/repeaters (route)', () => {
  let handler;
  let ctx;
  const stubApp = { get: (path, fn) => (handler = fn) };
  const runRequest = async (query) => {
    let body;
    let code = 200;
    const res = {
      json: (b) => (body = b),
      status: (c) => {
        code = c;
        return res;
      },
    };
    await handler({ query }, res);
    return { body, code };
  };

  beforeEach(() => {
    ctx = {
      fetch: vi.fn(),
      upstream: { fetch: (key, fn) => fn() },
      APP_VERSION: 'test',
      logDebug: () => {},
      logErrorOnce: () => {},
    };
  });

  it('400s without coordinates', async () => {
    route(stubApp, ctx);
    expect((await runRequest({})).code).toBe(400);
    expect((await runRequest({ lat: '99', lon: '0' })).code).toBe(400);
  });

  it('serves nearby repeaters and reuses the cached directory', async () => {
    ctx.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([raw()]) });
    route(stubApp, ctx);

    const { body } = await runRequest({ lat: '49.2', lon: '-123.1', radius: '50' });
    expect(body.count).toBe(1);
    expect(body.repeaters[0].callsign).toBe('VE7RHS');
    expect(body.source).toBe('hearham.com');

    await runRequest({ lat: '49.2', lon: '-123.1' });
    expect(ctx.fetch).toHaveBeenCalledTimes(1); // 24 h directory cache
  });

  it('502s when the directory cannot be fetched', async () => {
    ctx.fetch.mockRejectedValue(new Error('down'));
    route(stubApp, ctx);
    expect((await runRequest({ lat: '49.2', lon: '-123.1' })).code).toBe(502);
  });
});
