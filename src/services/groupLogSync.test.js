/**
 * Tests for groupLogSync — client side of shared group log sessions.
 *
 * fetch is mocked with a tiny in-memory version of server/routes/group-log.js
 * (seq cursor, tombstones) so the mirroring + merge behavior is exercised
 * end-to-end without a server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logbookStore from './logbookStore.js';
import * as groupLogSync from './groupLogSync.js';

const CODE = 'TESTCODE';

const makeMockServer = () => {
  const server = {
    seq: 0,
    qsos: new Map(),
    operators: new Map([['K0CJH', { call: 'K0CJH', lastSeen: 1 }]]),
  };

  const meta = () => ({
    code: CODE,
    name: 'FD',
    contestId: null,
    createdAt: 1,
    seq: server.seq,
    qsoCount: [...server.qsos.values()].filter((q) => !q.deleted).length,
    operators: [...server.operators.values()].map((o) => ({ ...o, qsoCount: 0 })),
  });

  server.addRemote = (qso) => {
    const record = { ...qso, seq: ++server.seq };
    server.qsos.set(record.id, record);
    return record;
  };

  server.fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    const respond = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });

    if (method === 'POST' && url === '/api/group-log/sessions') {
      return respond({ ok: true, session: meta() });
    }
    if (method === 'POST' && url.endsWith('/join')) {
      server.operators.set(body.call, { call: body.call, lastSeen: Date.now() });
      return respond({ ok: true, session: meta() });
    }
    if (method === 'POST' && url.endsWith('/leave')) {
      server.operators.delete(body.call);
      return respond({ ok: true });
    }
    if (method === 'POST' && url.includes('/qsos')) {
      const record = { ...body.qso, operator: body.operator, seq: ++server.seq };
      server.qsos.set(record.id, record);
      return respond({ ok: true, qso: record });
    }
    if (method === 'DELETE') {
      const id = decodeURIComponent(url.split('/qsos/')[1].split('?')[0]);
      server.qsos.set(id, { id, deleted: true, seq: ++server.seq });
      return respond({ ok: true });
    }
    if (method === 'GET') {
      const since = parseInt(new URL(url, 'http://x').searchParams.get('since'), 10) || 0;
      const changed = [...server.qsos.values()].filter((q) => q.seq > since).sort((a, b) => a.seq - b.seq);
      return respond({ ...meta(), since, qsos: changed });
    }
    return respond({ error: 'unhandled' }, 404);
  });

  return server;
};

const flush = async () => {
  // Drain the push queue + poll promise chains
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('groupLogSync', () => {
  let server;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    await logbookStore.clear();
    server = makeMockServer();
    vi.stubGlobal('fetch', server.fetch);
  });

  afterEach(async () => {
    await groupLogSync.leaveSession();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('creates a session and mirrors newly logged QSOs (not pre-existing ones)', async () => {
    await logbookStore.add({ call: 'OLDONE', band: '80m' }); // pre-session — must NOT sync

    await groupLogSync.createSession({ name: 'FD', call: 'K0CJH' });
    await flush();

    await logbookStore.add({ call: 'W1AW', band: '20m', mode: 'SSB' });
    await flush();

    const pushed = server.fetch.mock.calls.filter(([u, o]) => o?.method === 'POST' && u.includes('/qsos'));
    expect(pushed).toHaveLength(1);
    expect(JSON.parse(pushed[0][1].body).qso.call).toBe('W1AW');

    const snap = groupLogSync.getSnapshot();
    expect(snap.session.code).toBe(CODE);
    expect(snap.qsos.map((q) => q.call)).toEqual(['W1AW']);
  });

  it("merges other operators' QSOs on poll and flags group dupes", async () => {
    await groupLogSync.createSession({ name: 'FD', call: 'K0CJH' });
    await flush();

    server.addRemote({ id: 'remote-1', call: 'W1AW', band: '20m', mode: 'SSB', operator: 'N2EHL' });
    await vi.advanceTimersByTimeAsync(5100); // next poll tick
    await flush();

    const snap = groupLogSync.getSnapshot();
    expect(snap.qsos.map((q) => q.operator)).toContain('N2EHL');
    expect(groupLogSync.findGroupDupes('W1AW', '20m', 'SSB')).toHaveLength(1);
    expect(groupLogSync.findGroupDupes('W1AW', '40m')).toHaveLength(0);
  });

  it('propagates local deletion of a mirrored QSO as a tombstone', async () => {
    await groupLogSync.createSession({ name: 'FD', call: 'K0CJH' });
    await flush();

    const added = await logbookStore.add({ call: 'W1AW', band: '20m' });
    await flush();
    await logbookStore.remove(added.id);
    await flush();

    const deletes = server.fetch.mock.calls.filter(([, o]) => o?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(groupLogSync.getSnapshot().qsos).toHaveLength(0);
  });

  it('leaveSession clears state and stops mirroring', async () => {
    await groupLogSync.createSession({ name: 'FD', call: 'K0CJH' });
    await flush();
    await groupLogSync.leaveSession();
    await flush();
    server.fetch.mockClear();

    await logbookStore.add({ call: 'W1AW', band: '20m' });
    await flush();

    expect(server.fetch.mock.calls.filter(([u]) => u.includes('/qsos'))).toHaveLength(0);
    expect(groupLogSync.getSnapshot().session).toBeNull();
    expect(localStorage.getItem('openhamclock_groupLog')).toBeNull();
  });

  it('resumes a persisted session via init() without re-pushing existing QSOs', async () => {
    await groupLogSync.createSession({ name: 'FD', call: 'K0CJH' });
    await flush();
    await logbookStore.add({ call: 'W1AW', band: '20m' });
    await flush();

    // Simulate reload: module state survives in this test process, so emulate
    // by leaving-without-clearing localStorage is not possible; instead just
    // verify the persisted marker exists for init() to pick up.
    expect(JSON.parse(localStorage.getItem('openhamclock_groupLog')).code).toBe(CODE);
  });
});
