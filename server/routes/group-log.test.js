/**
 * Tests for server/routes/group-log.js — shared multi-operator log sessions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.GROUP_LOG_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-grouplog-')), 'group-logs.json');

const route = require('./group-log.js');

const makeApp = () => {
  const handlers = {}; // "METHOD path" → fn
  const record = (method) => (p, fn) => (handlers[`${method} ${p}`] = fn);
  return {
    handlers,
    app: { get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE') },
  };
};

const ctx = { ROOT_DIR: os.tmpdir(), logInfo: () => {}, logWarn: () => {} };

const run = async (fn, { params = {}, body = {}, query = {}, ip = '1.2.3.4' } = {}) => {
  let out;
  let code = 200;
  const res = {
    json: (b) => (out = b),
    status: (c) => {
      code = c;
      return res;
    },
  };
  await fn({ params, body, query, ip }, res);
  return { body: out, code };
};

describe('group-log routes', () => {
  let h;

  beforeEach(() => {
    const { app, handlers } = makeApp();
    route(app, ctx);
    h = handlers;
  });

  const createSession = async (call = 'K0CJH', extra = {}) =>
    run(h['POST /api/group-log/sessions'], { body: { call, name: 'Field Day', ...extra } });

  it('creates a session with an 8-char code and the creator on the roster', async () => {
    const { body, code } = await createSession();
    expect(code).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.session.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.session.operators).toHaveLength(1);
    expect(body.session.operators[0].call).toBe('K0CJH');
  });

  it('rejects creation without a valid callsign', async () => {
    expect((await createSession('GUEST')).code).toBe(400);
    expect((await createSession('')).code).toBe(400);
  });

  it('joins with the invite code, 404s on an unknown one', async () => {
    const { body: created } = await createSession();
    const codeStr = created.session.code;

    const joined = await run(h['POST /api/group-log/:code/join'], {
      params: { code: codeStr.toLowerCase() }, // case-insensitive entry
      body: { call: 'n2ehl', operatorName: 'Rich' },
    });
    expect(joined.code).toBe(200);
    expect(joined.body.session.operators.map((o) => o.call).sort()).toEqual(['K0CJH', 'N2EHL']);

    const missing = await run(h['POST /api/group-log/:code/join'], {
      params: { code: 'NOPENOPE' },
      body: { call: 'N2EHL' },
    });
    expect(missing.code).toBe(404);
  });

  it('members can log; non-members cannot', async () => {
    const { body: created } = await createSession();
    const codeStr = created.session.code;

    const ok = await run(h['POST /api/group-log/:code/qsos'], {
      params: { code: codeStr },
      body: { operator: 'K0CJH', qso: { call: 'W1AW', band: '20m', mode: 'SSB', freq: 14.285 } },
    });
    expect(ok.code).toBe(200);
    expect(ok.body.qso).toMatchObject({ call: 'W1AW', operator: 'K0CJH', seq: 1 });

    const stranger = await run(h['POST /api/group-log/:code/qsos'], {
      params: { code: codeStr },
      body: { operator: 'W9XYZ', qso: { call: 'W1AW' } },
    });
    expect(stranger.code).toBe(403);
  });

  it('idempotent append: same client id twice stores one QSO', async () => {
    const { body: created } = await createSession();
    const codeStr = created.session.code;
    const body = { operator: 'K0CJH', qso: { id: 'stable-1', call: 'W1AW', band: '40m' } };

    await run(h['POST /api/group-log/:code/qsos'], { params: { code: codeStr }, body });
    await run(h['POST /api/group-log/:code/qsos'], { params: { code: codeStr }, body });

    const sync = await run(h['GET /api/group-log/:code'], { params: { code: codeStr } });
    expect(sync.body.qsoCount).toBe(1);
    expect(sync.body.qsos).toHaveLength(1);
  });

  it('incremental sync via since cursor, edits re-stamp, deletes tombstone', async () => {
    const { body: created } = await createSession();
    const codeStr = created.session.code;
    const log = (qso) =>
      run(h['POST /api/group-log/:code/qsos'], { params: { code: codeStr }, body: { operator: 'K0CJH', qso } });

    const a = await log({ call: 'W1AW', band: '20m' });
    await log({ call: 'VE3XYZ', band: '40m' });

    const first = await run(h['GET /api/group-log/:code'], { params: { code: codeStr }, query: { since: '0' } });
    expect(first.body.qsos.map((q) => q.call)).toEqual(['W1AW', 'VE3XYZ']);
    const cursor = first.body.seq;

    // Nothing new past the cursor
    const idle = await run(h['GET /api/group-log/:code'], {
      params: { code: codeStr },
      query: { since: String(cursor) },
    });
    expect(idle.body.qsos).toHaveLength(0);

    // Edit re-stamps past the cursor and keeps original attribution
    const edited = await run(h['PUT /api/group-log/:code/qsos/:id'], {
      params: { code: codeStr, id: a.body.qso.id },
      body: { operator: 'K0CJH', qso: { call: 'W1AW', band: '15m' } },
    });
    expect(edited.body.qso.band).toBe('15m');

    const afterEdit = await run(h['GET /api/group-log/:code'], {
      params: { code: codeStr },
      query: { since: String(cursor) },
    });
    expect(afterEdit.body.qsos).toHaveLength(1);
    expect(afterEdit.body.qsos[0]).toMatchObject({ id: a.body.qso.id, band: '15m', operator: 'K0CJH' });

    // Delete arrives as a tombstone on the next incremental poll
    await run(h['DELETE /api/group-log/:code/qsos/:id'], {
      params: { code: codeStr, id: a.body.qso.id },
      query: { operator: 'K0CJH' },
    });
    const afterDelete = await run(h['GET /api/group-log/:code'], {
      params: { code: codeStr },
      query: { since: String(afterEdit.body.seq) },
    });
    expect(afterDelete.body.qsos).toEqual([expect.objectContaining({ id: a.body.qso.id, deleted: true })]);
    expect(afterDelete.body.qsoCount).toBe(1); // only VE3XYZ remains live
  });

  it('sanitizes QSO fields: whitelist, caps, freq bounds', async () => {
    const { body: created } = await createSession();
    const codeStr = created.session.code;

    const logged = await run(h['POST /api/group-log/:code/qsos'], {
      params: { code: codeStr },
      body: {
        operator: 'K0CJH',
        qso: {
          call: 'w1aw',
          band: '20m',
          comment: 'x'.repeat(2000),
          freq: 'not-a-number',
          evil: 'dropped',
          extras: { CONTEST_ID: 'ARRL-FD', ...Object.fromEntries([...Array(40)].map((_, i) => [`K${i}`, 'v'])) },
        },
      },
    });
    const q = logged.body.qso;
    expect(q.call).toBe('W1AW');
    expect(q.comment).toHaveLength(500);
    expect(q.freq).toBeUndefined();
    expect(q.evil).toBeUndefined();
    expect(Object.keys(q.extras).length).toBeLessThanOrEqual(20);
  });

  it('GET heartbeat updates operator lastSeen', async () => {
    const { body: created } = await createSession();
    const codeStr = created.session.code;
    const before = created.session.operators[0].lastSeen;

    await new Promise((r) => setTimeout(r, 5));
    const sync = await run(h['GET /api/group-log/:code'], {
      params: { code: codeStr },
      query: { call: 'K0CJH' },
    });
    expect(sync.body.operators[0].lastSeen).toBeGreaterThanOrEqual(before);
  });

  it('leave removes the operator but keeps their QSOs', async () => {
    const { body: created } = await createSession();
    const codeStr = created.session.code;
    await run(h['POST /api/group-log/:code/join'], { params: { code: codeStr }, body: { call: 'N2EHL' } });
    await run(h['POST /api/group-log/:code/qsos'], {
      params: { code: codeStr },
      body: { operator: 'N2EHL', qso: { call: 'W1AW' } },
    });

    await run(h['POST /api/group-log/:code/leave'], { params: { code: codeStr }, body: { call: 'N2EHL' } });
    const sync = await run(h['GET /api/group-log/:code'], { params: { code: codeStr } });
    expect(sync.body.operators.map((o) => o.call)).toEqual(['K0CJH']);
    expect(sync.body.qsoCount).toBe(1);
  });

  it('rate-limits session creation per IP', async () => {
    let last;
    for (let i = 0; i < 11; i++) last = await createSession('K0CJH');
    expect(last.code).toBe(429);
    // Different IP still fine
    const other = await run(h['POST /api/group-log/sessions'], {
      body: { call: 'K0CJH' },
      ip: '5.6.7.8',
    });
    expect(other.code).toBe(200);
  });
});
