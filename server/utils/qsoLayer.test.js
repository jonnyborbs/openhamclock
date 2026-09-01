/**
 * Tests for server/utils/qsoLayer.js — the open QSO-layer API validator
 * (issue #1015). These pin down the public ingest contract documented in
 * docs/API.md, so loosen them only when the docs change too.
 */
import { describe, it, expect } from 'vitest';
import { validateQso, normalizeQsoBatch, MAX_BATCH } from './qsoLayer.js';

const NOW = Date.parse('2026-08-28T12:00:00Z');

describe('validateQso', () => {
  it('accepts a minimal QSO with call + grid and resolves lat/lon', () => {
    const res = validateQso({ call: 'ea8bfk', grid: 'IL18' }, NOW);
    expect(res.ok).toBe(true);
    expect(res.qso.call).toBe('EA8BFK');
    expect(res.qso.grid).toBe('IL18');
    expect(res.qso.lat).toBeCloseTo(28.5, 1);
    expect(res.qso.lon).toBeCloseTo(-17.0, 1);
    expect(res.qso.ts_utc).toBe(new Date(NOW).toISOString());
    expect(res.qso.source).toBe('api');
  });

  it('accepts explicit lat/lon without a grid', () => {
    const res = validateQso({ call: 'VK3ABC', lat: -37.8, lon: 144.9 }, NOW);
    expect(res.ok).toBe(true);
    expect(res.qso.lat).toBe(-37.8);
    expect(res.qso.lon).toBe(144.9);
  });

  it('prefers explicit lat/lon over the grid centre when both given', () => {
    const res = validateQso({ call: 'K1ABC', grid: 'FN42', lat: 42.5, lon: -71.5 }, NOW);
    expect(res.ok).toBe(true);
    expect(res.qso.lat).toBe(42.5);
    expect(res.qso.lon).toBe(-71.5);
    expect(res.qso.grid).toBe('FN42'); // grid still kept for display
  });

  it('rejects a QSO without any location', () => {
    const res = validateQso({ call: 'K1ABC', mode: 'SSB' }, NOW);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/grid or lat\/lon/);
  });

  it('rejects missing or malformed callsigns', () => {
    expect(validateQso({ grid: 'FN42' }, NOW).ok).toBe(false);
    expect(validateQso({ call: '', grid: 'FN42' }, NOW).ok).toBe(false);
    expect(validateQso({ call: 'K1<script>', grid: 'FN42' }, NOW).ok).toBe(false);
    expect(validateQso({ call: 'A'.repeat(30), grid: 'FN42' }, NOW).ok).toBe(false);
  });

  it('accepts portable callsigns with slashes', () => {
    expect(validateQso({ call: 'EA8/K0CJH/P', grid: 'IL18' }, NOW).ok).toBe(true);
  });

  it('rejects invalid grids and out-of-range lat/lon', () => {
    expect(validateQso({ call: 'K1ABC', grid: 'ZZ99' }, NOW).ok).toBe(false);
    expect(validateQso({ call: 'K1ABC', lat: 91, lon: 0 }, NOW).ok).toBe(false);
    expect(validateQso({ call: 'K1ABC', lat: 0, lon: 181 }, NOW).ok).toBe(false);
    expect(validateQso({ call: 'K1ABC', lat: 'x', lon: 0 }, NOW).ok).toBe(false);
  });

  it('derives band from freq (MHz) when band is omitted', () => {
    const res = validateQso({ call: 'K1ABC', grid: 'FN42', freq: 14.074 }, NOW);
    expect(res.ok).toBe(true);
    expect(res.qso.freq).toBe(14.074);
    expect(res.qso.band).toBe('20m');
  });

  it('accepts freq_khz and converts to MHz', () => {
    const res = validateQso({ call: 'K1ABC', grid: 'FN42', freq_khz: 7074 }, NOW);
    expect(res.ok).toBe(true);
    expect(res.qso.freq).toBeCloseTo(7.074, 3);
    expect(res.qso.band).toBe('40m');
  });

  it('keeps a caller-supplied band over the derived one', () => {
    const res = validateQso({ call: 'K1ABC', grid: 'FN42', freq: 14.074, band: '20M' }, NOW);
    expect(res.qso.band).toBe('20M');
  });

  it('rejects non-numeric or absurd frequencies', () => {
    expect(validateQso({ call: 'K1ABC', grid: 'FN42', freq: 'twenty' }, NOW).ok).toBe(false);
    expect(validateQso({ call: 'K1ABC', grid: 'FN42', freq: -14 }, NOW).ok).toBe(false);
  });

  it('parses ISO timestamps and epoch ms; rejects garbage and far-future', () => {
    const iso = validateQso({ call: 'K1ABC', grid: 'FN42', timestamp: '2026-08-28T10:00:00Z' }, NOW);
    expect(iso.ok).toBe(true);
    expect(iso.qso.ts_utc).toBe('2026-08-28T10:00:00.000Z');

    const epoch = validateQso({ call: 'K1ABC', grid: 'FN42', timestamp: NOW - 60000 }, NOW);
    expect(epoch.ok).toBe(true);
    expect(epoch.qso.ts_utc).toBe(new Date(NOW - 60000).toISOString());

    expect(validateQso({ call: 'K1ABC', grid: 'FN42', timestamp: 'yesterday-ish' }, NOW).ok).toBe(false);
    const farFuture = NOW + 48 * 60 * 60 * 1000;
    expect(validateQso({ call: 'K1ABC', grid: 'FN42', timestamp: farFuture }, NOW).ok).toBe(false);
  });

  it('sanitizes optional fields — bad colors dropped, labels capped, control chars stripped', () => {
    const res = validateQso(
      {
        call: 'K1ABC',
        grid: 'FN42',
        mode: 'ft8',
        label: 'POTA\t K-1234 ' + 'x'.repeat(300),
        color: 'javascript:alert(1)',
      },
      NOW,
    );
    expect(res.ok).toBe(true);
    expect(res.qso.mode).toBe('FT8');
    expect(res.qso.label.length).toBeLessThanOrEqual(120);
    expect(res.qso.label).not.toContain('\t');
    expect(res.qso.color).toBeUndefined();
  });

  it('accepts valid hex and named colors', () => {
    expect(validateQso({ call: 'K1ABC', grid: 'FN42', color: '#ff8800' }, NOW).qso.color).toBe('#ff8800');
    expect(validateQso({ call: 'K1ABC', grid: 'FN42', color: 'orange' }, NOW).qso.color).toBe('orange');
  });

  it('drops unknown extra fields instead of passing them through', () => {
    const res = validateQso({ call: 'K1ABC', grid: 'FN42', evil: '<img onerror=x>', rst: '59' }, NOW);
    expect(res.ok).toBe(true);
    expect(res.qso.evil).toBeUndefined();
    expect(res.qso.rst).toBeUndefined();
  });

  it('rejects non-object inputs', () => {
    expect(validateQso(null, NOW).ok).toBe(false);
    expect(validateQso('K1ABC', NOW).ok).toBe(false);
    expect(validateQso([{ call: 'K1ABC' }], NOW).ok).toBe(false);
  });
});

