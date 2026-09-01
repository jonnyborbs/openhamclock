/**
 * Group Logging routes — shared multi-operator log sessions (Field Day et al).
 *
 * One operator creates a session and gets a short invite code; others join
 * with the code and their callsign. Every member's QSOs sync into one merged
 * log so a club running several stations sees (and dupe-checks against) the
 * combined contacts in near-real-time. Clients poll incrementally with a
 * monotonic per-session `seq` cursor: every QSO mutation (add / edit /
 * delete-tombstone) bumps the session seq and stamps the record, so
 * `GET ?since=N` returns exactly the records that changed.
 *
 * Auth model: possession of the invite code is membership (same trust shape
 * as a Field Day tent). Codes are 8 chars from a 31-symbol alphabet
 * (~8.5e11 combinations) behind the global API rate limiter, and mutation
 * endpoints additionally require the operator to have joined the roster.
 *
 * Storage: in-memory, with debounced file persistence using the same
 * writable-path waterfall as field-reports.json so sessions survive a server
 * restart mid-contest. Sessions idle for SESSION_TTL are dropped.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn } = ctx;

  const MAX_SESSIONS = 200;
  const MAX_OPERATORS = 25;
  const MAX_QSOS = 10000;
  const MAX_CREATES_PER_IP_HOUR = 10;
  const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // idle sessions dropped after a week
  const STR_MAX = 40;
  const COMMENT_MAX = 500;
  const MAX_EXTRA_KEYS = 20;

  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 lookalikes
  const CODE_LENGTH = 8;

  // Same base shape as the dxcluster validator, plus portable suffixes
  // (W1AW/P, K0CJH/0) since Field Day ops are frequently portable.
  const isValidCallsign = (call) =>
    typeof call === 'string' && /^[A-Z0-9]{1,3}\d[A-Z]{1,4}(\/[A-Z0-9]{1,4})?$/i.test(call.trim());

  const normCall = (call) =>
    String(call || '')
      .trim()
      .toUpperCase();

  // ─── Persistence (field-reports.json waterfall pattern) ──────────────────
  const GROUP_LOG_FILE = (() => {
    const candidates = [
      process.env.GROUP_LOG_FILE,
      '/data/group-logs.json',
      path.join(ROOT_DIR, 'data', 'group-logs.json'),
      '/tmp/openhamclock-group-logs.json',
    ];
    for (const p of candidates) {
      if (!p) continue;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        return p;
      } catch {
        continue;
      }
    }
    return '/tmp/openhamclock-group-logs.json';
  })();

  // code → { code, name, contestId, createdAt, lastActivity, seq,
  //          operators: Map(call → {call, name, joinedAt, lastSeen}),
  //          qsos: Map(id → {id, seq, operator, deleted?, ...fields}) }
  const sessions = new Map();

  try {
    const parsed = JSON.parse(fs.readFileSync(GROUP_LOG_FILE, 'utf8'));
    if (Array.isArray(parsed)) {
      for (const s of parsed.slice(0, MAX_SESSIONS)) {
        if (!s || typeof s.code !== 'string') continue;
        sessions.set(s.code, {
          ...s,
          operators: new Map((s.operators || []).map((o) => [o.call, o])),
          qsos: new Map((s.qsos || []).map((q) => [q.id, q])),
        });
      }
      if (sessions.size) logInfo(`[GroupLog] Loaded ${sessions.size} session(s) from ${GROUP_LOG_FILE}`);
    }
  } catch {
    /* file absent on first run — normal */
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const flat = [...sessions.values()].map((s) => ({
          ...s,
          operators: [...s.operators.values()],
          qsos: [...s.qsos.values()],
        }));
        fs.writeFileSync(GROUP_LOG_FILE, JSON.stringify(flat), 'utf8');
      } catch (err) {
        logWarn(`[GroupLog] Could not persist sessions: ${err.message}`);
      }
    }, 2000);
    saveTimer.unref?.();
  }

  const cleanupTimer = setInterval(
    () => {
      const cutoff = Date.now() - SESSION_TTL;
      let dropped = 0;
      for (const [code, s] of sessions) {
        if (s.lastActivity < cutoff) {
          sessions.delete(code);
          dropped++;
        }
      }
      if (dropped) {
        logInfo(`[GroupLog] Expired ${dropped} idle session(s)`);
        scheduleSave();
      }
    },
    60 * 60 * 1000,
  );
  cleanupTimer.unref?.();

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function makeCode() {
    // Rejection-sample so each byte maps uniformly onto the 31-char alphabet —
    // plain modulo would bias codes toward the first 256 % 31 characters.
    const limit = 256 - (256 % CODE_ALPHABET.length);
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      while (code.length < CODE_LENGTH) {
        for (const byte of crypto.randomBytes(CODE_LENGTH)) {
          if (byte < limit && code.length < CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
        }
      }
      if (!sessions.has(code)) return code;
    }
    return null; // 20 collisions in a 31^8 space means something is very wrong
  }

  const cleanStr = (v, max) => (v == null ? '' : String(v).substring(0, max));

  /** Whitelist + cap the ADIF-aligned QSO fields the logbookStore uses. */
  function sanitizeQso(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const call = normCall(raw.call).substring(0, 20);
    if (!call) return null;
    const q = { call };
    for (const k of [
      'qso_date',
      'time_on',
      'band',
      'mode',
      'submode',
      'rst_sent',
      'rst_rcvd',
      'gridsquare',
      'name',
      'my_gridsquare',
      'tx_pwr',
    ]) {
      if (raw[k] != null && raw[k] !== '') q[k] = cleanStr(raw[k], STR_MAX);
    }
    if (raw.comment != null && raw.comment !== '') q.comment = cleanStr(raw.comment, COMMENT_MAX);
    const freq = typeof raw.freq === 'number' ? raw.freq : parseFloat(raw.freq);
    if (Number.isFinite(freq) && freq > 0 && freq < 300000) q.freq = freq;
    if (raw.extras && typeof raw.extras === 'object' && !Array.isArray(raw.extras)) {
      const extras = {};
      let count = 0;
      for (const [k, v] of Object.entries(raw.extras)) {
        if (count >= MAX_EXTRA_KEYS) break;
        const key = cleanStr(k, 40);
        if (!key) continue;
        extras[key] = cleanStr(v, STR_MAX * 2);
        count++;
      }
      if (Object.keys(extras).length) q.extras = extras;
    }
    return q;
  }

  const touch = (s) => {
    s.lastActivity = Date.now();
  };

  const operatorsSnapshot = (s) =>
    [...s.operators.values()].map((o) => ({
      call: o.call,
      name: o.name,
      lastSeen: o.lastSeen,
      qsoCount: [...s.qsos.values()].filter((q) => !q.deleted && q.operator === o.call).length,
    }));

  const sessionMeta = (s) => ({
    code: s.code,
    name: s.name,
    contestId: s.contestId,
    createdAt: s.createdAt,
    seq: s.seq,
    qsoCount: [...s.qsos.values()].filter((q) => !q.deleted).length,
    operators: operatorsSnapshot(s),
  });

  function getSession(req, res) {
    const code = String(req.params.code || '')
      .trim()
      .toUpperCase();
    const s = sessions.get(code);
    if (!s) {
      res.status(404).json({ error: 'Unknown or expired invite code' });
      return null;
    }
    return s;
  }

  /** Mutations require a joined operator; heartbeats their lastSeen. */
  function requireMember(s, call, res) {
    const c = normCall(call);
    const member = s.operators.get(c);
    if (!member) {
      res.status(403).json({ error: 'Join the session before logging (invite code + your callsign)' });
      return null;
    }
    member.lastSeen = Date.now();
    return member;
  }

  // Session-creation abuse guard: per-IP counter, pruned hourly.
  const createsByIp = new Map(); // ip → { count, windowStart }
  function allowCreate(ip) {
    const now = Date.now();
    const entry = createsByIp.get(ip);
    if (!entry || now - entry.windowStart > 60 * 60 * 1000) {
      createsByIp.set(ip, { count: 1, windowStart: now });
      return true;
    }
    entry.count++;
    return entry.count <= MAX_CREATES_PER_IP_HOUR;
  }

  // ─── Routes ──────────────────────────────────────────────────────────────

  // Create a session; the creator joins in the same call.
  app.post('/api/group-log/sessions', (req, res) => {
    const { name, contestId, call, operatorName } = req.body || {};
    const c = normCall(call);
    if (!isValidCallsign(c)) return res.status(400).json({ error: 'A valid callsign is required' });
    if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: 'Session limit reached, try again later' });
    if (!allowCreate(req.ip || req.socket?.remoteAddress || '?')) {
      return res.status(429).json({ error: 'Too many sessions created from this address' });
    }
    const code = makeCode();
    if (!code) return res.status(500).json({ error: 'Could not allocate an invite code' });

    const now = Date.now();
    const s = {
      code,
      name: cleanStr(name, 60) || 'Group log',
      contestId: cleanStr(contestId, 40) || null,
      createdAt: now,
      lastActivity: now,
      seq: 0,
      operators: new Map([[c, { call: c, name: cleanStr(operatorName, STR_MAX), joinedAt: now, lastSeen: now }]]),
      qsos: new Map(),
    };
    sessions.set(code, s);
    scheduleSave();
    logInfo(`[GroupLog] Session ${code} ("${s.name}") created by ${c}`);
    res.json({ ok: true, session: sessionMeta(s) });
  });

  // Join with an invite code.
  app.post('/api/group-log/:code/join', (req, res) => {
    const s = getSession(req, res);
    if (!s) return;
    const c = normCall(req.body?.call);
    if (!isValidCallsign(c)) return res.status(400).json({ error: 'A valid callsign is required' });
    if (!s.operators.has(c) && s.operators.size >= MAX_OPERATORS) {
      return res.status(503).json({ error: 'Session operator limit reached' });
    }
    const now = Date.now();
    const existing = s.operators.get(c);
    s.operators.set(c, {
      call: c,
      name: cleanStr(req.body?.operatorName, STR_MAX) || existing?.name || '',
      joinedAt: existing?.joinedAt || now,
      lastSeen: now,
    });
    touch(s);
    scheduleSave();
    res.json({ ok: true, session: sessionMeta(s) });
  });

  // Leave the roster (QSOs stay in the merged log).
  app.post('/api/group-log/:code/leave', (req, res) => {
    const s = getSession(req, res);
    if (!s) return;
    s.operators.delete(normCall(req.body?.call));
    touch(s);
    scheduleSave();
    res.json({ ok: true });
  });

  // Incremental sync. ?since=<seq> returns only records that changed after
  // that cursor (edits re-stamp, deletions arrive as {id, seq, deleted}).
  // ?call=<member> doubles as the presence heartbeat.
  app.get('/api/group-log/:code', (req, res) => {
    const s = getSession(req, res);
    if (!s) return;
    const since = Math.max(0, parseInt(req.query.since, 10) || 0);
    const c = normCall(req.query.call);
    const member = c ? s.operators.get(c) : null;
    if (member) member.lastSeen = Date.now();

    const changed = [...s.qsos.values()].filter((q) => q.seq > since).sort((a, b) => a.seq - b.seq);
    res.json({ ...sessionMeta(s), since, qsos: changed });
  });

  // Append a QSO. Client supplies a stable id so retries are idempotent.
  app.post('/api/group-log/:code/qsos', (req, res) => {
    const s = getSession(req, res);
    if (!s) return;
    const member = requireMember(s, req.body?.operator, res);
    if (!member) return;

    const qso = sanitizeQso(req.body?.qso);
    if (!qso) return res.status(400).json({ error: 'A QSO with at least a callsign is required' });

    const id = cleanStr(req.body?.qso?.id, 64) || crypto.randomUUID();
    const existing = s.qsos.get(id);
    if (existing && !existing.deleted) return res.json({ ok: true, qso: existing }); // idempotent retry

    const live = [...s.qsos.values()].filter((q) => !q.deleted).length;
    if (live >= MAX_QSOS) return res.status(503).json({ error: 'Session QSO limit reached' });

    const record = { ...qso, id, operator: member.call, seq: ++s.seq, loggedAt: Date.now() };
    s.qsos.set(id, record);
    touch(s);
    scheduleSave();
    res.json({ ok: true, qso: record });
  });

  // Edit any member's QSO (Field Day log corrections are a group activity).
  app.put('/api/group-log/:code/qsos/:id', (req, res) => {
    const s = getSession(req, res);
    if (!s) return;
    const member = requireMember(s, req.body?.operator, res);
    if (!member) return;

    const existing = s.qsos.get(String(req.params.id || ''));
    if (!existing || existing.deleted) return res.status(404).json({ error: 'QSO not found' });
    const qso = sanitizeQso(req.body?.qso);
    if (!qso) return res.status(400).json({ error: 'A QSO with at least a callsign is required' });

    const record = {
      ...qso,
      id: existing.id,
      operator: existing.operator, // original logger keeps attribution
      editedBy: member.call,
      seq: ++s.seq,
      loggedAt: existing.loggedAt,
    };
    s.qsos.set(existing.id, record);
    touch(s);
    scheduleSave();
    res.json({ ok: true, qso: record });
  });

  // Delete (tombstone) a QSO so other clients drop it on their next poll.
  app.delete('/api/group-log/:code/qsos/:id', (req, res) => {
    const s = getSession(req, res);
    if (!s) return;
    const member = requireMember(s, req.query.operator, res);
    if (!member) return;

    const existing = s.qsos.get(String(req.params.id || ''));
    if (!existing || existing.deleted) return res.status(404).json({ error: 'QSO not found' });
    s.qsos.set(existing.id, { id: existing.id, deleted: true, seq: ++s.seq });
    touch(s);
    scheduleSave();
    res.json({ ok: true });
  });

  return {};
};
