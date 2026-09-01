/**
 * dxNewsRead — read/unread tracking for the DX News reader panel.
 *
 * Read item ids persist in localStorage (openhamclock_dxNewsRead) as a
 * JSON array, oldest-first, capped at 200 ids so the key never grows
 * unbounded (the feed itself is capped at 20 items per response, so 200
 * covers weeks of headlines).
 *
 * Also home to the panel's relative-time formatter ("3h ago").
 */

export const DX_NEWS_READ_KEY = 'openhamclock_dxNewsRead';
export const DX_NEWS_READ_CAP = 200;

/** Load persisted read ids. Corrupt/missing storage → []. */
export const loadReadIds = () => {
  try {
    const raw = localStorage.getItem(DX_NEWS_READ_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

/** Persist read ids (capped, keeping the most recent). Best-effort. */
export const saveReadIds = (ids) => {
  try {
    localStorage.setItem(DX_NEWS_READ_KEY, JSON.stringify(ids.slice(-DX_NEWS_READ_CAP)));
  } catch {}
};

/**
 * Return a new array with `id` marked read (appended). Idempotent — an
 * already-read id returns the same array. Enforces the cap by dropping
 * the oldest ids.
 */
export const markRead = (ids, id) => {
  if (!id || ids.includes(id)) return ids;
  return [...ids, id].slice(-DX_NEWS_READ_CAP);
};

/**
 * Compact relative age for a publish date: "now", "5m", "3h", "2d".
 * Invalid/missing dates → null (caller hides the field).
 */
export const relativeTime = (iso, now = new Date()) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = now.getTime() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

export default { loadReadIds, saveReadIds, markRead, relativeTime };
