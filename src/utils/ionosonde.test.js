import { describe, it, expect } from 'vitest';
import { sortStationsByDistance, stationAgeMinutes, formatAge, nvisHint, mufBandHint } from './ionosonde.js';

const boulder = { lat: 40.015, lon: -105.2705 };

describe('sortStationsByDistance', () => {
  it('sorts nearest first and attaches distanceKm', () => {
    const stations = [
      { code: 'EA036', name: 'El Arenosillo', lat: 37.1, lon: -6.7 },
      { code: 'AU930', name: 'Austin', lat: 30.4, lon: -97.7 },
      { code: 'BC840', name: 'Boulder', lat: 40.0, lon: -105.3 },
    ];
    const sorted = sortStationsByDistance(stations, boulder);
    expect(sorted.map((s) => s.code)).toEqual(['BC840', 'AU930', 'EA036']);
    expect(sorted[0].distanceKm).toBeLessThan(10);
    expect(sorted[1].distanceKm).toBeGreaterThan(1000);
  });

  it('puts stations without coordinates last and tolerates bad input', () => {
    const sorted = sortStationsByDistance(
      [
        { code: 'X', lat: null, lon: null },
        { code: 'BC840', lat: 40, lon: -105.3 },
      ],
      boulder,
    );
    expect(sorted[0].code).toBe('BC840');
    expect(sorted[1].distanceKm).toBe(Infinity);
    expect(sortStationsByDistance(null, boulder)).toEqual([]);
  });
});

describe('stationAgeMinutes / formatAge', () => {
  it('computes minutes since measurement', () => {
    const now = Date.parse('2026-08-28T12:00:00Z');
    expect(stationAgeMinutes('2026-08-28T11:52:00Z', now)).toBe(8);
    expect(stationAgeMinutes('2026-08-28T12:05:00Z', now)).toBe(0); // clock skew clamps to 0
    expect(stationAgeMinutes('garbage', now)).toBeNull();
  });

  it('formats ages', () => {
    expect(formatAge(8)).toBe('8m');
    expect(formatAge(80)).toBe('1h 20m');
    expect(formatAge(null)).toBe('—');
  });
});

describe('nvisHint', () => {
  it('maps foF2 to NVIS usability keys', () => {
    expect(nvisHint(8.6)).toBe('nvis40');
    expect(nvisHint(5.2)).toBe('nvis80strong');
    expect(nvisHint(3.0)).toBe('nvis80');
    expect(nvisHint(2.0)).toBe('nvis160');
    expect(nvisHint(null)).toBeNull();
    expect(nvisHint(NaN)).toBeNull();
  });
});

describe('mufBandHint', () => {
  it('maps MUF(3000) to the highest open band', () => {
    expect(mufBandHint(28.8)).toBe('10m');
    expect(mufBandHint(25.3)).toBe('12m');
    expect(mufBandHint(22)).toBe('15m');
    expect(mufBandHint(15)).toBe('20m');
    expect(mufBandHint(8.5)).toBe('40m');
    expect(mufBandHint(3.4)).toBe('160m');
    expect(mufBandHint(undefined)).toBeNull();
  });
});
