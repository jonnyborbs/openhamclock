/**
 * Tests for server/routes/contests.js — the WA7BNM contest calendar proxy.
 *
 * Unit-tests the pure parsers (iCal, RSS session text, grouping, year
 * resolution) and exercises the route against a stub app with an injected
 * ctx.fetch: iCal success, RSS fallback, stale-cache fallback, and the
 * calculated last resort.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./contests.js');
const { parseContestICS, parseContestRSS, parseSessionText, groupContestSessions, resolveNearestDate, inferMode } =
  route;

const NOW = new Date('2026-08-28T12:00:00Z');

const ics = (events) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid || Math.random()}@contestcalendar.com`,
      `DTSTART:${e.start}`,
      `DTEND:${e.end}`,
      `SUMMARY:${e.name}`,
      `URL:${e.url || 'http://www.contestcalendar.com/contestdetails.php?ref=1'}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');

describe('parseContestICS', () => {
  it('parses VEVENTs into dated sessions', () => {
    const events = parseContestICS(
      ics([{ name: 'NCCC FT4 Sprint', start: '20260828T010000Z', end: '20260828T013000Z' }]),
    );
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('NCCC FT4 Sprint');
    expect(events[0].start.toISOString()).toBe('2026-08-28T01:00:00.000Z');
    expect(events[0].end.toISOString()).toBe('2026-08-28T01:30:00.000Z');
    expect(events[0].url).toContain('contestdetails.php');
  });

  it('unfolds RFC 5545 folded lines', () => {
    const folded = ics([{ name: 'PLACEHOLDER', start: '20260828T010000Z', end: '20260828T013000Z' }]).replace(
      'SUMMARY:PLACEHOLDER',
      'SUMMARY:A Very Long Con\r\n test Name',
    );
    expect(parseContestICS(folded)[0].name).toBe('A Very Long Contest Name');
  });

  it('drops events with unparseable dates instead of crashing', () => {
    const events = parseContestICS(ics([{ name: 'Broken', start: 'garbage', end: '20260828T013000Z' }]));
    expect(events).toEqual([]);
  });

  it('parses all-day DATE values', () => {
    const events = parseContestICS(ics([{ name: 'All Day', start: '20260829', end: '20260830' }]));
    expect(events[0].start.toISOString()).toBe('2026-08-29T00:00:00.000Z');
  });
});

describe('groupContestSessions', () => {
  const session = (start, end, over = {}) => ({
    name: 'CWops Test (CWT)',
    start: new Date(start),
    end: new Date(end),
    url: 'http://www.contestcalendar.com/contestdetails.php?ref=498',
    ...over,
  });

  it('merges multi-session events into one contest pointing at the next session', () => {
    const contests = groupContestSessions(
      [
        session('2026-08-27T03:00:00Z', '2026-08-27T04:00:00Z'), // past
        session('2026-09-02T13:00:00Z', '2026-09-02T14:00:00Z'), // next
        session('2026-09-02T19:00:00Z', '2026-09-02T20:00:00Z'),
      ],
      NOW,
    );
    expect(contests).toHaveLength(1);
    expect(contests[0].start).toBe('2026-09-02T13:00:00.000Z');
    expect(contests[0].status).toBe('upcoming');
    expect(contests[0].sessions).toHaveLength(2); // past session dropped
  });

  it('marks a contest active when now is inside a session', () => {
    const contests = groupContestSessions([session('2026-08-28T11:00:00Z', '2026-08-28T13:00:00Z')], NOW);
    expect(contests[0].status).toBe('active');
  });

  it('drops contests whose sessions have all ended, and does NOT cap at 20', () => {
    const events = [session('2026-08-20T00:00:00Z', '2026-08-20T01:00:00Z', { url: 'http://x/past' })];
    for (let i = 0; i < 35; i++) {
      events.push(
        session(`2026-08-29T0${i % 10}:00:00Z`, '2026-08-30T00:00:00Z', {
          name: `Contest ${i}`,
          url: `http://x/${i}`,
        }),
      );
    }
    const contests = groupContestSessions(events, NOW);
    expect(contests).toHaveLength(35);
    expect(contests.find((c) => c.url === 'http://x/past')).toBeUndefined();
  });
});

describe('parseSessionText', () => {
  it('parses a same-day window', () => {
    const [s] = parseSessionText('0100Z-0130Z, Aug 28', NOW);
    expect(s.start.toISOString()).toBe('2026-08-28T01:00:00.000Z');
    expect(s.end.toISOString()).toBe('2026-08-28T01:30:00.000Z');
  });

  it('parses a spanning range with optional comma', () => {
    const [s] = parseSessionText('0600Z Aug 29 to 0559Z, Aug 30', NOW);
    expect(s.start.toISOString()).toBe('2026-08-29T06:00:00.000Z');
    expect(s.end.toISOString()).toBe('2026-08-30T05:59:00.000Z');
  });

  it('parses multi-session "and" descriptions into separate sessions', () => {
    const sessions = parseSessionText('2200Z, Aug 28 to 1200Z, Aug 29 and 1200Z-2359Z, Aug 30', NOW);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].start.toISOString()).toBe('2026-08-28T22:00:00.000Z');
    expect(sessions[1].end.toISOString()).toBe('2026-08-30T23:59:00.000Z');
  });

  it('parses mode-annotated sessions', () => {
    const sessions = parseSessionText('1700Z-1800Z, Sep 3 (CW) and 1800Z-1900Z, Sep 3 (SSB)', NOW);
    expect(sessions).toHaveLength(2);
  });

  it('rolls an overnight same-day window to the next day', () => {
    const [s] = parseSessionText('2300Z-0100Z, Aug 28', NOW);
    expect(s.end.toISOString()).toBe('2026-08-29T01:00:00.000Z');
  });

  it('resolves January contests read in late December to NEXT year', () => {
    const december = new Date('2026-12-28T12:00:00Z');
    const [s] = parseSessionText('1300Z-1400Z, Jan 2', december);
    expect(s.start.toISOString()).toBe('2027-01-02T13:00:00.000Z');
  });

  it('handles a Dec-to-Jan spanning range across the year boundary', () => {
    const december = new Date('2026-12-28T12:00:00Z');
    const [s] = parseSessionText('2200Z, Dec 31 to 0200Z, Jan 1', december);
    expect(s.start.toISOString()).toBe('2026-12-31T22:00:00.000Z');
    expect(s.end.toISOString()).toBe('2027-01-01T02:00:00.000Z');
  });
});

describe('resolveNearestDate', () => {
  it('keeps nearby dates in the current year', () => {
    expect(resolveNearestDate(8, 5, 0, 0, NOW).toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });
});

describe('parseContestRSS', () => {
  const rss = (items) =>
    `<?xml version="1.0"?><rss><channel>${items
      .map(
        (i) =>
          `<item><title>${i.title}</title><link>${i.link || 'http://x'}</link><description>${i.desc}</description></item>`,
      )
      .join('')}</channel></rss>`;

  it('parses items and infers mode from the name', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const contests = parseContestRSS(rss([{ title: 'Weekly RTTY Test', desc: '0145Z-0215Z, Aug 29' }]), NOW);
    vi.useRealTimers();
    expect(contests).toHaveLength(1);
    expect(contests[0].mode).toBe('RTTY');
    expect(contests[0].start).toBe('2026-08-29T01:45:00.000Z');
  });

  it('handles CDATA-wrapped fields and HTML entities', () => {
    const contests = parseContestRSS(
      rss([{ title: '<![CDATA[Fists &amp; Friends Sprint]]>', desc: '<![CDATA[0000Z-0200Z, Aug 30]]>' }]),
      NOW,
    );
    expect(contests).toHaveLength(1);
    expect(contests[0].name).toBe('Fists & Friends Sprint');
  });

  it('drops items with no parseable session but keeps the rest', () => {
    const contests = parseContestRSS(
      rss([
        { title: 'Good One', desc: '0000Z-0100Z, Aug 30' },
        { title: 'Bad One', desc: 'sometime this weekend, probably' },
      ]),
      NOW,
    );
    expect(contests.map((c) => c.name)).toEqual(['Good One']);
  });
});

describe('inferMode', () => {
  it('detects modes from names', () => {
    expect(inferMode('CWops Test (CWT)')).toBe('CW');
    expect(inferMode('Phone Weekly Test')).toBe('SSB');
    expect(inferMode('NCCC FT4 Sprint')).toBe('Digital');
    expect(inferMode('VHF-UHF FT8 Activity Contest')).toBe('Digital'); // FT8 beats VHF
    expect(inferMode('ARRL June VHF')).toBe('VHF');
    expect(inferMode('K1USN Slow Speed Test')).toBe('CW');
    expect(inferMode('Feld Hell Sprint')).toBe('Digital');
    expect(inferMode('U.S. Islands QSO Party')).toBe('Mixed');
  });
});

describe('GET /api/contests (route)', () => {
  let handler;
  let ctx;

  const stubApp = { get: (path, fn) => (handler = fn) };
  const runRequest = async () => {
    let body;
    const res = { json: (b) => (body = b), status: () => res };
    await handler({}, res);
    return body;
  };
  const okText = (text) => Promise.resolve({ ok: true, text: () => Promise.resolve(text) });

  beforeEach(() => {
    ctx = {
      fetch: vi.fn(),
      upstream: { fetch: (key, fn) => fn() },
      logDebug: () => {},
      logErrorOnce: () => {},
    };
  });

  it('serves grouped iCal data with source metadata and caches it', async () => {
    ctx.fetch.mockImplementation(() =>
      okText(ics([{ name: 'Future Contest', start: '20990828T010000Z', end: '20990828T013000Z' }])),
    );
    route(stubApp, ctx);

    const body = await runRequest();
    expect(body.source).toBe('wa7bnm-ical');
    expect(body.contests).toHaveLength(1);
    expect(body.fetchedAt).toBeTruthy();

    await runRequest();
    expect(ctx.fetch).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it('falls back to RSS when iCal fails', async () => {
    ctx.fetch.mockImplementation((url) => {
      if (url.includes('weeklycontcustom')) return Promise.resolve({ ok: false, status: 500 });
      return okText(
        '<rss><channel><item><title>RSS Contest</title><link>http://x</link><description>0000Z-2359Z, Dec 31</description></item></channel></rss>',
      );
    });
    route(stubApp, ctx);

    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const body = await runRequest();
    vi.useRealTimers();
    expect(body.source).toBe('wa7bnm-rss');
    expect(body.contests[0].name).toBe('RSS Contest');
  });

  it('falls back to the calculated calendar when both feeds fail cold', async () => {
    ctx.fetch.mockRejectedValue(new Error('network down'));
    route(stubApp, ctx);

    const body = await runRequest();
    expect(body.source).toBe('calculated');
    expect(body.contests.length).toBeGreaterThan(10);
    expect(body.contests[0].sessions).toHaveLength(1);
  });

  it('prefers stale cache over the calculated calendar', async () => {
    let fail = false;
    ctx.fetch.mockImplementation(() => {
      if (fail) return Promise.reject(new Error('down'));
      return okText(ics([{ name: 'Cached Contest', start: '20990828T010000Z', end: '20990828T013000Z' }]));
    });
    route(stubApp, ctx);

    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await runRequest(); // primes cache
    fail = true;
    vi.setSystemTime(new Date(NOW.getTime() + 35 * 60 * 1000)); // past TTL, within stale window
    const body = await runRequest();
    vi.useRealTimers();

    expect(body.stale).toBe(true);
    expect(body.contests[0].name).toBe('Cached Contest');
  });
});
