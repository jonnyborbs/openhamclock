/**
 * Contest start reminders — per-contest opt-in for the "Contest Starts"
 * alert feed. ContestPanel's 🔔 buttons toggle ids in localStorage; App.jsx
 * reads the set when computing which contests may alert. With no reminders
 * set, the feed alerts for nothing (strictly opt-in per contest).
 *
 * A reminder id is `${name}|${startISO}` — the WA7BNM feed carries no
 * upstream id, and name+start uniquely identifies one occurrence (so a
 * weekly contest doesn't alert forever off one toggle).
 */

const LS_KEY = 'openhamclock_contestReminders';

/** Window event fired whenever the reminder set changes (same-tab sync). */
export const CONTEST_REMINDERS_EVENT = 'ohc-contest-reminders-changed';

/** Stable id for one contest occurrence. */
export function contestReminderId(contest) {
  return `${contest?.name || ''}|${contest?.start || ''}`;
}

/**
 * Read the persisted reminder ids. Self-pruning: ids whose start time is
 * more than 48 h in the past are dropped so the list can't grow forever.
 */
export function getContestReminders(now = Date.now()) {
  let ids = [];
  try {
    const stored = JSON.parse(localStorage.getItem(LS_KEY));
    if (Array.isArray(stored)) ids = stored.filter((id) => typeof id === 'string');
  } catch {}
  const kept = ids.filter((id) => {
    const start = Date.parse(id.slice(id.lastIndexOf('|') + 1));
    return !Number.isFinite(start) || start > now - 48 * 60 * 60 * 1000;
  });
  if (kept.length !== ids.length) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(kept));
    } catch {}
  }
  return kept;
}

/**
 * Toggle the reminder for one contest. Persists, fires the change event,
 * and returns the new reminder id array.
 */
export function toggleContestReminder(contest) {
  const id = contestReminderId(contest);
  const current = getContestReminders();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {}
  try {
    window.dispatchEvent(new Event(CONTEST_REMINDERS_EVENT));
  } catch {}
  return next;
}
