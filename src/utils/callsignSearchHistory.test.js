import { describe, it, expect } from 'vitest';
import { isValidCallsignQuery, normalizeCallsignQuery, pushHistory, HISTORY_MAX } from './callsignSearchHistory.js';

describe('isValidCallsignQuery', () => {
  it('accepts real-shaped callsigns, portable and prefixed', () => {
    expect(isValidCallsignQuery('K1ABC')).toBe(true);
    expect(isValidCallsignQuery('k0cjh')).toBe(true);
    expect(isValidCallsignQuery(' 2E0ABC ')).toBe(true);
    expect(isValidCallsignQuery('EA8/K1ABC')).toBe(true);
    expect(isValidCallsignQuery('K1ABC/P')).toBe(true);
    expect(isValidCallsignQuery('VP8/G4XYZ/M')).toBe(true);
  });
  it('rejects non-callsign input', () => {
    expect(isValidCallsignQuery('')).toBe(false);
    expect(isValidCallsignQuery('AB')).toBe(false); // too short
    expect(isValidCallsignQuery('ABCDEF')).toBe(false); // no digit
    expect(isValidCallsignQuery('12345')).toBe(false); // no letter
    expect(isValidCallsignQuery('K1 ABC')).toBe(false); // space inside
    expect(isValidCallsignQuery('K1ABC!')).toBe(false);
    expect(isValidCallsignQuery('/K1ABC')).toBe(false);
    expect(isValidCallsignQuery('K1ABC/')).toBe(false);
    expect(isValidCallsignQuery('K1//ABC')).toBe(false);
    expect(isValidCallsignQuery('A'.repeat(17))).toBe(false);
    expect(isValidCallsignQuery(null)).toBe(false);
  });
});

describe('normalizeCallsignQuery', () => {
  it('trims and uppercases', () => {
    expect(normalizeCallsignQuery('  k1abc ')).toBe('K1ABC');
    expect(normalizeCallsignQuery(undefined)).toBe('');
  });
});

describe('pushHistory', () => {
  it('prepends, without mutating the input', () => {
    const list = ['W1AW', 'G4XYZ'];
    expect(pushHistory(list, 'k1abc')).toEqual(['K1ABC', 'W1AW', 'G4XYZ']);
    expect(list).toEqual(['W1AW', 'G4XYZ']);
  });
  it('dedupes case-insensitively, moving to front', () => {
    expect(pushHistory(['W1AW', 'K1ABC', 'G4XYZ'], 'k1abc')).toEqual(['K1ABC', 'W1AW', 'G4XYZ']);
  });
  it('caps at HISTORY_MAX', () => {
    const list = Array.from({ length: HISTORY_MAX }, (_, i) => `K${i}AA`);
    const next = pushHistory(list, 'W1AW');
    expect(next).toHaveLength(HISTORY_MAX);
    expect(next[0]).toBe('W1AW');
    expect(next).not.toContain(`K${HISTORY_MAX - 1}AA`);
  });
  it('tolerates bad lists and empty calls', () => {
    expect(pushHistory(null, 'K1ABC')).toEqual(['K1ABC']);
    expect(pushHistory(['W1AW', 42, null], 'K1ABC')).toEqual(['K1ABC', 'W1AW']);
    expect(pushHistory(['W1AW'], '')).toEqual(['W1AW']);
  });
});
