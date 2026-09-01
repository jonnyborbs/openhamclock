/**
 * Contest calendar routes.
 *
 * Source chain (best first):
 *   1. WA7BNM iCal (weeklycontcustom.php) — structured UTC timestamps, one
 *      VEVENT per operating session, stable per-contest detail URLs.
 *   2. WA7BNM RSS (calendar.rss) — free-text dates, parsed leniently.
 *   3. Stale cache (up to 24 h old).
 *   4. Built-in calculated calendar (approximate weekend math).
 *
 * Response envelope: { contests: [...], source, fetchedAt } so the client
 * can tell real feed data from a degraded fallback. Each contest:
 *   { name, start, end, mode, status, url, sessions: [{ start, end }] }
 * where start/end describe the current-or-next operating session and
 * sessions lists every remaining session (multi-session events like CWT).
 */

const ICAL_URL = 'https://www.contestcalendar.com/weeklycontcustom.php';
const RSS_URL = 'https://www.contestcalendar.com/calendar.rss';
const USER_AGENT = 'OpenHamClock (+https://openhamclock.com)';
const FETCH_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_STALE_MS = 24 * 60 * 60 * 1000;
// Safety bound only — the 8-day feed window is the real limit (~40 events).
const MAX_CONTESTS = 100;

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// Detect mode from the contest name — neither feed carries a mode field.
function inferMode(name) {
  const n = name.toLowerCase();
  if (n.includes('cw') || n.includes('morse') || n.includes('telegraphy') || n.includes('slow speed')) return 'CW';
  if (n.includes('ssb') || n.includes('phone') || n.includes('sideband')) return 'SSB';
  if (n.includes('rtty')) return 'RTTY';
  if (n.includes('ft4') || n.includes('ft8') || n.includes('digi') || n.includes('psk') || n.includes('hell'))
    return 'Digital';
  if (n.includes('vhf') || n.includes('uhf')) return 'VHF';
  return 'Mixed';
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // last, to avoid double-unescaping
}

/**
 * Parse the WA7BNM iCal feed into raw session events.
 * Handles RFC 5545 line folding; tolerates DTSTART/DTEND parameters.
 * Returns [{ name, start: Date, end: Date, url }].
 */
function parseContestICS(text) {
  // Unfold: a CRLF (or LF) followed by a space/tab continues the prior line
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events = [];

  const blocks = unfolded.split('BEGIN:VEVENT').slice(1);
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0];
    const fields = {};
    for (const line of body.split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      // Strip parameters: "DTSTART;TZID=..." → "DTSTART"
      const key = line.slice(0, idx).split(';')[0].toUpperCase();
      fields[key] = line.slice(idx + 1).trim();
    }

    const name = fields.SUMMARY && decodeEntities(fields.SUMMARY).trim();
    const start = parseICSDate(fields.DTSTART);
    const end = parseICSDate(fields.DTEND);
    if (!name || !start || !end) continue;

    events.push({ name, start, end, url: fields.URL || null });
  }
  return events;
}

// "20260828T220000Z" or "20260828" (all-day) → Date (UTC)
function parseICSDate(value) {
  if (!value) return null;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(s || 0)));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Group raw session events into one contest per event series and pick the
 * session the panel should count down to: the active one if live, else the
 * next upcoming one. Series identity is the detail URL (stable per contest
 * across sessions), falling back to the name.
 */
function groupContestSessions(events, now = new Date()) {
  const groups = new Map();
  for (const ev of events) {
    if (!(ev.start instanceof Date) || !(ev.end instanceof Date)) continue;
    const key = ev.url || ev.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }

  const contests = [];
  for (const sessions of groups.values()) {
    const remaining = sessions.filter((s) => s.end >= now).sort((a, b) => a.start - b.start);
    if (remaining.length === 0) continue;

    const current = remaining[0];
    contests.push({
      name: current.name,
      start: current.start.toISOString(),
      end: current.end.toISOString(),
      mode: inferMode(current.name),
      status: now >= current.start && now <= current.end ? 'active' : 'upcoming',
      url: current.url,
      sessions: remaining.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    });
  }

  contests.sort((a, b) => new Date(a.start) - new Date(b.start));
  return contests.slice(0, MAX_CONTESTS);
}

