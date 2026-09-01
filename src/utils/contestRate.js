/**
 * contestRate — pure QSO-rate math for the Contest layout's rate meter.
 *
 * Works on logbook QSO records (see logbookStore): timestamps come from the
 * ADIF-style `qso_date` (YYYYMMDD) + `time_on` (HHMM or HHMMSS) fields, both
 * UTC. Records with unparseable date/time simply don't count — no guessing.
 *
 * All functions take `now` (ms) explicitly so they are trivially testable;
 * callers pass Date.now().
 */

/**
 * UTC timestamp (ms) for a logbook QSO, or null when the record's
 * qso_date/time_on can't be parsed.
 */
export const qsoTimestampMs = (qso) => {
  const date = String(qso?.qso_date || '').trim();
  const time = String(qso?.time_on || '').trim();
  if (!/^\d{8}$/.test(date) || !/^\d{4}(\d{2})?$/.test(time)) return null;
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  const h = Number(time.slice(0, 2));
  const mi = Number(time.slice(2, 4));
  const s = time.length === 6 ? Number(time.slice(4, 6)) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
};

/** Timestamps (ms, unsorted) for a QSO list — unparseable records dropped. */
export const qsoTimestamps = (qsos) => (Array.isArray(qsos) ? qsos : []).map(qsoTimestampMs).filter((t) => t != null);

/**
 * Number of timestamps inside the trailing window (now - windowMs, now].
 * Future timestamps (clock skew, hand-edited logs) are ignored.
 */
export const countInWindow = (timestamps, windowMs, now) => {
  if (!Array.isArray(timestamps) || !(windowMs > 0)) return 0;
  const start = now - windowMs;
  let n = 0;
  for (const t of timestamps) {
    if (t > start && t <= now) n++;
  }
  return n;
};

/**
 * QSOs-per-hour rate extrapolated from the trailing window.
 * countInWindow scaled to one hour, rounded to an integer.
 */
export const ratePerHour = (timestamps, windowMs, now) => {
  if (!(windowMs > 0)) return 0;
  return Math.round((countInWindow(timestamps, windowMs, now) * 3600000) / windowMs);
};

/**
 * Trailing sparkline buckets: `buckets` counts covering the last
 * buckets × bucketMs, oldest first, newest (the bucket ending at `now`) last.
 *
 * @returns {number[]} length === buckets
 */
export const sparklineBuckets = (timestamps, { buckets = 12, bucketMs = 5 * 60 * 1000, now }) => {
  const out = new Array(buckets).fill(0);
  if (!Array.isArray(timestamps) || buckets <= 0 || !(bucketMs > 0)) return out;
  const start = now - buckets * bucketMs;
  for (const t of timestamps) {
    if (t <= start || t > now) continue;
    // Buckets are half-open (lower, upper]: a timestamp exactly on an edge
    // belongs to the bucket ending there — same convention as countInWindow.
    const idx = Math.ceil((t - start) / bucketMs) - 1;
    out[idx]++;
  }
  return out;
};

export default { qsoTimestampMs, qsoTimestamps, countInWindow, ratePerHour, sparklineBuckets };
