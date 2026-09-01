import { describe, expect, it } from 'vitest';
import { EGG_NAMES, activeEggForDate, easterSunday, eggOverride, fieldDaySaturday } from './seasonalEggs.js';

describe('eggOverride (?egg= preview)', () => {
  it('accepts every known egg name', () => {
    for (const name of EGG_NAMES) {
      expect(eggOverride(`?egg=${name}`)).toBe(name);
      expect(eggOverride(`?foo=1&egg=${name}`)).toBe(name);
    }
  });

  it('rejects unknown, empty, and absent values', () => {
    expect(eggOverride('?egg=santa')).toBeNull();
    expect(eggOverride('?egg=')).toBeNull();
    expect(eggOverride('?other=1')).toBeNull();
    expect(eggOverride('')).toBeNull();
    expect(eggOverride(undefined)).toBeNull();
  });
});

describe('easterSunday (computus)', () => {
  // Known Easter dates (Gregorian, Western)
  it.each([
    [2024, 2, 31], // March 31
    [2025, 3, 20], // April 20
    [2026, 3, 5], // April 5
    [2027, 2, 28], // March 28
    [2038, 3, 25], // April 25 — latest possible
    [2285, 2, 22], // March 22 — earliest possible
  ])('%i → month %i day %i', (year, month, day) => {
    const d = easterSunday(year);
    expect([d.getMonth(), d.getDate()]).toEqual([month, day]);
  });
});

describe('fieldDaySaturday (fourth Saturday of June)', () => {
  it.each([
    [2024, 22],
    [2025, 28],
    [2026, 27],
    [2027, 26],
  ])('%i → June %i', (year, day) => {
    const d = fieldDaySaturday(year);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(day);
    expect(d.getDay()).toBe(6); // Saturday
  });
});

describe('activeEggForDate', () => {
  it('winter: christmas Dec 24-26, newyear Dec 31 + Jan 1', () => {
    expect(activeEggForDate('winter', new Date(2026, 11, 23))).toBeNull();
    expect(activeEggForDate('winter', new Date(2026, 11, 24))).toBe('christmas');
    expect(activeEggForDate('winter', new Date(2026, 11, 26))).toBe('christmas');
    expect(activeEggForDate('winter', new Date(2026, 11, 27))).toBeNull();
    expect(activeEggForDate('winter', new Date(2026, 11, 31))).toBe('newyear');
    expect(activeEggForDate('winter', new Date(2027, 0, 1))).toBe('newyear');
    expect(activeEggForDate('winter', new Date(2027, 0, 2))).toBeNull();
  });

  it('spring: Easter weekend Saturday through Monday', () => {
    // Easter 2026 = April 5
    expect(activeEggForDate('spring', new Date(2026, 3, 3))).toBeNull();
    expect(activeEggForDate('spring', new Date(2026, 3, 4))).toBe('easter');
    expect(activeEggForDate('spring', new Date(2026, 3, 5))).toBe('easter');
    expect(activeEggForDate('spring', new Date(2026, 3, 6))).toBe('easter');
    expect(activeEggForDate('spring', new Date(2026, 3, 7))).toBeNull();
  });

  it('summer: Field Day weekend and July 4', () => {
    // Field Day 2026 = June 27-28
    expect(activeEggForDate('summer', new Date(2026, 5, 26))).toBeNull();
    expect(activeEggForDate('summer', new Date(2026, 5, 27))).toBe('fieldday');
    expect(activeEggForDate('summer', new Date(2026, 5, 28))).toBe('fieldday');
    expect(activeEggForDate('summer', new Date(2026, 5, 29))).toBeNull();
    expect(activeEggForDate('summer', new Date(2026, 6, 4))).toBe('july4');
    expect(activeEggForDate('summer', new Date(2026, 6, 5))).toBeNull();
  });

  it('fall: Halloween only', () => {
    expect(activeEggForDate('fall', new Date(2026, 9, 30))).toBeNull();
    expect(activeEggForDate('fall', new Date(2026, 9, 31))).toBe('halloween');
    expect(activeEggForDate('fall', new Date(2026, 10, 1))).toBeNull();
  });

  it('eggs only fire for their own season theme', () => {
    expect(activeEggForDate('winter', new Date(2026, 9, 31))).toBeNull();
    expect(activeEggForDate('fall', new Date(2026, 11, 25))).toBeNull();
    expect(activeEggForDate('dark', new Date(2026, 11, 25))).toBeNull();
  });
});