/**
 * Resolve "Aug 29" to a full date near `now` — the feed omits the year.
 * Picks the candidate year (last/this/next) closest to now, so a January
 * contest read in late December lands in January of NEXT year, not eleven
 * months in the past.
 */
function resolveNearestDate(month, day, hours, minutes, now) {
  const year = now.getUTCFullYear();
  let best = null;
  for (const y of [year - 1, year, year + 1]) {
    const candidate = new Date(Date.UTC(y, month, day, hours, minutes));
    if (!best || Math.abs(candidate - now) < Math.abs(best - now)) best = candidate;
  }
  return best;
}

/**
 * Parse one RSS description into session windows.
 * Handles every shape the feed currently emits:
 *   "0100Z-0130Z, Aug 28"                                (single session)
 *   "1300Z, Jan 31 to 1300Z, Feb 1"                      (spanning range)
 *   "0600Z Aug 29 to 0559Z, Aug 30"                      (comma optional)
 *   "2200Z, Aug 28 to 1200Z, Aug 29 and 1200Z-2359Z, Aug 30"  (multi-session)
 *   "1700Z-1800Z, Sep 3 (CW) and 1800Z-1900Z, Sep 3 (SSB)"    (annotated)
 * Returns [{ start: Date, end: Date }] (may be empty).
 */
function parseSessionText(desc, now = new Date()) {
  const sessions = [];
  for (const segment of desc.split(/\s+and\s+/i)) {
    // Spanning range: "HHMMZ[,] Mon D to HHMMZ[,] Mon D"
    const range = segment.match(
      /(\d{4})Z,?\s+([A-Za-z]{3,})\s+(\d{1,2})\s+to\s+(\d{4})Z,?\s+([A-Za-z]{3,})\s+(\d{1,2})/i,
    );
    if (range) {
      const [, st, sm, sd, et, em, ed] = range;
      const startMonth = MONTHS[sm.slice(0, 3).toLowerCase()];
      const endMonth = MONTHS[em.slice(0, 3).toLowerCase()];
      if (startMonth === undefined || endMonth === undefined) continue;
      const start = resolveNearestDate(startMonth, +sd, +st.slice(0, 2), +st.slice(2, 4), now);
      let end = resolveNearestDate(endMonth, +ed, +et.slice(0, 2), +et.slice(2, 4), now);
      // Nearest-to-now can land the end before the start across a year
      // boundary (start Dec 31, end Jan 1) — roll it forward.
      while (end < start)
        end = new Date(
          Date.UTC(
            end.getUTCFullYear() + 1,
            end.getUTCMonth(),
            end.getUTCDate(),
            end.getUTCHours(),
            end.getUTCMinutes(),
          ),
        );
      sessions.push({ start, end });
      continue;
    }

    // Same-day window: "HHMMZ-HHMMZ[,] Mon D"
    const sameDay = segment.match(/(\d{4})Z-(\d{4})Z,?\s+([A-Za-z]{3,})\s+(\d{1,2})/i);
    if (sameDay) {
      const [, st, et, mon, day] = sameDay;
      const month = MONTHS[mon.slice(0, 3).toLowerCase()];
      if (month === undefined) continue;
      const start = resolveNearestDate(month, +day, +st.slice(0, 2), +st.slice(2, 4), now);
      const end = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), +et.slice(0, 2), +et.slice(2, 4)),
      );
      // Overnight window (end time before start time) → next day
      if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
      sessions.push({ start, end });
    }
  }
  return sessions;
}

// Extract a tag's text content, tolerating CDATA wrapping and nested markup.
function getTagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  let text = m[1].trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) text = cdata[1].trim();
  return decodeEntities(text);
}

/**
 * Parse the WA7BNM RSS feed into the same grouped-contest shape as the
 * iCal path. Each <item> is one contest; its description may list several
 * sessions.
 */
