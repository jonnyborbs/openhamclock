import { describe, it, expect } from 'vitest';
import { tile48, findBestWindows, windowLabel, parseSunHHMM, localHourAt, SKED_HOURS } from './skedPlanner.js';

// Build a 24h hourlyPredictions band array from a sparse {hour: rel} map.
const hours = (map) => Array.from({ length: 24 }, (_, h) => ({ hour: h, reliability: map[h] ?? 0 }));

describe('tile48', () => {
  it('tiles the 24h cycle twice starting at the current hour', () => {
    const tiled = tile48({ '20m': hours({ 0: 10, 5: 50, 23: 90 }) }, 22);
    const slots = tiled['20m'];
    expect(slots).toHaveLength(SKED_HOURS);
    // offset 0 = hour 22 (0%), offset 1 = hour 23 (90%), offset 2 = hour 0 (10%)
    expect(slots[0]).toMatchObject({ offset: 0, utcHour: 22, day: 0, reliability: 0 });
    expect(slots[1]).toMatchObject({ utcHour: 23, reliability: 90 });
    expect(slots[2]).toMatchObject({ utcHour: 0, day: 1, reliability: 10 });
    // Diurnal repeat: offset i and i+24 have the same reliability
    for (let i = 0; i < 24; i++) {
      expect(slots[i + 24].reliability).toBe(slots[i].reliability);
      expect(slots[i + 24].utcHour).toBe(slots[i].utcHour);
    }
  });

  it('handles missing input gracefully', () => {
    expect(tile48(null, 0)).toEqual({});
    const tiled = tile48({ '40m': [] }, 0);
    expect(tiled['40m'].every((s) => s.reliability === 0)).toBe(true);
  });
});

describe('findBestWindows', () => {
  it('finds the top contiguous windows across bands, one per band', () => {
    const tiled = tile48(
      {
        '20m': hours({ 2: 80, 3: 90, 4: 85, 10: 60 }),
        '40m': hours({ 6: 70, 7: 75 }),
        '15m': hours({ 12: 45 }),
      },
      0,
    );
    const wins = findBestWindows(tiled, { maxWindows: 3 });
    expect(wins).toHaveLength(3);
    expect(wins[0]).toMatchObject({ band: '20m', startOffset: 2, endOffset: 4, avgRel: 85 });
    expect(wins[1]).toMatchObject({ band: '40m', startOffset: 6, endOffset: 7 });
    expect(wins[2].band).toBe('15m');
  });

  it('only searches the first 24 slots (day 2 is a diurnal repeat)', () => {
    const tiled = tile48({ '20m': hours({ 5: 80 }) }, 0);
    const wins = findBestWindows(tiled);
    expect(wins).toHaveLength(1);
    expect(wins[0].startOffset).toBeLessThan(24);
  });

  it('adapts the threshold down on hard paths so something still shows', () => {
    const tiled = tile48({ '80m': hours({ 3: 22, 4: 25 }) }, 0);
    const wins = findBestWindows(tiled, { minRel: 40 });
    expect(wins).toHaveLength(1);
    expect(wins[0].band).toBe('80m');
    expect(wins[0].peakRel).toBe(25);
  });

  it('returns nothing when the path is fully closed', () => {
    expect(findBestWindows(tile48({ '10m': hours({}) }, 0))).toEqual([]);
  });
});

describe('windowLabel', () => {
  it('renders start/end in UTC with the end exclusive', () => {
    const label = windowLabel({ band: '20m', startOffset: 2, endOffset: 4, avgRel: 85 }, 0);
    expect(label).toBe('20m 02:00–05:00z (85%)');
  });

  it('wraps across UTC midnight', () => {
    const label = windowLabel({ band: '40m', startOffset: 1, endOffset: 3, avgRel: 70 }, 22);
    expect(label).toBe('40m 23:00–02:00z (70%)');
  });
});

describe('parseSunHHMM', () => {
  it('parses HH:MM into a fractional hour', () => {
    expect(parseSunHHMM('06:30')).toBeCloseTo(6.5);
    expect(parseSunHHMM('23:59')).toBeCloseTo(23.983, 2);
  });

  it('rejects non-times (polar night / midnight sun / empty)', () => {
    expect(parseSunHHMM('Polar night')).toBeNull();
    expect(parseSunHHMM('Midnight sun')).toBeNull();
    expect(parseSunHHMM('')).toBeNull();
    expect(parseSunHHMM('25:00')).toBeNull();
    expect(parseSunHHMM(null)).toBeNull();
  });
});

describe('localHourAt', () => {
  const utcNoon = Date.UTC(2026, 0, 15, 12, 0, 0); // winter — no DST edge cases

  it('uses the IANA timezone when valid', () => {
    expect(localHourAt(utcNoon, 'America/Denver')).toBe(5);
    expect(localHourAt(utcNoon, 'Asia/Tokyo')).toBe(21);
  });

  it('falls back to solar longitude offset for invalid zones', () => {
    expect(localHourAt(utcNoon, 'Not/AZone', 139.7)).toBe(21); // ~Tokyo by longitude
    expect(localHourAt(utcNoon, '', -105)).toBe(5);
  });
});
