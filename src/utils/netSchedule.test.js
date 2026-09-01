import { describe, it, expect } from 'vitest';
import {
  nextOccurrence,
  sortByNextOccurrence,
  upcomingNets,
  formatCountdown,
  isValidTimeUtc,
  netDurationMin,
  DEFAULT_DURATION_MIN,
} from './netSchedule.js';

// 2026-08-30 is a Sunday; helpers build UTC instants.
const utc = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));

describe('isValidTimeUtc', () => {
  it('accepts 24h HHMM', () => {
    expect(isValidTimeUtc('0000')).toBe(true);
    expect(isValidTimeUtc('2359')).toBe(true);
    expect(isValidTimeUtc('1930')).toBe(true);
  });
  it('rejects malformed times', () => {
    expect(isValidTimeUtc('2400')).toBe(false);
    expect(isValidTimeUtc('1260')).toBe(false);
    expect(isValidTimeUtc('730')).toBe(false);
    expect(isValidTimeUtc('19:30')).toBe(false);
    expect(isValidTimeUtc(1930)).toBe(false);
    expect(isValidTimeUtc('')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('finds a later-today weekly occurrence', () => {
    // Sunday net at 20:00 UTC, asked on Sunday 15:00 UTC
    const net = { day: 0, time_utc: '2000' };
    const next = nextOccurrence(net, utc(2026, 8, 30, 15, 0));
    expect(next.start.toISOString()).toBe('2026-08-30T20:00:00.000Z');
    expect(next.onNow).toBe(false);
  });

  it('wraps to next week when this week already passed', () => {
    // Sunday net at 02:00, asked Sunday 23:00 → next Sunday
    const net = { day: 0, time_utc: '0200', duration_min: 60 };
    const next = nextOccurrence(net, utc(2026, 8, 30, 23, 0));
    expect(next.start.toISOString()).toBe('2026-09-06T02:00:00.000Z');
    expect(next.start.getUTCDay()).toBe(0);
  });

  it('daily nets roll to tomorrow after today window ends', () => {
    const net = { day: 'daily', time_utc: '0015', duration_min: 30 };
    const next = nextOccurrence(net, utc(2026, 8, 30, 23, 0));
    expect(next.start.toISOString()).toBe('2026-08-31T00:15:00.000Z');
    expect(next.onNow).toBe(false);
  });

  it('reports ON NOW inside the window, including start instant', () => {
    const net = { day: 0, time_utc: '0100', duration_min: 60 };
    expect(nextOccurrence(net, utc(2026, 8, 30, 1, 0)).onNow).toBe(true);
    expect(nextOccurrence(net, utc(2026, 8, 30, 1, 30)).onNow).toBe(true);
    // At the end instant the window is closed — next week
    const after = nextOccurrence(net, utc(2026, 8, 30, 2, 0));
    expect(after.onNow).toBe(false);
    expect(after.start.toISOString()).toBe('2026-09-06T01:00:00.000Z');
  });

  it('catches a still-running occurrence that started before UTC midnight', () => {
    // Saturday 23:30 net, 60 min: at Sunday 00:10 UTC it is still on
    const net = { day: 6, time_utc: '2330', duration_min: 60 };
    const next = nextOccurrence(net, utc(2026, 8, 30, 0, 10));
    expect(next.start.toISOString()).toBe('2026-08-29T23:30:00.000Z');
    expect(next.onNow).toBe(true);
  });

  it('is computed in UTC regardless of local timezone (UTC/local edge)', () => {
    // 23:30 UTC daily net "today" — a local-time implementation in a
    // negative-offset TZ would land on a different calendar day.
    const net = { day: 'daily', time_utc: '2330' };
    const next = nextOccurrence(net, utc(2026, 8, 30, 22, 0));
    expect(next.start.getUTCHours()).toBe(23);
    expect(next.start.getUTCMinutes()).toBe(30);
    expect(next.start.getUTCDate()).toBe(30);
  });

  it('defaults duration to DEFAULT_DURATION_MIN', () => {
    const net = { day: 'daily', time_utc: '1000' };
    const next = nextOccurrence(net, utc(2026, 8, 30, 10, DEFAULT_DURATION_MIN - 1));
    expect(next.onNow).toBe(true);
    expect(netDurationMin(net)).toBe(DEFAULT_DURATION_MIN);
  });

  it('returns null for invalid nets', () => {
    expect(nextOccurrence({ day: 7, time_utc: '1000' })).toBe(null);
    expect(nextOccurrence({ day: 0, time_utc: '2500' })).toBe(null);
    expect(nextOccurrence(null)).toBe(null);
  });
});

describe('sortByNextOccurrence', () => {
  it('sorts running first, then soonest, invalid last', () => {
    const now = utc(2026, 8, 30, 12, 0); // Sunday noon UTC
    const nets = [
      { id: 'a', day: 1, time_utc: '0100' }, // Monday 01:00
      { id: 'bad', day: 0, time_utc: 'xx' },
      { id: 'b', day: 0, time_utc: '1130', duration_min: 60 }, // ON NOW
      { id: 'c', day: 'daily', time_utc: '1400' }, // today 14:00
    ];
    const order = sortByNextOccurrence(nets, now).map(({ net }) => net.id);
    expect(order).toEqual(['b', 'c', 'a', 'bad']);
  });
});

describe('upcomingNets', () => {
  const now = utc(2026, 8, 30, 12, 0);
  const nets = [
    { id: 'on', day: 0, time_utc: '1130', duration_min: 60 },
    { id: 'soon', day: 'daily', time_utc: '1300' },
    { id: 'later', day: 'daily', time_utc: '1800' },
  ];

  it('returns running and soon-starting nets within the window', () => {
    const up = upcomingNets(nets, 90, now);
    expect(up.map((u) => u.net.id)).toEqual(['on', 'soon']);
    expect(up[0].onNow).toBe(true);
    expect(up[0].minutesUntil).toBe(0);
    expect(up[1].onNow).toBe(false);
    expect(up[1].minutesUntil).toBe(60);
  });

  it('empty for bad windows and empty lists', () => {
    expect(upcomingNets(nets, -5, now)).toEqual([]);
    expect(upcomingNets([], 60, now)).toEqual([]);
    expect(upcomingNets(null, 60, now)).toEqual([]);
  });
});

describe('formatCountdown', () => {
  it('formats minutes, hours, days', () => {
    expect(formatCountdown(14 * 60000)).toBe('14m');
    expect(formatCountdown((2 * 60 + 14) * 60000)).toBe('2h 14m');
    expect(formatCountdown(3 * 60 * 60000)).toBe('3h');
    expect(formatCountdown((26 * 60 + 5) * 60000)).toBe('1d 2h');
    expect(formatCountdown(0)).toBe('0m');
  });
});
