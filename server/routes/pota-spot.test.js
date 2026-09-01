/**
 * Tests for server/routes/pota-spot.js — POTA activator self-spotting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = require('./pota-spot.js');
const { validateSpot } = route;

describe('validateSpot', () => {
  const good = { activator: 'k0cjh', reference: 'us-1211', frequency: 14285, mode: 'ssb', comments: 'QRV' };

  it('normalizes and accepts a valid spot (spotter defaults to activator)', () => {
    const { spot, error } = validateSpot(good);
    expect(error).toBeUndefined();
    expect(spot).toMatchObject({
      activator: 'K0CJH',
      spotter: 'K0CJH',
      reference: 'US-1211',
      frequency: '14285',
      mode: 'SSB',
      source: 'OpenHamClock',
    });
  });

  it('rejects bad callsigns, references, and frequencies', () => {
    expect(validateSpot({ ...good, activator: 'NOTACALL!' }).error).toMatch(/activator/i);
    expect(validateSpot({ ...good, reference: 'USA1211' }).error).toMatch(/reference/i);
    expect(validateSpot({ ...good, frequency: 14.285 }).error).toMatch(/kHz/);
    expect(validateSpot({ ...good, frequency: 'QRG' }).error).toMatch(/kHz/);
    expect(validateSpot({}).error).toBeTruthy();
  });

  it('truncates long comments', () => {
    const { spot } = validateSpot({ ...good, comments: 'x'.repeat(500) });
    expect(spot.comments).toHaveLength(120);
  });
});

describe('POST /api/pota/spot (route)', () => {
  let postHandler;
  let getHandler;
  let ctx;
  const stubApp = {
    post: (path, fn) => (postHandler = fn),
    get: (path, fn) => (getHandler = fn),
  };
  const runPost = async (body, ip = '1.2.3.4') => {
    let out;
    let code = 200;
    const res = {
      json: (b) => (out = b),
      status: (c) => {
        code = c;
        return res;
      },
    };
    await postHandler({ body, ip }, res);
    return { body: out, code };
  };
  const good = { activator: 'K0CJH', reference: 'US-1211', frequency: 14285, mode: 'SSB' };

  beforeEach(() => {
    ctx = {
      fetch: vi.fn(),
      APP_VERSION: 'test',
      logDebug: () => {},
      logErrorOnce: () => {},
    };
  });

  it('forwards a valid spot and passes POTA verdict through', async () => {
    ctx.fetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('"Spot posted"') });
    route(stubApp, ctx);
    const { body, code } = await runPost(good);
    expect(code).toBe(200);
    expect(body.ok).toBe(true);
    const sent = JSON.parse(ctx.fetch.mock.calls[0][1].body);
    expect(sent.source).toBe('OpenHamClock');
  });

  it('enforces the per-IP cooldown', async () => {
    ctx.fetch.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });
    route(stubApp, ctx);
    await runPost(good);
    const { code, body } = await runPost(good);
    expect(code).toBe(429);
    expect(body.error).toMatch(/wait/i);
    // Different IP is unaffected
    expect((await runPost(good, '5.6.7.8')).code).toBe(200);
  });

  it('400s invalid bodies without contacting POTA', async () => {
    route(stubApp, ctx);
    const { code } = await runPost({ activator: 'bad!' });
    expect(code).toBe(400);
    expect(ctx.fetch).not.toHaveBeenCalled();
  });

  it('park lookup validates the reference and caches', async () => {
    ctx.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ reference: 'US-1211', name: 'Some Park', locationName: 'Colorado', grid6: 'DN70' }),
    });
    route(stubApp, ctx);
    let out;
    let code = 200;
    const res = {
      json: (b) => (out = b),
      status: (c) => {
        code = c;
        return res;
      },
    };
    await getHandler({ params: { reference: 'us-1211' } }, res);
    expect(code).toBe(200);
    expect(out.name).toBe('Some Park');
    await getHandler({ params: { reference: 'US-1211' } }, res);
    expect(ctx.fetch).toHaveBeenCalledTimes(1); // cached

    await getHandler({ params: { reference: 'nope' } }, res);
    expect(code).toBe(400);
  });
});
