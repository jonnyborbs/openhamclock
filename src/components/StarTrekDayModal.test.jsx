import { describe, expect, it } from 'vitest';
import { inStarTrekDayWindow, shouldShowStarTrekDay } from './StarTrekDayModal.jsx';

describe('Star Trek Day 2026 window', () => {
  it('opens Sept 7-9 2026 only', () => {
    expect(inStarTrekDayWindow(new Date(2026, 8, 6))).toBe(false);
    expect(inStarTrekDayWindow(new Date(2026, 8, 7))).toBe(true);
    expect(inStarTrekDayWindow(new Date(2026, 8, 8))).toBe(true);
    expect(inStarTrekDayWindow(new Date(2026, 8, 9))).toBe(true);
    expect(inStarTrekDayWindow(new Date(2026, 8, 10))).toBe(false);
  });

  it('never fires in other years', () => {
    expect(inStarTrekDayWindow(new Date(2027, 8, 8))).toBe(false);
    expect(inStarTrekDayWindow(new Date(2025, 8, 8))).toBe(false);
  });

  it('dismissal wins inside the window', () => {
    expect(shouldShowStarTrekDay({ date: new Date(2026, 8, 8), dismissed: false })).toBe(true);
    expect(shouldShowStarTrekDay({ date: new Date(2026, 8, 8), dismissed: true })).toBe(false);
  });

  it('?stday preview forces it regardless of date and dismissal', () => {
    expect(shouldShowStarTrekDay({ date: new Date(2026, 8, 3), dismissed: true, forced: true })).toBe(true);
  });
});
