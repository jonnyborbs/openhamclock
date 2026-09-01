/**
 * Net schedule — pure logic for the Nets panel (`net-schedule`).
 *
 * A net is a user-defined recurring on-air gathering:
 *   { id, name, freq_mhz?, mode?, day: 0-6 | 'daily', time_utc: 'HHMM',
 *     duration_min?, notes? }
 *
 * day uses JS Date getUTCDay() numbering (0 = Sunday … 6 = Saturday) or the
 * string 'daily'. time_utc is a 24-hour UTC wall time ('HHMM'). All next-
 * occurrence math is done in UTC milliseconds, so local DST never shifts a
 * net's start time.
 *
 * Stored in localStorage under `openhamclock_netSchedule`; the key is listed
 * in config.js SYNC_KEYS and profiles.js so it server-syncs, profiles, and
 * backs up like the rest of the user state.
 */

export const NET_SCHEDULE_KEY = 'openhamclock_netSchedule';

/** When a net has no duration_min, it counts as ON NOW for this long. */
export const DEFAULT_DURATION_MIN = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'HHMM' 24-hour validator ('0000'–'2359'). */
export const isValidTimeUtc = (s) => typeof s === 'string' && /^([01]\d|2[0-3])[0-5]\d$/.test(s);

/** Effective on-now window length for a net, in minutes. */
export const netDurationMin = (net) => {
  const d = Number(net?.duration_min);
  return Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION_MIN;
};

/**
 * Next occurrence of a net relative to `now`.
 *
 * Returns { start: Date, end: Date, onNow: boolean } — when `now` falls
 * inside a running occurrence ([start, end)), that occurrence is returned
 * with onNow=true; otherwise the soonest future start. Returns null for
 * invalid nets (bad time or day).
 */
export function nextOccurrence(net, now = new Date()) {
  if (!net || !isValidTimeUtc(net.time_utc)) return null;
  const daily = net.day === 'daily';
  const day = daily ? null : Number(net.day);
  if (!daily && (!Number.isInteger(day) || day < 0 || day > 6)) return null;

  const hh = Number(net.time_utc.slice(0, 2));
  const mm = Number(net.time_utc.slice(2, 4));
  const durMs = netDurationMin(net) * 60 * 1000;
  const nowMs = now.getTime();

  // Today's UTC date at HH:MM, then scan -1..+7 days: -1 catches an
  // occurrence that started yesterday and is still running; +7 guarantees a
  // weekly net is always found (day wrap).
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0, 0);
  for (let off = -1; off <= 7; off++) {
    const startMs = base + off * DAY_MS;
    if (!daily && new Date(startMs).getUTCDay() !== day) continue;
    if (startMs + durMs > nowMs) {
      return { start: new Date(startMs), end: new Date(startMs + durMs), onNow: nowMs >= startMs };
    }
  }
  return null; // unreachable for valid input
}

/**
 * Nets decorated with their next occurrence and sorted soonest-first
 * (running nets sort first — their start is in the past). Invalid nets
 * (no computable occurrence) go last, in input order.
 */
export function sortByNextOccurrence(list, now = new Date()) {
  const decorated = (Array.isArray(list) ? list : []).map((net, i) => ({ net, i, next: nextOccurrence(net, now) }));
  decorated.sort((a, b) => {
    if (!a.next && !b.next) return a.i - b.i;
    if (!a.next) return 1;
    if (!b.next) return -1;
    return a.next.start - b.next.start || a.i - b.i;
  });
  return decorated.map(({ net, next }) => ({ net, next }));
}

/**
 * Nets that are ON NOW or start within `withinMinutes` — the hook a later
 * notifications wave plugs into. Returns [{ net, start, end, onNow,
 * minutesUntil }] sorted soonest-first (minutesUntil is 0 when running).
 */
export function upcomingNets(list, withinMinutes, now = new Date()) {
  const horizon = Number(withinMinutes);
  if (!Number.isFinite(horizon) || horizon < 0) return [];
  return sortByNextOccurrence(list, now)
    .filter(({ next }) => next && (next.onNow || next.start.getTime() - now.getTime() <= horizon * 60 * 1000))
    .map(({ net, next }) => ({
      net,
      start: next.start,
      end: next.end,
      onNow: next.onNow,
      minutesUntil: next.onNow ? 0 : Math.ceil((next.start.getTime() - now.getTime()) / 60000),
    }));
}

/** "2h 14m" / "14m" / "3d 4h" for a positive millisecond delta. */
export function formatCountdown(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Load the net list from localStorage ([] on absence/corruption). */
export function loadNetSchedule() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NET_SCHEDULE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist the net list (the settings-sync interceptor picks up the write). */
export function saveNetSchedule(list) {
  try {
    localStorage.setItem(NET_SCHEDULE_KEY, JSON.stringify(list));
  } catch {}
}
