/**
 * groupLogSync — client side of shared multi-operator log sessions.
 *
 * Pairs with server/routes/group-log.js. One operator creates a session and
 * shares the invite code; every member's OpenHamClock mirrors the QSOs they
 * log locally (from any entry point — Logbook panel, Log QSO popup, contest
 * layout — everything funnels through logbookStore) into the session, and
 * polls the merged log so all stations see the combined contacts and can
 * dupe-check against them.
 *
 * Design notes:
 * - The merged group log lives here, NOT in the personal logbook. Other
 *   operators' QSOs never silently enter your IndexedDB log; there is an
 *   explicit "import to my logbook" action instead (records carry the ADIF
 *   OPERATOR field so a merged export still attributes each contact).
 * - Mirroring is diff-based: a snapshot of local QSO ids is taken when the
 *   session starts, and only QSOs added after that are pushed (client id =
 *   local id, so retries and reloads are idempotent server-side). Edits and
 *   deletions of already-mirrored QSOs propagate too. The mirrored-id set
 *   persists in localStorage so a mid-contest reload doesn't re-push or
 *   orphan anything.
 * - Polling: GET ?since=<seq> every POLL_MS while a session is active; the
 *   response contains only records stamped after the cursor (deletions as
 *   tombstones). The call param doubles as the presence heartbeat.
 */

import * as logbookStore from './logbookStore.js';
import { buildAdif } from '../utils/adif.js';

const LS_KEY = 'openhamclock_groupLog'; // { code, call, operatorName, name, contestId, joinedAt }
const LS_MIRRORED = 'openhamclock_groupLogMirrored'; // [localQsoId, ...]
const POLL_MS = 5000;
const MAX_MIRRORED_IDS = 12000;

const state = {
  session: null, // { code, call, operatorName, name, contestId, joinedAt }
  operators: [],
  qsos: new Map(), // id → server record (live only; tombstones remove)
  seq: 0,
  status: 'idle', // 'idle' | 'active' | 'error'
  error: null,
  lastSync: null,
  subscribers: new Set(),
};

let pollTimer = null;
let unsubscribeLogbook = null;
let prevLocalIds = null; // Set of local logbook ids at last diff
let mirrored = new Set(); // local ids we have pushed to the session
let pushQueue = Promise.resolve(); // serialize mirror pushes

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — session still works for this page load */
  }
};

const notify = () => {
  const snap = getSnapshot();
  state.subscribers.forEach((cb) => {
    try {
      cb(snap);
    } catch {
      /* subscriber errors must not break the loop */
    }
  });
};

export const getSnapshot = () => ({
  session: state.session,
  operators: state.operators,
  qsos: [...state.qsos.values()].sort((a, b) => (b.seq || 0) - (a.seq || 0)),
  status: state.status,
  error: state.error,
  lastSync: state.lastSync,
});

export const subscribe = (cb) => {
  state.subscribers.add(cb);
  cb(getSnapshot());
  return () => state.subscribers.delete(cb);
};

export const isActive = () => state.status === 'active' && !!state.session;

/** Merged-log dupe check: same worked call on the same band (+mode family). */
export const findGroupDupes = (call, band, mode) => {
  const c = String(call || '')
    .trim()
    .toUpperCase();
  const b = String(band || '')
    .trim()
    .toLowerCase();
  if (!c || !b) return [];
  const m = String(mode || '')
    .trim()
    .toUpperCase();
  return [...state.qsos.values()].filter(
    (q) =>
      String(q.call || '').toUpperCase() === c &&
      String(q.band || '').toLowerCase() === b &&
      (!m || !q.mode || String(q.mode).toUpperCase() === m),
  );
};

// ─── Server I/O ─────────────────────────────────────────────────────────────

const api = async (path, options = {}) => {
  const res = await fetch(`/api/group-log${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};

const applyServerRecords = (records) => {
  for (const q of records || []) {
    if (q.deleted) state.qsos.delete(q.id);
    else state.qsos.set(q.id, q);
  }
};

const applyMeta = (meta) => {
  state.operators = meta.operators || [];
  state.seq = meta.seq ?? state.seq;
  if (state.session) {
    state.session.name = meta.name ?? state.session.name;
    state.session.contestId = meta.contestId ?? state.session.contestId;
  }
};

const poll = async () => {
  if (!state.session) return;
  try {
    const data = await api(
      `/${encodeURIComponent(state.session.code)}?since=${state.seq}&call=${encodeURIComponent(state.session.call)}`,
    );
    applyMeta(data);
    applyServerRecords(data.qsos);
    state.status = 'active';
    state.error = null;
    state.lastSync = Date.now();
  } catch (err) {
    state.status = 'error';
    state.error = err.message;
  }
  notify();
};

// ─── Local-logbook mirroring ────────────────────────────────────────────────

const saveMirrored = () => writeJson(LS_MIRRORED, [...mirrored].slice(-MAX_MIRRORED_IDS));

const pushOwn = (qso) => {
  pushQueue = pushQueue
    .then(async () => {
      if (!state.session) return;
      await api(`/${encodeURIComponent(state.session.code)}/qsos`, {
        method: 'POST',
        body: JSON.stringify({ operator: state.session.call, qso: { ...qso, id: qso.id } }),
      });
      mirrored.add(qso.id);
      saveMirrored();
      poll(); // pick up our echo (and anything else) right away
    })
    .catch((err) => {
      state.status = 'error';
      state.error = err.message;
      notify();
    });
};

const pushEdit = (qso) => {
  pushQueue = pushQueue
    .then(async () => {
      if (!state.session) return;
      await api(`/${encodeURIComponent(state.session.code)}/qsos/${encodeURIComponent(qso.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ operator: state.session.call, qso }),
      });
      poll();
    })
    .catch(() => {}); // edit of a record another member deleted — poll reconciles
};

