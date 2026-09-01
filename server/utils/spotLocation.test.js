import { describe, expect, it } from 'vitest';
import { findClusterSpotLocation, DEFAULT_MAX_AGE_MS } from './spotLocation.js';

const NOW = 1_800_000_000_000;

// Minimal base-call normalizer matching callsign.js behavior for these cases.
function extractBaseCallsign(raw) {
  const upper = String(raw || '').toUpperCase();
  const parts = upper.split('/');
  if (parts.length === 1) return upper;
  // strip /P, /M, /QRP, /digit suffixes; otherwise pick the longer chunk
  if (/^(P|M|MM|AM|QRP|\d)$/.test(parts[1] || '')) return parts[0];
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

function path(overrides = {}) {
  return {
    dxCall: 'VK2IO/P',
    dxLat: -33.1,
    dxLon: 151.2,
    dxGrid: 'QF57',
    dxCountry: 'Australia',
    dxLocSource: 'grid',
    freq: '1.810', // 160m
    timestamp: NOW - 5 * 60 * 1000,
    ...overrides,
  };
}

function cacheOf(...paths) {
  return new Map([['auto', { allPaths: paths, paths: paths.slice(0, 2), timestamp: NOW }]]);
}

describe('findClusterSpotLocation', () => {
  it('finds a grid-sourced cluster spot for the exact callsign', () => {
    const loc = findClusterSpotLocation(cacheOf(path()), 'VK2IO/P', { now: NOW });
    expect(loc).toMatchObject({ lat: -33.1, lon: 151.2, grid: 'QF57', country: 'Australia', source: 'dxcluster-grid' });
  });

  it('matches the portable variant through the base callsign (VK2IO ↔ VK2IO/P)', () => {
    const loc = findClusterSpotLocation(cacheOf(path()), 'VK2IO', { now: NOW, extractBaseCallsign });
    expect(loc).not.toBeNull();
    expect(loc.grid).toBe('QF57');
    // ...and without a base-call normalizer the exact-match rule applies
    expect(findClusterSpotLocation(cacheOf(path()), 'VK2IO', { now: NOW })).toBeNull();
  });

  it('ignores imprecise location sources (prefix centroids, hamqth home QTH)', () => {
    const cache = cacheOf(
      path({ dxLocSource: 'prefix' }),
      path({ dxLocSource: 'prefix-grid' }),
      path({ dxLocSource: 'hamqth-dxcc' }),
    );
    expect(findClusterSpotLocation(cache, 'VK2IO/P', { now: NOW })).toBeNull();
  });

  it('accepts dxpedition-sourced locations', () => {
    const loc = findClusterSpotLocation(cacheOf(path({ dxLocSource: 'dxpedition', dxGrid: null })), 'VK2IO/P', {
      now: NOW,
    });
    expect(loc.source).toBe('dxcluster-dxpedition');
    expect(typeof loc.grid).toBe('string'); // derived from lat/lon when the path has none
  });

  it('ignores spots older than the max age', () => {
    const stale = path({ timestamp: NOW - DEFAULT_MAX_AGE_MS - 1000 });
    expect(findClusterSpotLocation(cacheOf(stale), 'VK2IO/P', { now: NOW })).toBeNull();
  });

  it('prefers a same-band spot over a newer cross-band spot', () => {
    const cache = cacheOf(
      path({ freq: '14.044', dxGrid: 'QF56', timestamp: NOW - 60 * 1000 }), // 20m, newer
      path({ freq: '1.810', dxGrid: 'QF57', timestamp: NOW - 20 * 60 * 1000 }), // 160m, older
    );
    const loc = findClusterSpotLocation(cache, 'VK2IO/P', { now: NOW, band: '160m' });
    expect(loc.grid).toBe('QF57');
  });

  it('falls back to the newest spot on any band when no same-band spot exists', () => {
    const cache = cacheOf(
      path({ freq: '14.044', dxGrid: 'QF56', timestamp: NOW - 60 * 1000 }),
      path({ freq: '7.030', dxGrid: 'QF55', timestamp: NOW - 30 * 60 * 1000 }),
    );
    const loc = findClusterSpotLocation(cache, 'VK2IO/P', { now: NOW, band: '160m' });
    expect(loc.grid).toBe('QF56'); // newest wins across bands
  });

  it('handles missing/invalid inputs safely', () => {
    expect(findClusterSpotLocation(null, 'VK2IO')).toBeNull();
    expect(findClusterSpotLocation(new Map(), 'VK2IO')).toBeNull();
    expect(findClusterSpotLocation(cacheOf(path()), '')).toBeNull();
    expect(findClusterSpotLocation(cacheOf(path({ dxLat: null })), 'VK2IO/P', { now: NOW })).toBeNull();
    expect(findClusterSpotLocation(new Map([['k', {}]]), 'VK2IO/P')).toBeNull();
  });

  it('searches across multiple cache keys (custom/proxy/auto profiles)', () => {
    const cache = new Map([
      ['auto', { allPaths: [] }],
      ['proxy', { allPaths: [path({ dxGrid: 'QF58' })] }],
    ]);
    expect(findClusterSpotLocation(cache, 'VK2IO/P', { now: NOW }).grid).toBe('QF58');
  });
});
