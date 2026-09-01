/**
 * Tests for server/routes/wsprlive.js — the wspr.live "my spots" proxy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./wsprlive.js');
const { sanitizeCallsign, buildQuery, bandName, summarize } = route;

describe('sanitizeCallsign', () => {
  it('accepts real callsigns (uppercased) and portable suffixes', () => {
    expect(sanitizeCallsign('k0cjh')).toBe('K0CJH');
    expect(sanitizeCallsign('EA8/K0CJH')).toBe('EA8/K0CJH');
  });

  it('rejects SQL-dangerous or malformed input', () => {
    expect(sanitizeCallsign("K0'; DROP TABLE--")).toBe(null);
    expect(sanitizeCallsign('')).toBe(null);
    expect(sanitizeCallsign('X')).toBe(null);
    expect(sanitizeCallsign('AVERYLONGCALLSIGN')).toBe(null);
  });
});

describe('buildQuery', () => {
  it('is always time-bounded and limited (unbounded scans time out upstream)', () => {
    const q = buildQuery('K0CJH');
    expect(q).toContain('subtractDays(now(), 1)');
    expect(q).toContain("tx_sign = 'K0CJH'");
    expect(q).toContain('LIMIT 500');
    expect(q).toContain('FORMAT JSON');
  });
});

describe('bandName', () => {
  it('maps wspr.live integer band codes to ham band names', () => {
    expect(bandName(7)).toBe('40m');
    expect(bandName(14)).toBe('20m');
    expect(bandName(-1)).toBe('2200m');
    expect(bandName(1)).toBe('160m');
    expect(bandName(9999)).toBe('9999 MHz');
  });
});

describe('summarize', () => {
  it('counts bands, unique receivers, and best DX', () => {
    const stats = summarize([
      { band: '20m', rx: 'DK6UG', km: 8000 },
      { band: '20m', rx: 'DK6UG', km: 8000 },
      { band: '40m', rx: 'VK7JJ', km: 16000 },
    ]);
    expect(stats.bands).toEqual({ '20m': 2, '40m': 1 });
    expect(stats.uniqueReceivers).toBe(2);
    expect(stats.maxKm).toBe(16000);
    expect(stats.bestRx).toBe('VK7JJ');
  });
});

describe('GET /api/wspr/mine (route)', () => {
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

  it('400s without a valid callsign', async () => {
    route(stubApp, ctx);
    expect((await runRequest({})).code).toBe(400);
    expect((await runRequest({ callsign: "bad'" })).code).toBe(400);
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('maps rows, summarizes, and caches per callsign', async () => {
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              time: '2026-08-28 12:30:00',
              band: 14,
              rx_sign: 'DK6UG',
              rx_loc: 'JN49',
              snr: -18,
              distance: 8123,
              power: 23,
              frequency: 14097123,
            },
          ],
        }),
    });
    route(stubApp, ctx);

    const { body } = await runRequest({ callsign: 'k0cjh' });
    expect(body.callsign).toBe('K0CJH');
    expect(body.count).toBe(1);
    expect(body.spots[0]).toMatchObject({ band: '20m', rx: 'DK6UG', km: 8123, snr: -18 });
    expect(body.spots[0].time).toBe('2026-08-28T12:30:00Z');
    expect(body.stats.uniqueReceivers).toBe(1);
    expect(body.source).toBe('wspr.live');

    await runRequest({ callsign: 'K0CJH' });
    expect(ctx.fetch).toHaveBeenCalledTimes(1); // cached
  });

  it('502s on upstream failure with no cache', async () => {
    ctx.fetch.mockRejectedValue(new Error('down'));
    route(stubApp, ctx);
    expect((await runRequest({ callsign: 'K0CJH' })).code).toBe(502);
  });
});
