/**
 * solarCycle tests — chart geometry for the Solar Cycle panel.
 */
import { describe, it, expect } from 'vitest';
import { monthNum, buildCycleChart } from './solarCycle.js';

describe('monthNum', () => {
  it('parses YYYY-MM into a comparable month index', () => {
    expect(monthNum('2020-01')).toBe(2020 * 12);
    expect(monthNum('2020-12')).toBe(2020 * 12 + 11);
    expect(monthNum('2021-01') - monthNum('2020-12')).toBe(1);
  });

  it('rejects garbage', () => {
    expect(monthNum(null)).toBeNull();
    expect(monthNum('2020')).toBeNull();
    expect(monthNum('2020-13')).toBeNull();
    expect(monthNum('2020-00')).toBeNull();
    expect(monthNum('not-a-date')).toBeNull();
  });
});

describe('buildCycleChart', () => {
  const observed = [
    { t: '2020-01', ssn: 5, smoothed: 4 },
    { t: '2020-02', ssn: 10, smoothed: 6 },
    { t: '2020-03', ssn: 120, smoothed: null },
    { t: '2020-04', ssn: 80, smoothed: null },
  ];
  const predicted = [
    { t: '2020-03', min: 20, max: 60 },
    { t: '2020-04', min: 30, max: 90 },
    { t: '2020-05', min: 40, max: 110 },
  ];

  it('returns empty for no data', () => {
    expect(buildCycleChart([], []).empty).toBe(true);
  });

  it('x positions increase monotonically across months', () => {
    const chart = buildCycleChart(observed, predicted);
    const xs = chart.ssnPath.match(/[ML]([\d.]+),/g).map((s) => parseFloat(s.slice(1)));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it('yMax covers both observed and predicted maxima', () => {
    const chart = buildCycleChart(observed, predicted);
    expect(chart.yMax).toBeGreaterThanOrEqual(120); // observed peak
    const predOnly = buildCycleChart(observed.slice(0, 2), predicted);
    expect(predOnly.yMax).toBeGreaterThanOrEqual(110); // predicted max
  });

  it('marker sits at the latest observation with a real SSN', () => {
    const chart = buildCycleChart(observed, predicted);
    expect(chart.marker.t).toBe('2020-04');
    expect(chart.marker.ssn).toBe(80);
    // trailing null ssn is skipped
    const withNullTail = buildCycleChart([...observed, { t: '2020-05', ssn: null, smoothed: null }], predicted);
    expect(withNullTail.marker.t).toBe('2020-04');
  });

  it('peak is the highest observed SSN', () => {
    const chart = buildCycleChart(observed, predicted);
    expect(chart.peak.t).toBe('2020-03');
    expect(chart.peak.ssn).toBe(120);
  });

  it('smoothed path only includes non-null smoothed points', () => {
    const chart = buildCycleChart(observed, predicted);
    expect(chart.smoothedPath.match(/[ML]/g)).toHaveLength(2);
  });

  it('band path is closed and empty without predictions', () => {
    const chart = buildCycleChart(observed, predicted);
    expect(chart.bandPath.endsWith('Z')).toBe(true);
    expect(buildCycleChart(observed, []).bandPath).toBe('');
  });

  it('x tick labels are years inside the domain', () => {
    const chart = buildCycleChart(
      [
        { t: '2019-06', ssn: 3, smoothed: 3 },
        { t: '2022-06', ssn: 90, smoothed: 80 },
      ],
      [],
    );
    const labels = chart.xTicks.map((tk) => tk.label);
    expect(labels).toContain('2020');
    expect(labels).not.toContain('2019'); // Jan 2019 is before the domain start
  });
});
