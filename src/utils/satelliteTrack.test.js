import { describe, it, expect } from 'vitest';
import * as satellite from 'satellite.js';
import {
  DEFAULT_TRACK_DURATION_MINS,
  MIN_TRACK_DURATION_MINS,
  MAX_TRACK_DURATION_MINS,
  clampTrackDuration,
  trackWindowOffsets,
  computeOrbitTrack,
} from './satelliteTrack.js';

// The track window used to be hardcoded at ±45 min inside useSatellites.
// These tests pin the extracted logic so the Settings → Satellites duration
// slider and the legacy default cannot drift apart.

// ISS TLE (epoch 2026-08-19) — any valid LEO element set works; propagation
// is deterministic for a fixed satrec + time.
const TLE1 = '1 25544U 98067A   26231.50000000  .00016717  00000-0  10270-3 0  9005';
const TLE2 = '2 25544  51.6400 208.9163 0006317  69.9862 290.2261 15.54225995 25555';
const NOW = new Date('2026-08-19T12:00:00Z');

describe('clampTrackDuration', () => {
  it('passes through values inside the supported range', () => {
    expect(clampTrackDuration(15)).toBe(15);
    expect(clampTrackDuration(45)).toBe(45);
    expect(clampTrackDuration(120)).toBe(120);
  });

  it('clamps values outside the range', () => {
    expect(clampTrackDuration(5)).toBe(MIN_TRACK_DURATION_MINS);
    expect(clampTrackDuration(0)).toBe(MIN_TRACK_DURATION_MINS);
    expect(clampTrackDuration(500)).toBe(MAX_TRACK_DURATION_MINS);
  });

  it('falls back to the default for non-numeric input', () => {
    expect(clampTrackDuration(undefined)).toBe(DEFAULT_TRACK_DURATION_MINS);
    expect(clampTrackDuration(null)).toBe(DEFAULT_TRACK_DURATION_MINS);
    expect(clampTrackDuration('abc')).toBe(DEFAULT_TRACK_DURATION_MINS);
    expect(clampTrackDuration(NaN)).toBe(DEFAULT_TRACK_DURATION_MINS);
  });
});

describe('trackWindowOffsets', () => {
  it('is symmetric around now with 1-minute steps by default', () => {
    const offsets = trackWindowOffsets(45);
    expect(offsets.length).toBe(91); // -45..45 inclusive
    expect(offsets[0]).toBe(-45);
    expect(offsets[45]).toBe(0);
    expect(offsets[90]).toBe(45);
  });

  it('scales with the requested duration', () => {
    expect(trackWindowOffsets(15).length).toBe(31);
    expect(trackWindowOffsets(120).length).toBe(241);
  });

  it('matches the legacy hardcoded ±45 window when no duration is given', () => {
    expect(trackWindowOffsets(undefined)).toEqual(trackWindowOffsets(45));
  });
});

describe('computeOrbitTrack', () => {
  const satrec = satellite.twoline2satrec(TLE1, TLE2);

  it('produces one [lat, lon] point per window offset', () => {
    const track = computeOrbitTrack(satrec, NOW, 45);
    expect(track.length).toBe(91);
    track.forEach(([lat, lon]) => {
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    });
  });

  it('defaults to the legacy ±45 minute window', () => {
    expect(computeOrbitTrack(satrec, NOW)).toEqual(computeOrbitTrack(satrec, NOW, 45));
  });

  it('grows the track when the duration grows, keeping the midpoint at now', () => {
    const short = computeOrbitTrack(satrec, NOW, 15);
    const long = computeOrbitTrack(satrec, NOW, 120);
    expect(short.length).toBe(31);
    expect(long.length).toBe(241);

    // The midpoint of every window is the position at `now` — the globe splits
    // the track at its midpoint for past/lead styling, so this must hold for
    // all durations.
    const midShort = short[(short.length - 1) / 2];
    const midLong = long[(long.length - 1) / 2];
    expect(midShort[0]).toBeCloseTo(midLong[0], 6);
    expect(midShort[1]).toBeCloseTo(midLong[1], 6);
  });
});
