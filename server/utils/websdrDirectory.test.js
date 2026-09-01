import { describe, it, expect } from 'vitest';
import { parseBands, parseGps, parseDirectory, pickNearest } from './websdrDirectory.js';

// A miniature kiwisdr_com.js feed exercising the shapes seen in the wild:
// Hz bands (current), kHz bands (historical), offline/inactive entries,
// missing/degenerate GPS, VHF-only coverage, full receivers, trailing comma.
const feedEntry = (overrides) =>
  JSON.stringify({
    updated: 'Friday, 28-Aug-2026 02:26:08 GMT',
    id: 'abc123',
    status: 'active',
    offline: 'no',
    name: 'Test Kiwi',
    bands: '0-30000000',
    users: '1',
    users_max: '8',
    gps: '(50.000000, 8.000000)',
    antenna: 'mini-whip',
    snr: '33,31',
    url: 'http://kiwi.example.com:8073',
    ...overrides,
  });

const makeFeed = (entries) =>
  `// KiwiSDR.com receiver list for dyatlov map maker\nvar kiwisdr_com =\n[\n${entries.join(',\n')},\n]\n;\n`;

describe('parseBands', () => {
  it('converts Hz ranges (current feed) to kHz', () => {
    expect(parseBands('0-30000000')).toEqual({ min_khz: 0, max_khz: 30000 });
    expect(parseBands('50000-30000000')).toEqual({ min_khz: 50, max_khz: 30000 });
    expect(parseBands('144000000-148000000')).toEqual({ min_khz: 144000, max_khz: 148000 });
  });

  it('keeps kHz ranges (historical feed) as kHz', () => {
    expect(parseBands('0-30000')).toEqual({ min_khz: 0, max_khz: 30000 });
    expect(parseBands('144000-148000')).toEqual({ min_khz: 144000, max_khz: 148000 });
  });

  it('returns null for garbage or degenerate ranges', () => {
    expect(parseBands('')).toBeNull();
    expect(parseBands(undefined)).toBeNull();
    expect(parseBands('HF only')).toBeNull();
    expect(parseBands('30000-30000')).toBeNull(); // max <= min
  });
});

describe('parseGps', () => {
  it('parses "(lat, lon)"', () => {
    expect(parseGps('(59.546000, 12.526000)')).toEqual({ lat: 59.546, lon: 12.526 });
    expect(parseGps('(50.74, -2.63)')).toEqual({ lat: 50.74, lon: -2.63 });
  });

  it('rejects missing, malformed, out-of-range, and null-island coords', () => {
    expect(parseGps(undefined)).toBeNull();
    expect(parseGps('somewhere')).toBeNull();
    expect(parseGps('(120.0, 8.0)')).toBeNull();
    expect(parseGps('(0.000000, 0.000000)')).toBeNull();
  });
});

describe('parseDirectory', () => {
  it('parses the feed wrapper and normalizes entries', () => {
    const feed = makeFeed([feedEntry({ url: 'http://kiwi.example.com:8073/' })]);
    const entries = parseDirectory(feed);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      url: 'http://kiwi.example.com:8073', // trailing slash stripped
      name: 'Test Kiwi',
      lat: 50,
      lon: 8,
      users: 1,
      users_max: 8,
      snr: '33,31',
      bands: '0-30000000',
      coverage: { min_khz: 0, max_khz: 30000 },
      antenna: 'mini-whip',
    });
  });

  it('discards offline, inactive, GPS-less, and URL-less entries', () => {
    const feed = makeFeed([
      feedEntry({ name: 'keeper' }),
      feedEntry({ offline: 'yes' }),
      feedEntry({ status: 'inactive' }),
      feedEntry({ gps: '(0.000000, 0.000000)' }),
      feedEntry({ gps: undefined }),
      feedEntry({ url: undefined }),
      feedEntry({ url: 'kiwi.example.com:8073' }), // no scheme
    ]);
    const entries = parseDirectory(feed);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('keeper');
  });

  it('keeps entries with unparsable bands (coverage null, raw preserved)', () => {
    const entries = parseDirectory(makeFeed([feedEntry({ bands: 'HF' })]));
    expect(entries[0].bands).toBe('HF');
    expect(entries[0].coverage).toBeNull();
  });

  it('throws on bodies that are not the feed', () => {
    expect(() => parseDirectory('<html>gateway timeout</html>')).toThrow(/no receiver array/);
    expect(() => parseDirectory('var kiwisdr_com = [ {broken ]')).toThrow(/bad JSON/);
  });
});

describe('pickNearest', () => {
  const entryAt = (name, lat, lon, overrides = {}) => ({
    url: `http://${name}.example.com:8073`,
    name,
    lat,
    lon,
    users: 0,
    users_max: 8,
    snr: '30,30',
    bands: '0-30000000',
    coverage: { min_khz: 0, max_khz: 30000 },
    antenna: null,
    ...overrides,
  });

  it('sorts nearest-first with rounded distances and drops internal fields', () => {
    const picked = pickNearest([entryAt('far', 0, 60), entryAt('near', 50.1, 8.1), entryAt('mid', 52, 13)], 50, 8);
    expect(picked.map((r) => r.name)).toEqual(['near', 'mid', 'far']);
    expect(picked[0].dist_km).toBeLessThan(20);
    expect(picked[0]).not.toHaveProperty('lat');
    expect(picked[0]).not.toHaveProperty('lon');
  });

  it('filters receivers with no free user slots', () => {
    const picked = pickNearest(
      [entryAt('full', 50, 8, { users: 8, users_max: 8 }), entryAt('open', 55, 8, { users: 7, users_max: 8 })],
      50,
      8,
    );
    expect(picked.map((r) => r.name)).toEqual(['open']);
  });

  it('caps the list at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => entryAt(`k${i}`, 50 + i * 0.1, 8));
    expect(pickNearest(many, 50, 8)).toHaveLength(15);
  });

  it('appends nearest VHF-capable receivers when none made the distance cut', () => {
    const hf = Array.from({ length: 20 }, (_, i) => entryAt(`hf${i}`, 50 + i * 0.1, 8));
    const vhfNear = entryAt('vhf-near', 55, 8, {
      bands: '144000000-148000000',
      coverage: { min_khz: 144000, max_khz: 148000 },
    });
    const vhfFar = entryAt('vhf-far', 60, 8, {
      bands: '50000000-52000000',
      coverage: { min_khz: 50000, max_khz: 52000 },
    });
    const picked = pickNearest([...hf, vhfFar, vhfNear], 50, 8);
    expect(picked).toHaveLength(17);
    expect(picked.map((r) => r.name)).toContain('vhf-near');
    expect(picked.map((r) => r.name)).toContain('vhf-far');
  });

  it('does not append extras when a VHF-capable receiver is already nearby', () => {
    const nearVhf = entryAt('wideband', 50.1, 8, {
      bands: '0-52000000',
      coverage: { min_khz: 0, max_khz: 52000 },
    });
    const picked = pickNearest([nearVhf, entryAt('hf', 51, 8)], 50, 8);
    expect(picked).toHaveLength(2);
  });
});
