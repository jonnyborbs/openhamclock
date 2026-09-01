import { describe, it, expect } from 'vitest';
import { qsoTimestampMs, qsoTimestamps, countInWindow, ratePerHour, sparklineBuckets } from './contestRate.js';

const T0 = Date.UTC(2026, 7, 28, 12, 0, 0); // 2026-08-28 12:00:00Z

const qsoAt = (date, time) => ({ call: 'W1AW', qso_date: date, time_on: time });

describe('qsoTimestampMs', () => {
  it('parses qso_date + HHMMSS time_on as UTC', () => {
    expect(qsoTimestampMs(qsoAt('20260828', '120000'))).toBe(T0);
    expect(qsoTimestampMs(qsoAt('20260828', '235959'))).toBe(Date.UTC(2026, 7, 28, 23, 59, 59));
  });

  it('parses HHMM time_on (seconds default to 0)', () => {
    expect(qsoTimestampMs(qsoAt('20260828', '1200'))).toBe(T0);
  });

  it('rejects missing or malformed fields', () => {
    expect(qsoTimestampMs({})).toBeNull();
    expect(qsoTimestampMs(qsoAt('', '1200'))).toBeNull();
    expect(qsoTimestampMs(qsoAt('20260828', ''))).toBeNull();
    expect(qsoTimestampMs(qsoAt('2026-08-28', '1200'))).toBeNull();
    expect(qsoTimestampMs(qsoAt('20260828', '12:00'))).toBeNull();
    expect(qsoTimestampMs(qsoAt('20261328', '1200'))).toBeNull(); // month 13
    expect(qsoTimestampMs(qsoAt('20260828', '2460'))).toBeNull(); // minute 60
    expect(qsoTimestampMs(null)).toBeNull();
  });
});

describe('qsoTimestamps', () => {
  it('maps a QSO list and drops unparseable records', () => {
    const list = [qsoAt('20260828', '1200'), { call: 'BAD' }, qsoAt('20260828', '1201')];
    expect(qsoTimestamps(list)).toEqual([T0, T0 + 60000]);
  });

  it('tolerates non-array input', () => {
    expect(qsoTimestamps(null)).toEqual([]);
    expect(qsoTimestamps(undefined)).toEqual([]);
  });
});

describe('countInWindow', () => {
  const stamps = [T0 - 30 * 60000, T0 - 9 * 60000, T0 - 5 * 60000, T0 - 1000, T0];

  it('counts only timestamps inside the trailing window', () => {
    expect(countInWindow(stamps, 10 * 60000, T0)).toBe(4); // last 10 min
    expect(countInWindow(stamps, 60 * 60000, T0)).toBe(5); // last hour
    expect(countInWindow(stamps, 60000, T0)).toBe(2); // last minute (incl. t === now)
  });

  it('excludes the exact window-start edge and future timestamps', () => {
    expect(countInWindow([T0 - 60000], 60000, T0)).toBe(0); // t === start excluded
    expect(countInWindow([T0 + 1], 60000, T0)).toBe(0); // future ignored
  });

  it('handles empty / invalid input', () => {
    expect(countInWindow([], 60000, T0)).toBe(0);
    expect(countInWindow(null, 60000, T0)).toBe(0);
    expect(countInWindow([T0], 0, T0)).toBe(0);
  });
});

describe('ratePerHour', () => {
  it('extrapolates the trailing window to QSOs/hour', () => {
    // 5 QSOs in the last 10 minutes → 30/hr
    const stamps = [1, 2, 3, 4, 5].map((i) => T0 - i * 60000);
    expect(ratePerHour(stamps, 10 * 60000, T0)).toBe(30);
  });

  it('a full-hour window is just the count', () => {
    const stamps = [1, 2, 3].map((i) => T0 - i * 60000);
    expect(ratePerHour(stamps, 3600000, T0)).toBe(3);
  });

  it('returns 0 for an invalid window', () => {
    expect(ratePerHour([T0], 0, T0)).toBe(0);
  });
});

describe('sparklineBuckets', () => {
  it('buckets trailing timestamps oldest→newest', () => {
    const bucketMs = 5 * 60000;
    const stamps = [
      T0 - 55 * 60000, // oldest bucket (index 0)
      T0 - 31 * 60000, // index 5 (25–30 min ago)
      T0 - 2 * 60000, // newest bucket
      T0 - 60000, // newest bucket
      T0, // t === now lands in the newest bucket
    ];
    const out = sparklineBuckets(stamps, { buckets: 12, bucketMs, now: T0 });
    expect(out).toHaveLength(12);
    expect(out[0]).toBe(1);
    expect(out[5]).toBe(1);
    expect(out[11]).toBe(3);
    expect(out.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('ignores timestamps outside the covered span', () => {
    const out = sparklineBuckets([T0 - 61 * 60000, T0 + 1000], { buckets: 12, bucketMs: 5 * 60000, now: T0 });
    expect(out.every((n) => n === 0)).toBe(true);
  });

  it('returns all-zero buckets for empty input', () => {
    expect(sparklineBuckets([], { buckets: 6, bucketMs: 60000, now: T0 })).toEqual([0, 0, 0, 0, 0, 0]);
    expect(sparklineBuckets(null, { buckets: 3, bucketMs: 60000, now: T0 })).toEqual([0, 0, 0]);
  });
});
