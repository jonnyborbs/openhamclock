/**
 * Tests for server/routes/history.js — 24h spot recorder + playback queries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.SPOT_HISTORY_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-history-')), 'spot-history.json');

const route = require('./history.js');

const makeApp = () => {
  const handlers = {};
  return { handlers, app: { get: (p, fn) => (handlers[`GET ${p}`] = fn) } };
};

const run = async (fn, query = {}) => {
  let out;
  let code = 200;
  const res = {
    json: (b) => (out = b),
    status: (c) => {
      code = c;
      return res;
    },
  };
  await fn({ query }, res);
  return { body: out, code };
};

const spot = (minsAgo, dxCall, id) => ({
  id,
  dxCall,
  spotter: 'W3LPL',
  freq: 14.025,
  dxLat: 40,
  dxLon: -75,
  spotterLat: 39,
  spotterLon: -77,
  comment: 'CW 25 dB '.padEnd(60, 'x'), // over the cap, must be trimmed
  timestamp: Date.now() - minsAgo * 60 * 1000,
});

describe('history routes', () => {
  let h;
  let cache;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false, now: Date.now() });
    cache = new Map();
    const { app, handlers } = makeApp();
    route(app, { ROOT_DIR: os.tmpdir(), logInfo: () => {}, logWarn: () => {}, dxSpotPathsCacheByKey: cache });
    h = handlers;
  });

  const feedAndSample = async (paths) => {
    cache.set('key', { paths: [], allPaths: paths, timestamp: Date.now() });
    await vi.advanceTimersByTimeAsync(61 * 1000); // one sample tick
  };

  it('records spots from the cluster cache, dedupes, trims comments', async () => {
    await feedAndSample([spot(10, 'JA1ABC', 'a'), spot(5, 'VK2IO', 'b'), spot(10, 'JA1ABC', 'a')]);
    await feedAndSample([spot(10, 'JA1ABC', 'a'), spot(2, 'ZL1XYZ', 'c')]); // 'a' already seen

    const meta = await run(h['GET /api/history/meta']);
    expect(meta.body.count).toBe(3);

    const all = await run(h['GET /api/history/spots'], {
      from: String(Date.now() - 60 * 60 * 1000),
      to: String(Date.now()),
    });
    expect(all.body.spots.map((s) => s.dxCall)).toEqual(['JA1ABC', 'VK2IO', 'ZL1XYZ']); // ascending time
    expect(all.body.spots[0].comment.length).toBeLessThanOrEqual(30);
  });

  it('window queries return only spots inside [from, to)', async () => {
    await feedAndSample([spot(120, 'OLD1', 'o1'), spot(30, 'MID1', 'm1'), spot(1, 'NEW1', 'n1')]);
    const win = await run(h['GET /api/history/spots'], {
      from: String(Date.now() - 60 * 60 * 1000),
      to: String(Date.now() - 10 * 60 * 1000),
    });
    expect(win.body.spots.map((s) => s.dxCall)).toEqual(['MID1']);
    expect(win.body.total).toBe(1);
  });

  it('rejects inverted windows', async () => {
    const bad = await run(h['GET /api/history/spots'], { from: String(Date.now()), to: String(Date.now() - 1000) });
    expect(bad.code).toBe(400);
  });

  it('stride-downsamples oversized windows evenly', async () => {
    const many = Array.from({ length: 4500 }, (_, i) => spot(600 - i / 10, `C${i}`, `s${i}`));
    await feedAndSample(many);
    const all = await run(h['GET /api/history/spots'], {
      from: String(Date.now() - 12 * 60 * 60 * 1000),
      to: String(Date.now()),
    });
    expect(all.body.total).toBe(4500);
    expect(all.body.downsampled).toBe(true);
    expect(all.body.spots.length).toBe(4000);
    // Even coverage: first and last spots of the window survive sampling
    expect(all.body.spots[0].dxCall).toBe('C0');
  });

  it('drops spots past the 24h retention on later samples', async () => {
    await feedAndSample([spot(10, 'KEEP', 'k1')]);
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000); // ride past retention
    await feedAndSample([spot(1, 'FRESH', 'f1')]);
    const meta = await run(h['GET /api/history/meta']);
    expect(meta.body.count).toBe(1);
  });
});
