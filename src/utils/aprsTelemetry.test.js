import { describe, it, expect } from 'vitest';
import { buildChannels, buildBits, formatTelemetryValue, sparklinePoints } from './aprsTelemetry.js';

const entry = {
  call: 'W1AW',
  seq: '005',
  values: [123, 45, 6, 7, 8],
  bits: '10110000',
  params: ['Battery', 'Temp', 'RxCount', 'A4', 'A5', 'Door', 'Aux'],
  units: ['V', 'F', 'pkts', '', ''],
  computed: [12.3, 72.5, 6, 7, 8],
  history: [
    { seq: '003', values: [120, 44, 5, 7, 8], computed: [12.0, 71.2, 5, 7, 8], timestamp: 1 },
    { seq: '004', values: [121, 44, 6, 7, 8], computed: [12.1, 71.2, 6, 7, 8], timestamp: 2 },
    { seq: '005', values: [123, 45, 6, 7, 8], computed: [12.3, 72.5, 6, 7, 8], timestamp: 3 },
  ],
};

describe('buildChannels', () => {
  it('pairs labels, units, and computed values per channel', () => {
    const chans = buildChannels(entry);
    expect(chans).toHaveLength(5);
    expect(chans[0]).toMatchObject({ label: 'Battery', unit: 'V', value: 12.3 });
    expect(chans[1]).toMatchObject({ label: 'Temp', unit: 'F', value: 72.5 });
  });

  it('builds history series from computed values', () => {
    const chans = buildChannels(entry);
    expect(chans[0].series).toEqual([12.0, 12.1, 12.3]);
  });

  it('falls back to raw values and default labels without definitions', () => {
    const bare = { values: [1, 2, 3, 4, 5], history: [] };
    const chans = buildChannels(bare);
    expect(chans[0]).toMatchObject({ label: 'A1', unit: '', value: 1 });
    expect(chans[4].label).toBe('A5');
  });

  it('returns empty array for missing entry', () => {
    expect(buildChannels(null)).toEqual([]);
  });
});

describe('buildBits', () => {
  it('labels digital bits from PARM fields 6+', () => {
    const bits = buildBits(entry);
    expect(bits).toHaveLength(8);
    expect(bits[0]).toEqual({ label: 'Door', on: true });
    expect(bits[1]).toEqual({ label: 'Aux', on: false });
    expect(bits[2]).toEqual({ label: 'B3', on: true });
  });

  it('returns empty array when no bits present', () => {
    expect(buildBits({ bits: '' })).toEqual([]);
    expect(buildBits(null)).toEqual([]);
  });
});

describe('formatTelemetryValue', () => {
  it('formats integers, decimals, and non-numbers', () => {
    expect(formatTelemetryValue(12)).toBe('12');
    expect(formatTelemetryValue(12.345)).toBe('12.35');
    expect(formatTelemetryValue(123.456)).toBe('123.5');
    expect(formatTelemetryValue(NaN)).toBe('—');
    expect(formatTelemetryValue(undefined)).toBe('—');
  });
});

describe('sparklinePoints', () => {
  it('maps a series into the viewbox, min at bottom, max at top', () => {
    const pts = sparklinePoints([0, 10], 100, 28, 2);
    expect(pts).toBe('2.0,26.0 98.0,2.0');
  });

  it('handles flat series without dividing by zero', () => {
    const pts = sparklinePoints([5, 5, 5], 100, 28, 2);
    expect(pts).toContain('2.0,');
    expect(pts.split(' ')).toHaveLength(3);
  });

  it('returns empty string for short series', () => {
    expect(sparklinePoints([1])).toBe('');
    expect(sparklinePoints([])).toBe('');
    expect(sparklinePoints(null)).toBe('');
  });
});
