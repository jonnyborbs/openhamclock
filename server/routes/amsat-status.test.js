/**
 * Tests for server/routes/amsat-status.js — the AMSAT status board proxy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./amsat-status.js');
const { collapseSummary } = route;

const row = (name, report, count, latest) => ({
  name: name.replace(/\s/g, '_'),
  satellite_display_name: name,
  report,
  report_count: count,
  latest_reported_time: latest,
});

describe('collapseSummary', () => {
  it('picks the most recent report as current status and tracks lastHeard', () => {
    const sats = collapseSummary([
      row('SO-50 [FM]', 'Heard', 40, '2026-08-28T10:00:00Z'),
      row('SO-50 [FM]', 'Not Heard', 3, '2026-08-28T16:00:00Z'),
    ]);
    expect(sats).toHaveLength(1);
    expect(sats[0].status).toBe('Not Heard'); // more recent wins over higher count
    expect(sats[0].lastHeard).toBe('2026-08-28T10:00:00Z');
    expect(sats[0].counts).toEqual({ Heard: 40, 'Not Heard': 3 });
    expect(sats[0].total).toBe(43);
  });

  it('breaks same-time ties by count', () => {
    const sats = collapseSummary([
      row('AO-91 [FM]', 'Heard', 60, '2026-08-28T12:00:00Z'),
      row('AO-91 [FM]', 'Not Heard', 2, '2026-08-28T12:00:00Z'),
    ]);
    expect(sats[0].status).toBe('Heard');
  });

  it('sorts heard/active birds before not-heard, then alphabetically', () => {
    const sats = collapseSummary([
      row('ZZ-1', 'Not Heard', 5, '2026-08-28T12:00:00Z'),
      row('ISS [FM]', 'Crew Active', 2, '2026-08-28T12:00:00Z'),
      row('AA-1', 'Heard', 9, '2026-08-28T12:00:00Z'),
    ]);
    expect(sats.map((s) => s.name)).toEqual(['ISS [FM]', 'AA-1', 'ZZ-1']);
  });
});

describe('GET /api/amsat/status (route)', () => {
  let handler;
  let ctx;
  const stubApp = { get: (path, fn) => (handler = fn) };
  const runRequest = async () => {
    let body;
    let code = 200;
    const res = {
      json: (b) => (body = b),
      status: (c) => {
        code = c;
        return res;
      },
    };
    await handler({}, res);
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

  it('serves collapsed satellites and caches', async () => {
    ctx.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [row('SO-50 [FM]', 'Heard', 12, '2026-08-28T12:00:00Z')] }),
    });
    route(stubApp, ctx);
    const { body } = await runRequest();
    expect(body.satellites[0].name).toBe('SO-50 [FM]');
    expect(body.source).toBe('amsat.org');
    await runRequest();
    expect(ctx.fetch).toHaveBeenCalledTimes(1);
  });

  it('502s on empty payload with no cache', async () => {
    ctx.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) });
    route(stubApp, ctx);
    expect((await runRequest()).code).toBe(502);
  });
});
