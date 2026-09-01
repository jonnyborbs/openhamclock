/**
 * Tests for server/routes/dxcluster.js — summarizeSpotHistory, the pure
 * aggregation behind GET /api/dxcluster/spot-history/:callsign (exported on
 * the module for tests, same pattern as routes/ionosonde.js).
 */
import { describe, expect, it } from 'vitest';

const { summarizeSpotHistory } = require('./dxcluster.js');

const NOW = Date.parse('2026-08-28T12:00:00Z');
const HOUR = 60 * 60 * 1000;

const path = (over = {}) => ({
  dxCall: 'OZ6ABL',
  spotter: 'W1AW',
  freq: '14.074',
  timestamp: NOW - 10 * 60 * 1000,
  id: undefined,
  ...over,
});

const cacheWith = (...paths) => new Map([['key', { allPaths: paths, paths, timestamp: NOW }]]);

describe('summarizeSpotHistory', () => {
  it('returns the empty shape when nothing matches', () => {
    expect(summarizeSpotHistory(new Map(), 'OZ6ABL', NOW)).toEqual({
      call: 'OZ6ABL',
      windowHours: 24,
      count: 0,
      bands: [],
      firstHeard: null,
      lastHeard: null,
    });
  });

  it('counts matching spots with per-band tallies and first/last heard', () => {
    const cache = cacheWith(
      path({ timestamp: NOW - 3 * HOUR, spotter: 'A' }),
      path({ timestamp: NOW - 1 * HOUR, spotter: 'B' }),
      path({ timestamp: NOW - 2 * HOUR, freq: '7.030', spotter: 'C' }),
      path({ dxCall: 'K1ABC', spotter: 'D' }), // different station — ignored
    );
    const out = summarizeSpotHistory(cache, 'OZ6ABL', NOW);
    expect(out.count).toBe(3);
    expect(out.bands).toEqual([
      { band: '20m', count: 2 },
      { band: '40m', count: 1 },
    ]);
    expect(out.firstHeard).toBe(new Date(NOW - 3 * HOUR).toISOString());
    expect(out.lastHeard).toBe(new Date(NOW - 1 * HOUR).toISOString());
  });

  it('matches portable variants via /-segments', () => {
    const cache = cacheWith(
      path({ dxCall: '5Z4/OZ6ABL', spotter: 'A' }),
      path({ dxCall: 'OZ6ABL/P', spotter: 'B' }),
      path({ dxCall: 'OZ6ABLX', spotter: 'C' }), // different call — no substring match
    );
    expect(summarizeSpotHistory(cache, 'OZ6ABL', NOW).count).toBe(2);
  });

  it('drops spots outside the 24 h window', () => {
    const cache = cacheWith(path({ timestamp: NOW - 25 * HOUR }), path({ timestamp: NOW - 23 * HOUR, spotter: 'B' }));
    expect(summarizeSpotHistory(cache, 'OZ6ABL', NOW).count).toBe(1);
  });

  it('dedupes the same spot appearing under several cache keys', () => {
    const p = path({ id: 'spot-1' });
    const map = new Map([
      ['filters-a', { allPaths: [p] }],
      ['filters-b', { allPaths: [{ ...p }] }],
    ]);
    expect(summarizeSpotHistory(map, 'OZ6ABL', NOW).count).toBe(1);
  });

  it('counts unknown-band spots in the total but not in bands', () => {
    const cache = cacheWith(path({ freq: '999.999' }));
    const out = summarizeSpotHistory(cache, 'OZ6ABL', NOW);
    expect(out.count).toBe(1);
    expect(out.bands).toEqual([]);
  });

  it('is case-insensitive on the lookup call', () => {
    expect(summarizeSpotHistory(cacheWith(path()), 'oz6abl', NOW).count).toBe(1);
  });
});
