/**
 * logStats tests — heatmap bucketing across month boundaries, best-DX
 * pick with missing grids, band/mode tallies, headline stats.
 */
import { describe, it, expect } from 'vitest';
import { qsoDayKey, tallyBy, qsosPerDay, buildHeatmap, bestDx, computeLogStats } from './logStats.js';

const qso = (over = {}) => ({
  id: 'x',
  call: 'W1AW',
  qso_date: '20260815',
  time_on: '120000',
  band: '20m',
  mode: 'SSB',
  ...over,
});

describe('qsoDayKey', () => {
  it('formats YYYYMMDD as YYYY-MM-DD', () => {
    expect(qsoDayKey(qso())).toBe('2026-08-15');
  });

  it('rejects malformed dates', () => {
    expect(qsoDayKey(qso({ qso_date: '2026-08-15' }))).toBeNull();
    expect(qsoDayKey(qso({ qso_date: '' }))).toBeNull();
    expect(qsoDayKey({})).toBeNull();
  });
});

describe('tallyBy', () => {
  it('counts bands and modes, sorted by count desc', () => {
    const qsos = [
      qso({ band: '20m', mode: 'CW' }),
      qso({ band: '20M', mode: 'cw' }),
      qso({ band: '40m', mode: 'SSB' }),
      qso({ band: '', mode: undefined }),
    ];
    expect(tallyBy(qsos, 'band')).toEqual([
      { key: '20m', count: 2 },
      { key: '40m', count: 1 },
    ]);
    expect(tallyBy(qsos, 'mode')).toEqual([
      { key: 'CW', count: 2 },
      { key: 'SSB', count: 1 },
    ]);
  });
});

describe('qsosPerDay / buildHeatmap', () => {
  it('buckets QSOs per day and finds the max', () => {
    const qsos = [
      qso({ qso_date: '20260701' }),
      qso({ qso_date: '20260701' }),
      qso({ qso_date: '20260702' }),
      qso({ qso_date: 'bogus' }),
    ];
    const counts = qsosPerDay(qsos);
    expect(counts.get('2026-07-01')).toBe(2);
    expect(counts.get('2026-07-02')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('buckets correctly across a month boundary', () => {
    const qsos = [qso({ qso_date: '20260731' }), qso({ qso_date: '20260801' })];
    const counts = qsosPerDay(qsos);
    const now = new Date(Date.UTC(2026, 7, 28)); // 2026-08-28
    const { weeks, maxCount } = buildHeatmap(counts, now);
    const cells = weeks.flat().filter(Boolean);
    const jul31 = cells.find((c) => c.date === '2026-07-31');
    const aug01 = cells.find((c) => c.date === '2026-08-01');
    expect(jul31.count).toBe(1);
    expect(aug01.count).toBe(1);
    expect(maxCount).toBe(1);
  });

  it('covers the trailing 12 months, Sunday-aligned, no future cells', () => {
    const now = new Date(Date.UTC(2026, 7, 28)); // a Friday
    const { weeks, monthLabels } = buildHeatmap(new Map(), now);
    const cells = weeks.flat().filter(Boolean);
    // First cell is a Sunday on/before now-364d
    const firstDate = new Date(`${cells[0].date}T00:00:00Z`);
    expect(firstDate.getUTCDay()).toBe(0);
    expect(now - firstDate).toBeLessThanOrEqual(371 * 24 * 3600 * 1000);
    // Last cell is today; the rest of that week is null
    expect(cells[cells.length - 1].date).toBe('2026-08-28');
    const lastWeek = weeks[weeks.length - 1];
    expect(lastWeek[6]).toBeNull(); // Saturday after "today" is future
    // Rows are weekday-aligned: every non-null cell's weekday matches its row
    weeks.forEach((week) => {
      week.forEach((cell, dow) => {
        if (cell) expect(new Date(`${cell.date}T00:00:00Z`).getUTCDay()).toBe(dow);
      });
    });
    expect(monthLabels.length).toBeGreaterThanOrEqual(12);
  });
});

describe('bestDx', () => {
  const de = { lat: 39.0, lon: -94.6 }; // Kansas City-ish

  it('picks the farthest QSO with a valid grid', () => {
    const qsos = [
      qso({ call: 'K1ABC', gridsquare: 'FN31' }), // ~1900 km from KC
      qso({ call: 'VK3XYZ', gridsquare: 'QF22' }), // Australia, much farther
      qso({ call: 'W9DEF', gridsquare: 'EN52' }), // nearby
    ];
    const best = bestDx(qsos, de);
    expect(best.call).toBe('VK3XYZ');
    expect(best.km).toBeGreaterThan(10000);
    expect(best.grid).toBe('QF22');
  });

  it('skips QSOs with missing or invalid grids', () => {
    const qsos = [
      qso({ call: 'NOGRID', gridsquare: '' }),
      qso({ call: 'BADGRID', gridsquare: 'ZZ99' }), // Z outside A-R field range
      qso({ call: 'GOOD', gridsquare: 'JO65' }),
    ];
    const best = bestDx(qsos, de);
    expect(best.call).toBe('GOOD');
  });

  it('prefers the QSO my_gridsquare over the DE location', () => {
    // my grid in Japan: JO65 (Denmark) is ~8500km from KC but only ~8000km from PM95?
    // Simpler: same target, different from-points give different distances.
    const target = { call: 'T1EST', gridsquare: 'JO65' };
    const fromDe = bestDx([qso(target)], de);
    const fromJapan = bestDx([qso({ ...target, my_gridsquare: 'PM95' })], de);
    expect(fromDe.km).not.toBeCloseTo(fromJapan.km, 0);
  });

  it('returns null with no usable from-point or no grids at all', () => {
    expect(bestDx([qso({ gridsquare: 'JO65' })], null)).toBeNull();
    expect(bestDx([qso({ gridsquare: '' })], de)).toBeNull();
    expect(bestDx([], de)).toBeNull();
  });
});

describe('computeLogStats', () => {
  it('computes headline stats', () => {
    const now = new Date(Date.UTC(2026, 7, 28));
    const qsos = [
      qso({ call: 'W1AW', qso_date: '20260101', time_on: '010000', gridsquare: 'FN31pr' }),
      qso({ call: 'w1aw', qso_date: '20260815', time_on: '120000', gridsquare: 'FN31ab' }),
      qso({ call: 'VK3XYZ', qso_date: '20260815', time_on: '130000', gridsquare: 'QF22', band: '40m', mode: 'CW' }),
    ];
    const stats = computeLogStats(qsos, { lat: 39, lon: -94.6 }, now);
    expect(stats.total).toBe(3);
    expect(stats.uniqueCalls).toBe(2); // case-insensitive
    expect(stats.uniqueGrids).toBe(2); // FN31 counted once at 4-char precision
    expect(stats.firstQsoDate).toBe('2026-01-01');
    expect(stats.latestQsoDate).toBe('2026-08-15');
    expect(stats.busiestDay).toEqual({ date: '2026-08-15', count: 2 });
    expect(stats.bands[0]).toEqual({ key: '20m', count: 2 });
    expect(stats.modes[0]).toEqual({ key: 'SSB', count: 2 });
    expect(stats.bestDx.call).toBe('VK3XYZ');
    expect(stats.heatmap.weeks.length).toBeGreaterThan(50);
  });

  it('handles an empty log', () => {
    const stats = computeLogStats([], null);
    expect(stats.total).toBe(0);
    expect(stats.bestDx).toBeNull();
    expect(stats.busiestDay).toBeNull();
    expect(stats.firstQsoDate).toBeNull();
    expect(stats.bands).toEqual([]);
  });
});