const pushDelete = (id) => {
  pushQueue = pushQueue
    .then(async () => {
      if (!state.session) return;
      await api(
        `/${encodeURIComponent(state.session.code)}/qsos/${encodeURIComponent(id)}?operator=${encodeURIComponent(state.session.call)}`,
        { method: 'DELETE' },
      );
      mirrored.delete(id);
      saveMirrored();
      poll();
    })
    .catch(() => {});
};

const onLogbookChange = (qsos) => {
  if (!state.session) return;
  const current = new Map(qsos.map((q) => [q.id, q]));
  if (prevLocalIds === null) {
    prevLocalIds = new Set(current.keys());
    return;
  }
  for (const [id, qso] of current) {
    if (!prevLocalIds.has(id))
      pushOwn(qso); // brand new QSO
    else if (mirrored.has(id)) {
      // Potential edit — cheap change probe on the fields the group log carries
      const remote = state.qsos.get(id);
      if (remote && (remote.call !== qso.call || remote.band !== qso.band || remote.mode !== qso.mode)) {
        pushEdit(qso);
      }
    }
  }
  for (const id of prevLocalIds) {
    if (!current.has(id) && mirrored.has(id)) pushDelete(id);
  }
  prevLocalIds = new Set(current.keys());
};

// ─── Lifecycle ──────────────────────────────────────────────────────────────

const start = () => {
  if (pollTimer) return;
  prevLocalIds = null;
  onLogbookChange(logbookStore.getAll()); // seed the snapshot before mirroring
  unsubscribeLogbook = logbookStore.subscribe(onLogbookChange);
  poll();
  pollTimer = setInterval(poll, POLL_MS);
};

const stop = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  unsubscribeLogbook?.();
  unsubscribeLogbook = null;
  prevLocalIds = null;
};

export const createSession = async ({ name, contestId, call, operatorName }) => {
  const data = await api('/sessions', {
    method: 'POST',
    body: JSON.stringify({ name, contestId, call, operatorName }),
  });
  adoptSession(data.session, call, operatorName);
  return data.session;
};

export const joinSession = async (code, call, operatorName) => {
  const data = await api(`/${encodeURIComponent(String(code).trim().toUpperCase())}/join`, {
    method: 'POST',
    body: JSON.stringify({ call, operatorName }),
  });
  adoptSession(data.session, call, operatorName);
  return data.session;
};

const adoptSession = (session, call, operatorName) => {
  stop();
  state.session = {
    code: session.code,
    call: String(call).trim().toUpperCase(),
    operatorName: operatorName || '',
    name: session.name,
    contestId: session.contestId,
    joinedAt: Date.now(),
  };
  state.qsos = new Map();
  state.seq = 0;
  state.status = 'active';
  state.error = null;
  mirrored = new Set();
  saveMirrored();
  writeJson(LS_KEY, state.session);
  applyMeta(session);
  start();
  notify();
};

export const leaveSession = async () => {
  const s = state.session;
  stop();
  state.session = null;
  state.operators = [];
  state.qsos = new Map();
  state.seq = 0;
  state.status = 'idle';
  state.error = null;
  mirrored = new Set();
  writeJson(LS_KEY, null);
  writeJson(LS_MIRRORED, null);
  notify();
  if (s) {
    try {
      await api(`/${encodeURIComponent(s.code)}/leave`, {
        method: 'POST',
        body: JSON.stringify({ call: s.call }),
      });
    } catch {
      /* roster entry expires with the session either way */
    }
  }
};

/** Merged group log as ADI text (each record carries OPERATOR). */
export const exportGroupAdif = () => {
  const records = [...state.qsos.values()].map((q) => ({
    ...q,
    extras: { ...(q.extras || {}), OPERATOR: q.operator || '' },
  }));
  return buildAdif(records, { myCall: state.session?.call });
};

/** Copy the merged log into the personal logbook (store dedups). */
export const importGroupToLogbook = async () => {
  const records = [...state.qsos.values()].map(({ seq, loggedAt, editedBy, operator, ...q }) => ({
    ...q,
    extras: { ...(q.extras || {}), OPERATOR: operator || '' },
  }));
  return logbookStore.addMany(records);
};

/** Resume a persisted session on app boot (called from module consumers). */
export const init = () => {
  if (state.session) return;
  const saved = readJson(LS_KEY, null);
  if (!saved?.code || !saved?.call) return;
  state.session = saved;
  state.status = 'active';
  mirrored = new Set(readJson(LS_MIRRORED, []));
  start();
};
