/**
 * Date triggers for the seasonal themes' easter eggs. Pure functions so the
 * calendar math is testable — SeasonalEffects re-checks hourly because wall
 * displays run for weeks and should wake up decorated on the right morning.
 *
 * One egg per window; windows use the viewer's local date on purpose
 * (holidays happen in local time, not UTC).
 */

export const EGG_NAMES = ['christmas', 'newyear', 'easter', 'fieldday', 'july4', 'halloween'];

/**
 * Preview override: `?egg=fieldday` etc. in the URL forces an egg on
 * regardless of the calendar, so the date-locked effects can be checked
 * without waiting for the holiday. Deliberately undocumented in the manual —
 * it would spoil the eggs. Returns null for absent or unknown values.
 */
export function eggOverride(search) {
  try {
    const value = new URLSearchParams(search).get('egg');
    return EGG_NAMES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/** Easter Sunday for a Gregorian year (Meeus/Jones/Butcher computus). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** ARRL Field Day Saturday: the fourth Saturday of June. */
export function fieldDaySaturday(year) {
  const june1 = new Date(year, 5, 1);
  const firstSaturday = 1 + ((6 - june1.getDay() + 7) % 7);
  return new Date(year, 5, firstSaturday + 21);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function withinDays(date, start, days) {
  for (let i = 0; i < days; i++) {
    if (sameDay(date, new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))) return true;
  }
  return false;
}

/**
 * The easter egg (if any) active for a season theme on a given date.
 * Returns one of: 'christmas' | 'newyear' | 'easter' | 'fieldday' |
 * 'july4' | 'halloween' | null.
 */
export function activeEggForDate(season, date = new Date()) {
  const month = date.getMonth();
  const day = date.getDate();

  switch (season) {
    case 'winter':
      if (month === 11 && day >= 24 && day <= 26) return 'christmas';
      if ((month === 11 && day === 31) || (month === 0 && day === 1)) return 'newyear';
      return null;
    case 'spring': {
      // Easter weekend: Saturday through Monday around Easter Sunday
      const easter = easterSunday(date.getFullYear());
      return withinDays(date, new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 1), 3)
        ? 'easter'
        : null;
    }
    case 'summer': {
      const fd = fieldDaySaturday(date.getFullYear());
      if (withinDays(date, fd, 2)) return 'fieldday';
      if (month === 6 && day === 4) return 'july4';
      return null;
    }
    case 'fall':
      if (month === 9 && day === 31) return 'halloween';
      return null;
    default:
      return null;
  }
}
