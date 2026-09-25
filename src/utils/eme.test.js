import { describe, it, expect } from 'vitest';
import {
  moonPathDeltaDb,
  computeEmeSnapshot,
  computeMutualWindows,
  computeSkyTracks,
  isEmeBand,
  isEmeSpot,
  formatDurationShort,
  EME_MEAN_DISTANCE_KM,
} from './eme.js';
import { getMoonAzEl } from './geo.js';

const DE = { lat: 44.98, lon: -93.27 }; // Minneapolis
const DX = { lat: 52.52, lon: 13.4 }; // Berlin
const ANTIPODE = { lat: -44.98, lon: 86.73 };
const T0 = new Date('2026-09-13T00:00:00Z');

describe('moonPathDeltaDb', () => {
  it('is 0 dB at the mean distance and ±~2 dB at apogee/perigee', () => {
    expect(moonPathDeltaDb(EME_MEAN_DISTANCE_KM)).toBeCloseTo(0, 6);
    expect(moonPathDeltaDb(405500)).toBeGreaterThan(0.8);
    expect(moonPathDeltaDb(363300)).toBeLessThan(-0.8);
    expect(moonPathDeltaDb(NaN)).toBe(0);
  });
});

describe('computeEmeSnapshot', () => {
  it('reports both ends, and mutual only when both see the moon', () => {
    const snap = computeEmeSnapshot(T0, DE, DX);
    expect(snap.moon.distanceKm).toBeGreaterThan(350000);
    expect(snap.moon.distanceKm).toBeLessThan(410000);
    expect(Math.abs(snap.moon.declination)).toBeLessThan(30);
    expect(snap.de.up).toBe(snap.de.elevation >= 0);
    expect(snap.dx.up).toBe(snap.dx.elevation >= 0);
    expect(snap.mutual).toBe(snap.de.up && snap.dx.up);
    expect(snap.moon.phaseEmoji).toMatch(/🌑|🌒|🌓|🌔|🌕|🌖|🌗|🌘/);
  });
  it('is null without DE and has dx null without DX', () => {
    expect(computeEmeSnapshot(T0, null, DX)).toBeNull();
    const snap = computeEmeSnapshot(T0, DE, null);
    expect(snap.dx).toBeNull();
    expect(snap.mutual).toBe(false);
  });
});

describe('computeMutualWindows', () => {
  it('finds windows where both elevations are ≥ 0, with refined edges', () => {
    const wins = computeMutualWindows(T0, DE, DX, { hours: 48 });
    expect(wins.length).toBeGreaterThan(0);
    for (const w of wins) {
      expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
      // Just inside each edge both stations see the moon; just outside one does not
      const inside = (t) =>
        Math.min(getMoonAzEl(t, DE.lat, DE.lon).elevation, getMoonAzEl(t, DX.lat, DX.lon).elevation);
      expect(inside(new Date(w.start.getTime() + 60_000))).toBeGreaterThanOrEqual(-0.05);
      if (!w.open) expect(inside(new Date(w.start.getTime() - 120_000))).toBeLessThan(0.05);
      if (!w.truncated) expect(inside(new Date(w.end.getTime() + 120_000))).toBeLessThan(0.05);
      expect(w.peakMinEl).toBeGreaterThanOrEqual(0);
    }
  });
  it('honours a minimum elevation', () => {
    const loose = computeMutualWindows(T0, DE, DX, { hours: 48, minElev: 0 });
    const strict = computeMutualWindows(T0, DE, DX, { hours: 48, minElev: 20 });
    const total = (ws) => ws.reduce((a, w) => a + (w.end - w.start), 0);
    expect(total(strict)).toBeLessThan(total(loose));
  });
  it('returns nothing for an antipodal pair or a missing DX', () => {
    // Antipodes never share the moon above the horizon (bar a sliver of refraction)
    const wins = computeMutualWindows(T0, DE, ANTIPODE, { hours: 48 });
    expect(wins.every((w) => w.end - w.start < 30 * 60_000)).toBe(true);
    expect(computeMutualWindows(T0, DE, null)).toEqual([]);
  });
});

describe('computeSkyTracks', () => {
  it('samples only above-horizon points for both stations', () => {
    const tr = computeSkyTracks(T0, DE, DX);
    expect(tr.de.length).toBeGreaterThan(10);
    expect(tr.dx.length).toBeGreaterThan(10);
    expect(tr.de.every((p) => p.el >= 0 && p.az >= 0 && p.az < 360)).toBe(true);
    expect(computeSkyTracks(T0, DE, null).dx).toEqual([]);
  });
});

describe('isEmeBand / isEmeSpot', () => {
  it('accepts EME bands and rejects HF', () => {
    expect(isEmeBand('144.174')).toBe(true);
    expect(isEmeBand(1296.05)).toBe(true);
    expect(isEmeBand('14.074')).toBe(false);
    expect(isEmeBand(28.4)).toBe(false);
    expect(isEmeBand('x')).toBe(false);
  });
  it('needs both an EME band and an EME-ish comment', () => {
    expect(isEmeSpot({ freq: '144.128', comment: 'EME JT65 -18 dB' })).toBe(true);
    expect(isEmeSpot({ freq: '432.070', comment: 'Q65-60A moonbounce' })).toBe(true);
    expect(isEmeSpot({ freq: '144.174', comment: 'FT8 tropo' })).toBe(false);
    expect(isEmeSpot({ freq: '14.076', comment: 'EME' })).toBe(false);
    expect(isEmeSpot({ freq: '144.128', comment: 'ENEMY station' })).toBe(false);
    expect(isEmeSpot(null)).toBe(false);
  });
});

describe('formatDurationShort', () => {
  it('formats hours and minutes', () => {
    expect(formatDurationShort(45 * 60_000)).toBe('45m');
    expect(formatDurationShort(135 * 60_000)).toBe('2h 15m');
    expect(formatDurationShort(-5)).toBe('0m');
  });
});
