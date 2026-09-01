import { describe, it, expect } from 'vitest';
import { parseFreqMHz, makeMemory, moveMemory, formatMemoryFreq } from './freqMemories.js';

describe('parseFreqMHz', () => {
  it('accepts plain MHz numbers and numeric strings', () => {
    expect(parseFreqMHz('14.074')).toBe(14.074);
    expect(parseFreqMHz('7.2')).toBe(7.2);
    expect(parseFreqMHz('0.4742')).toBe(0.4742);
    expect(parseFreqMHz('446.00625')).toBe(446.00625);
    expect(parseFreqMHz(28.4)).toBe(28.4);
  });
  it('rejects junk, negatives, zero, and out-of-range values', () => {
    expect(parseFreqMHz('')).toBe(null);
    expect(parseFreqMHz('  ')).toBe(null);
    expect(parseFreqMHz('14,074')).toBe(null);
    expect(parseFreqMHz('14.074 MHz')).toBe(null);
    expect(parseFreqMHz('-7.2')).toBe(null);
    expect(parseFreqMHz('0')).toBe(null);
    expect(parseFreqMHz('300001')).toBe(null);
    expect(parseFreqMHz(NaN)).toBe(null);
    expect(parseFreqMHz(undefined)).toBe(null);
  });
});

describe('makeMemory', () => {
  it('builds a record with id, trimmed label, numeric freq', () => {
    const m = makeMemory({ label: '  40m calling  ', freq_mhz: '7.200', mode: 'ssb', notes: ' club net ' });
    expect(m.id).toMatch(/^fm-/);
    expect(m.label).toBe('40m calling');
    expect(m.freq_mhz).toBe(7.2);
    expect(m.mode).toBe('SSB');
    expect(m.notes).toBe('club net');
  });
  it('omits empty optional fields', () => {
    const m = makeMemory({ label: 'X', freq_mhz: 14.074, mode: '', notes: '' });
    expect(m).not.toHaveProperty('mode');
    expect(m).not.toHaveProperty('notes');
  });
  it('returns null for missing label or invalid freq', () => {
    expect(makeMemory({ label: '', freq_mhz: 7.2 })).toBe(null);
    expect(makeMemory({ label: 'X', freq_mhz: 'nope' })).toBe(null);
  });
  it('generates distinct ids', () => {
    const a = makeMemory({ label: 'A', freq_mhz: 1.8 });
    const b = makeMemory({ label: 'B', freq_mhz: 3.5 });
    expect(a.id).not.toBe(b.id);
  });
});

describe('moveMemory', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('moves up and down without mutating the input', () => {
    expect(moveMemory(list, 'b', -1).map((m) => m.id)).toEqual(['b', 'a', 'c']);
    expect(moveMemory(list, 'b', 1).map((m) => m.id)).toEqual(['a', 'c', 'b']);
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
  it('clamps at the edges', () => {
    expect(moveMemory(list, 'a', -1).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(moveMemory(list, 'c', 1).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
  it('ignores unknown ids and bad lists', () => {
    expect(moveMemory(list, 'zz', 1).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(moveMemory(null, 'a', 1)).toEqual([]);
  });
});

describe('formatMemoryFreq', () => {
  it('keeps at least 3 decimals, trims beyond', () => {
    expect(formatMemoryFreq(7.2)).toBe('7.200');
    expect(formatMemoryFreq(14.074)).toBe('14.074');
    expect(formatMemoryFreq(446.00625)).toBe('446.00625');
    expect(formatMemoryFreq(0.4742)).toBe('0.4742');
  });
  it('empty for non-numbers', () => {
    expect(formatMemoryFreq(null)).toBe('');
    expect(formatMemoryFreq(NaN)).toBe('');
  });
});