function parseContestRSS(xml, now = new Date()) {
  const events = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const name = getTagText(item, 'title');
    const desc = getTagText(item, 'description');
    if (!name || !desc) continue;
    const url = getTagText(item, 'link');

    for (const session of parseSessionText(desc, now)) {
      events.push({ name, start: session.start, end: session.end, url });
    }
  }
  return groupContestSessions(events, now);
}

module.exports = function (app, ctx) {
  const { fetch, logDebug, logErrorOnce } = ctx;

  const cache = { payload: null, timestamp: 0 };

  async function fetchText(url, accept) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  // Try iCal, then RSS. Returns { contests, source } — empty contests only
  // if both upstream formats failed or parsed to nothing.
  async function fetchUpstreamContests() {
    try {
      const contests = parseContestICS(await fetchText(ICAL_URL, 'text/calendar, text/plain'));
      const grouped = groupContestSessions(contests);
      if (grouped.length > 0) return { contests: grouped, source: 'wa7bnm-ical' };
      logDebug('[Contests] iCal parsed to 0 contests, trying RSS');
    } catch (error) {
      if (error.name !== 'AbortError') logErrorOnce('Contests iCal', error.message);
    }

    try {
      const contests = parseContestRSS(await fetchText(RSS_URL, 'application/rss+xml, application/xml, text/xml'));
      if (contests.length > 0) return { contests, source: 'wa7bnm-rss' };
      logDebug('[Contests] RSS parsed to 0 contests');
    } catch (error) {
      if (error.name !== 'AbortError') logErrorOnce('Contests RSS', error.message);
    }

    return { contests: [], source: 'none' };
  }

  app.get('/api/contests', async (req, res) => {
    const now = Date.now();

    if (cache.payload && now - cache.timestamp < CACHE_TTL_MS) {
      return res.json(cache.payload);
    }

    // Coalesced: concurrent expired-cache hits share one upstream fetch
    const { contests, source } = await ctx.upstream.fetch('contests:wa7bnm', fetchUpstreamContests);

    if (contests.length > 0) {
      const payload = { contests, source, fetchedAt: new Date(now).toISOString() };
      cache.payload = payload;
      cache.timestamp = now;
      logDebug('[Contests]', source + ':', contests.length, 'contests');
      return res.json(payload);
    }

    // Both feeds down/empty: serve stale cache before synthesizing
    if (cache.payload && now - cache.timestamp < MAX_STALE_MS) {
      logDebug('[Contests] Upstream failed, returning stale cache');
      return res.json({ ...cache.payload, stale: true });
    }

    try {
      const calculated = calculateUpcomingContests();
      logDebug('[Contests] Using calculated:', calculated.length, 'contests');
      return res.json({ contests: calculated, source: 'calculated', fetchedAt: new Date(now).toISOString() });
    } catch (error) {
      logErrorOnce('Contests', error.message);
    }

    res.json({ contests: [], source: 'none', fetchedAt: new Date(now).toISOString() });
  });

  // Last-resort synthesized calendar: approximate weekend math for the
  // majors plus fixed weekly mini-contest slots. Start times are rough
  // (00:00Z Saturday) — only served when both WA7BNM formats are down.
  function calculateUpcomingContests() {
    const now = new Date();
    const contests = [];

    // Major contest definitions with typical schedules
    const majorContests = [
      { name: 'CQ WW DX CW', month: 10, weekend: -1, duration: 48, mode: 'CW' }, // Last full weekend Nov
      { name: 'CQ WW DX SSB', month: 9, weekend: -1, duration: 48, mode: 'SSB' }, // Last full weekend Oct
      { name: 'ARRL DX CW', month: 1, weekend: 3, duration: 48, mode: 'CW' }, // 3rd full weekend Feb
      { name: 'ARRL DX SSB', month: 2, weekend: 1, duration: 48, mode: 'SSB' }, // 1st full weekend Mar
      { name: 'CQ WPX SSB', month: 2, weekend: -1, duration: 48, mode: 'SSB' }, // Last full weekend Mar
      { name: 'CQ WPX CW', month: 4, weekend: -1, duration: 48, mode: 'CW' }, // Last full weekend May
      { name: 'IARU HF Championship', month: 6, weekend: 2, duration: 24, mode: 'Mixed' }, // 2nd full weekend Jul
      { name: 'ARRL Field Day', month: 5, weekend: 4, duration: 27, mode: 'Mixed' }, // 4th full weekend Jun
      { name: 'ARRL Sweepstakes CW', month: 10, weekend: 1, duration: 24, mode: 'CW' }, // 1st full weekend Nov
      { name: 'ARRL Sweepstakes SSB', month: 10, weekend: 3, duration: 24, mode: 'SSB' }, // 3rd full weekend Nov
      { name: 'ARRL 10m Contest', month: 11, weekend: 2, duration: 48, mode: 'Mixed' }, // 2nd full weekend Dec
      { name: 'ARRL RTTY Roundup', month: 0, weekend: 1, duration: 24, mode: 'RTTY' }, // 1st full weekend Jan
      { name: 'NA QSO Party CW', month: 0, weekend: 2, duration: 12, mode: 'CW' },
      { name: 'NA QSO Party SSB', month: 0, weekend: 3, duration: 12, mode: 'SSB' },
      { name: 'CQ 160m CW', month: 0, weekend: -1, duration: 42, mode: 'CW' }, // Last full weekend Jan
      { name: 'CQ 160m SSB', month: 1, weekend: -1, duration: 42, mode: 'SSB' }, // Last full weekend Feb
      { name: 'CQ WW RTTY', month: 8, weekend: -1, duration: 48, mode: 'RTTY' },
      { name: 'JIDX CW', month: 3, weekend: 2, duration: 48, mode: 'CW' },
      { name: 'JIDX SSB', month: 10, weekend: 2, duration: 48, mode: 'SSB' },
      { name: 'ARRL VHF Contest', month: 0, weekend: 3, duration: 33, mode: 'Mixed' }, // 3rd weekend Jan
      { name: 'ARRL June VHF', month: 5, weekend: 2, duration: 33, mode: 'Mixed' }, // 2nd weekend Jun
      { name: 'ARRL Sept VHF', month: 8, weekend: 2, duration: 33, mode: 'Mixed' }, // 2nd weekend Sep
      { name: 'Winter Field Day', month: 0, weekend: -1, duration: 24, mode: 'Mixed' }, // Last weekend Jan
      { name: 'CQWW WPX RTTY', month: 1, weekend: 2, duration: 48, mode: 'RTTY' }, // 2nd weekend Feb
      { name: 'Stew Perry Topband', month: 11, weekend: 4, duration: 14, mode: 'CW' }, // 4th weekend Dec
      { name: 'RAC Canada Day', month: 6, weekend: 1, duration: 24, mode: 'Mixed' }, // 1st weekend Jul
      { name: 'RAC Winter Contest', month: 11, weekend: -1, duration: 24, mode: 'Mixed' }, // Last weekend Dec
      { name: 'NAQP RTTY', month: 1, weekend: 4, duration: 12, mode: 'RTTY' }, // 4th weekend Feb
      { name: 'NAQP RTTY', month: 6, weekend: 3, duration: 12, mode: 'RTTY' }, // 3rd weekend Jul
    ];

    // Weekly mini-contests (CWT, SST, etc.) - dayOfWeek: 0=Sun, 1=Mon, ... 6=Sat
    const weeklyContests = [
      { name: 'CWT 1300z', dayOfWeek: 3, hour: 13, duration: 1, mode: 'CW' }, // Wednesday
      { name: 'CWT 1900z', dayOfWeek: 3, hour: 19, duration: 1, mode: 'CW' }, // Wednesday
      { name: 'CWT 0300z', dayOfWeek: 4, hour: 3, duration: 1, mode: 'CW' }, // Thursday
      { name: 'CWT 0700z', dayOfWeek: 4, hour: 7, duration: 1, mode: 'CW' }, // Thursday
      { name: 'NCCC Sprint', dayOfWeek: 5, hour: 3, minute: 30, duration: 0.5, mode: 'CW' }, // Friday
      { name: 'K1USN SST', dayOfWeek: 0, hour: 0, duration: 1, mode: 'CW' }, // Sunday 0000z (Sat evening US)
      { name: 'K1USN SST', dayOfWeek: 1, hour: 20, duration: 1, mode: 'CW' }, // Monday 2000z
      { name: 'ICWC MST', dayOfWeek: 1, hour: 13, duration: 1, mode: 'CW' }, // Monday 1300z
      { name: 'ICWC MST', dayOfWeek: 1, hour: 19, duration: 1, mode: 'CW' }, // Monday 1900z
      { name: 'ICWC MST', dayOfWeek: 2, hour: 3, duration: 1, mode: 'CW' }, // Tuesday 0300z
      { name: 'SKCC Sprint', dayOfWeek: 3, hour: 0, duration: 2, mode: 'CW' }, // Wednesday 0000z
      { name: 'QRP Fox Hunt', dayOfWeek: 3, hour: 2, duration: 1.5, mode: 'CW' }, // Wednesday 0200z
      { name: 'RTTY Weekday Sprint', dayOfWeek: 2, hour: 23, duration: 1, mode: 'RTTY' }, // Tuesday 2300z
    ];

    // Calculate next occurrences of weekly contests
    weeklyContests.forEach((contest) => {
      const next = new Date(now);
      const currentDay = now.getUTCDay();
      let daysUntil = contest.dayOfWeek - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0) {
        // Check if it's today but already passed
        const todayStart = new Date(now);
        todayStart.setUTCHours(contest.hour, contest.minute || 0, 0, 0);
        if (now > todayStart) daysUntil = 7;
      }

      next.setUTCDate(now.getUTCDate() + daysUntil);
      next.setUTCHours(contest.hour, contest.minute || 0, 0, 0);

      const endTime = new Date(next.getTime() + contest.duration * 3600000);

      contests.push({
        name: contest.name,
        start: next.toISOString(),
        end: endTime.toISOString(),
        mode: contest.mode,
        status: now >= next && now <= endTime ? 'active' : 'upcoming',
        url: `https://www.contestcalendar.com/weeklycont.php`,
        sessions: [{ start: next.toISOString(), end: endTime.toISOString() }],
      });
    });

    // Calculate next occurrences of major contests
    const year = now.getFullYear();
    majorContests.forEach((contest) => {
      for (let y = year; y <= year + 1; y++) {
        let startDate;

        if (contest.weekend === -1) {
          // Last weekend of month
          startDate = getLastWeekendOfMonth(y, contest.month);
        } else {
          // Nth weekend of month
          startDate = getNthWeekendOfMonth(y, contest.month, contest.weekend);
        }

        // Most contests start at 00:00 UTC Saturday
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(startDate.getTime() + contest.duration * 3600000);

        if (endDate > now) {
          const status = now >= startDate && now <= endDate ? 'active' : 'upcoming';
          contests.push({
            name: contest.name,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            mode: contest.mode,
            status: status,
            url: `https://www.contestcalendar.com/alphabetical.php`,
            sessions: [{ start: startDate.toISOString(), end: endDate.toISOString() }],
          });
          break; // Only add next occurrence
        }
      }
    });

    // Sort by start date
    contests.sort((a, b) => new Date(a.start) - new Date(b.start));

    return contests;
  }

  function getNthWeekendOfMonth(year, month, n) {
    const date = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    let weekendCount = 0;

    while (date.getUTCMonth() === month) {
      if (date.getUTCDay() === 6) {
        // Saturday
        weekendCount++;
        if (weekendCount === n) return new Date(date);
      }
      date.setUTCDate(date.getUTCDate() + 1);
    }

    return date;
  }

  function getLastWeekendOfMonth(year, month) {
    // Start from last day of month and work backwards
    const date = new Date(Date.UTC(year, month + 1, 0)); // Last day of month

    while (date.getUTCDay() !== 6) {
      // Find last Saturday
      date.setUTCDate(date.getUTCDate() - 1);
    }

    return date;
  }
};

// Pure helpers exported for tests
module.exports.parseContestICS = parseContestICS;
module.exports.parseContestRSS = parseContestRSS;
module.exports.parseSessionText = parseSessionText;
module.exports.groupContestSessions = groupContestSessions;
module.exports.resolveNearestDate = resolveNearestDate;
module.exports.inferMode = inferMode;