describe('normalizeQsoBatch', () => {
  const good = { call: 'K1ABC', grid: 'FN42' };
  const bad = { call: 'K1ABC' }; // no location

  it('wraps a single QSO object', () => {
    const { qsos, errors } = normalizeQsoBatch(good, NOW);
    expect(qsos).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('accepts a bare array and an { qsos: [...] } envelope', () => {
    expect(normalizeQsoBatch([good, good], NOW).qsos).toHaveLength(2);
    expect(normalizeQsoBatch({ qsos: [good, good, good] }, NOW).qsos).toHaveLength(3);
  });

  it('collects per-item errors with indexes while keeping valid entries', () => {
    const { qsos, errors } = normalizeQsoBatch([good, bad, good], NOW);
    expect(qsos).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^qso\[1\]:/);
  });

  it('caps batches at MAX_BATCH and reports the cap', () => {
    const big = Array.from({ length: MAX_BATCH + 10 }, () => good);
    const { qsos, errors } = normalizeQsoBatch(big, NOW);
    expect(qsos).toHaveLength(MAX_BATCH);
    expect(errors.some((e) => e.includes('capped'))).toBe(true);
  });

  it('rejects non-object bodies outright', () => {
    const { qsos, errors } = normalizeQsoBatch('not json', NOW);
    expect(qsos).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});
