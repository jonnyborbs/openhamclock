import { describe, expect, it } from 'vitest';
import relayHealth from './fletcherRelayHealth.js';

const { classifyFletcherRelays, RELAY_ERROR_WINDOW_MS, CONSECUTIVE_FAILS_THRESHOLD } = relayHealth;

const NOW = 1_800_000_000_000;

describe('classifyFletcherRelays (#1165 follow-up — no paging on single blips)', () => {
  it('ok when there are no outcomes at all (fresh boot)', () => {
    expect(classifyFletcherRelays({}, NOW).status).toBe('ok');
  });

  it('ok when the last outcome was a success', () => {
    const s = { lastUpstreamOkAt: NOW - 1000, lastUpstreamErrorAt: NOW - 5000, consecutiveUpstreamFails: 0 };
    expect(classifyFletcherRelays(s, NOW).status).toBe('ok');
  });

  it('a single recent failure reports ok, with the blip noted in the detail', () => {
    const s = {
      lastUpstreamOkAt: NOW - 60_000,
      lastUpstreamErrorAt: NOW - 30_000,
      lastUpstreamStatus: 0,
      consecutiveUpstreamFails: 1,
    };
    const v = classifyFletcherRelays(s, NOW);
    expect(v.status).toBe('ok');
    expect(v.detail).toContain('1 transient relay error');
    expect(v.detail).toContain('no response');
  });

  it(`degraded at ${CONSECUTIVE_FAILS_THRESHOLD} consecutive failures`, () => {
    const s = {
      lastUpstreamOkAt: NOW - 60_000,
      lastUpstreamErrorAt: NOW - 30_000,
      lastUpstreamStatus: 403,
      consecutiveUpstreamFails: 2,
    };
    const v = classifyFletcherRelays(s, NOW);
    expect(v.status).toBe('degraded');
    expect(v.detail).toContain('2 consecutive');
    expect(v.detail).toContain('HTTP 403');
  });

  it('the v26.6.0 release-day shape (serial 403s) still trips immediately', () => {
    const s = {
      lastUpstreamOkAt: null,
      lastUpstreamErrorAt: NOW - 10_000,
      lastUpstreamStatus: 403,
      consecutiveUpstreamFails: 7,
    };
    expect(classifyFletcherRelays(s, NOW).status).toBe('degraded');
  });

  it('recovers when the error ages out of the window even with a high count', () => {
    const s = {
      lastUpstreamOkAt: null,
      lastUpstreamErrorAt: NOW - RELAY_ERROR_WINDOW_MS - 1000,
      lastUpstreamStatus: 0,
      consecutiveUpstreamFails: 9,
    };
    expect(classifyFletcherRelays(s, NOW).status).toBe('ok');
  });

  it('missing counter (older fletcher build) is treated as a single blip — no paging in a mixed-version deploy window', () => {
    const s = { lastUpstreamOkAt: NOW - 60_000, lastUpstreamErrorAt: NOW - 30_000, lastUpstreamStatus: 0 };
    const v = classifyFletcherRelays(s, NOW);
    expect(v.status).toBe('ok');
    expect(v.detail).toContain('transient');
  });

  it('distinguishes no-response (status 0) from HTTP status in the degraded detail', () => {
    const s = {
      lastUpstreamOkAt: 0,
      lastUpstreamErrorAt: NOW - 5000,
      lastUpstreamStatus: 0,
      consecutiveUpstreamFails: 3,
    };
    expect(classifyFletcherRelays(s, NOW).detail).toContain('no response');
  });
});
