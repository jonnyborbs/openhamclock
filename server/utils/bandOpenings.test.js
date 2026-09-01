import { describe, expect, it } from 'vitest';
import { createBandOpeningTracker, DEFAULTS } from './bandOpenings.js';

const MIN = 60 * 1000;
const NOW = 10 * 60 * 60 * 1000; // deterministic "now" (10h epoch offset)

// Build a spot in the tracker's ingest shape.
function spot(call, tsOffsetMin, overrides = {}) {
  const ts = NOW + tsOffsetMin * MIN;
  return {
    id: `${call}|${ts}|${overrides.band || '20m'}|${overrides.from || 'EU'}|${overrides.to || 'NA'}|${overrides.n || 0}`,
    call,
    band: overrides.band || '20m',
    fromContinent: overrides.from || 'EU',
    toContinent: overrides.to || 'NA',
    timestamp: ts,
  };
}

// Steady baseline: one spot every `everyMin` minutes across the 3h window,
// rotating through a pool of callsigns.
function baselineSpots(everyMin = 10, opts = {}) {
  const spots = [];
  const calls = opts.calls || ['G0AAA', 'G0BBB', 'G0CCC'];
  let n = 0;
  for (let m = -175; m <= -20; m += everyMin) {
    spots.push(spot(calls[n % calls.length], m, { ...opts, n: n++ }));
  }
  return spots;
}

// A burst of distinct calls inside the short window.
function burstSpots(count, opts = {}) {
  const spots = [];
  for (let i = 0; i < count; i++) {
    spots.push(spot(`DX${i}AA`, -1 - (i % 10), { ...opts, n: i }));
  }
  return spots;
}

describe('createBandOpeningTracker — ingest', () => {
  it('accepts valid spots and reports counts', () => {
    const t = createBandOpeningTracker();
    expect(t.ingest([spot('G0AAA', -5)], NOW)).toBe(1);
    expect(t.stats().spots).toBe(1);
  });

  it('dedupes repeated ingests of the same spots by id', () => {
    const t = createBandOpeningTracker();
    const spots = [spot('G0AAA', -5), spot('G0BBB', -6)];
    expect(t.ingest(spots, NOW)).toBe(2);
    expect(t.ingest(spots, NOW)).toBe(0); // same cache snapshot re-sampled
    expect(t.stats().spots).toBe(2);
  });

  it('rejects spots missing band/continent/timestamp and spots outside the baseline window', () => {
    const t = createBandOpeningTracker();
    const accepted = t.ingest(
      [
        { call: 'G0AAA', band: '20m', fromContinent: 'EU', toContinent: null, timestamp: NOW }, // no continent
        { call: 'G0AAA', band: 'Other', fromContinent: 'EU', toContinent: 'NA', timestamp: NOW }, // junk band
        { call: 'G0AAA', band: '20m', fromContinent: 'EU', toContinent: 'NA', timestamp: NaN }, // bad ts
        spot('G0BBB', -200), // older than 3h baseline
        spot('G0CCC', +10), // future beyond tolerance
      ],
      NOW,
    );
    expect(accepted).toBe(0);
    expect(t.stats().spots).toBe(0);
  });

  it('prunes spots that age out of the baseline window', () => {
    const t = createBandOpeningTracker();
    t.ingest([spot('G0AAA', -170)], NOW);
    expect(t.stats().spots).toBe(1);
    t.ingest([], NOW + 60 * MIN); // 1h later — the -170min spot is now stale
    expect(t.stats().spots).toBe(0);
  });
});

describe('createBandOpeningTracker — opening detection', () => {
  it('stays quiet on steady baseline activity', () => {
    const t = createBandOpeningTracker();
    t.ingest(baselineSpots(10), NOW);
    expect(t.analyze(NOW)).toEqual([]);
  });

  it('flags an opening when the short-window rate exceeds baseline by the factor with enough distinct calls', () => {
    const t = createBandOpeningTracker();
    // Baseline: 1 spot / 10 min ≈ 0.1/min. Burst: 8 distinct calls in 15 min ≈ 0.53/min → >3×.
    t.ingest([...baselineSpots(10), ...burstSpots(8)], NOW);
    const openings = t.analyze(NOW);
    expect(openings).toHaveLength(1);
    const o = openings[0];
    expect(o).toMatchObject({ band: '20m', from_continent: 'EU', to_continent: 'NA', state: 'opening' });
    expect(o.shortCount).toBe(8);
    expect(o.factor).toBeGreaterThanOrEqual(DEFAULTS.openFactor);
    expect(o.baselineRate).toBeCloseTo(16 / 165, 2);
    expect(o.sampleCalls.length).toBeLessThanOrEqual(3);
    expect(o.sampleCalls.every((c) => c.startsWith('DX'))).toBe(true);
  });

  it('does not flag a quiet band on a tiny burst below the distinct-call floor', () => {
    const t = createBandOpeningTracker();
    // Zero baseline (factor = Infinity) but only 3 distinct calls (< 5 default).
    t.ingest(burstSpots(3), NOW);
    expect(t.analyze(NOW)).toEqual([]);
  });

  it('flags a previously silent path once the distinct-call floor is met', () => {
    const t = createBandOpeningTracker();
    t.ingest(burstSpots(5), NOW);
    const openings = t.analyze(NOW);
    expect(openings).toHaveLength(1);
    expect(openings[0].state).toBe('opening');
    expect(openings[0].factor).toBeNull(); // Infinity (no baseline) serialized as null
    expect(openings[0].baselineRate).toBe(0);
  });

  it('does not flag heavy but unremarkable traffic (factor below threshold)', () => {
    const t = createBandOpeningTracker();
    // Busy baseline: 1 spot/min for 3h; short window continues at the same rate.
    const spots = [];
    for (let m = -179; m <= -1; m++) {
      spots.push(spot(`G${Math.abs(m) % 10}XX`, m, { n: m }));
    }
    t.ingest(spots, NOW);
    expect(t.analyze(NOW)).toEqual([]);
  });

  it('keeps distinct-call counting distinct (repeat spots of one call are not an opening)', () => {
    const t = createBandOpeningTracker();
    // 20 spots of the SAME call in the short window, no baseline.
    const spots = [];
    for (let i = 0; i < 20; i++) spots.push(spot('VK2IO', -1 - (i % 14), { n: i }));
    t.ingest(spots, NOW);
    expect(t.analyze(NOW)).toEqual([]); // 1 distinct call < 5
  });

  it('tracks band × continent-pair keys independently', () => {
    const t = createBandOpeningTracker();
    t.ingest([...burstSpots(6, { band: '10m', from: 'AS', to: 'NA' }), ...burstSpots(2, { band: '15m' })], NOW);
    const openings = t.analyze(NOW);
    expect(openings).toHaveLength(1);
    expect(openings[0].band).toBe('10m');
    expect(openings[0].from_continent).toBe('AS');
  });
});

describe('createBandOpeningTracker — state machine', () => {
  it('transitions opening → active while criteria hold', () => {
    const t = createBandOpeningTracker();
    t.ingest([...baselineSpots(10), ...burstSpots(8)], NOW);
    expect(t.analyze(NOW)[0].state).toBe('opening');
    expect(t.analyze(NOW + 1 * MIN)[0].state).toBe('active');
  });

  it('transitions active → closing when activity drops back, then disappears after the linger', () => {
    const t = createBandOpeningTracker();
    t.ingest([...baselineSpots(10), ...burstSpots(8)], NOW);
    t.analyze(NOW); // opening
    t.analyze(NOW + 1 * MIN); // active

    // 40 min later: the burst has left the 15-min short window entirely.
    const later = NOW + 40 * MIN;
    const closing = t.analyze(later);
    expect(closing).toHaveLength(1);
    expect(closing[0].state).toBe('closing');

    // After the closing linger expires the entry is dropped.
    const gone = t.analyze(later + DEFAULTS.closingLingerMs + 2 * MIN);
    expect(gone).toEqual([]);
  });

  it('applies hysteresis: stays active between the close and open thresholds', () => {
    const t = createBandOpeningTracker({ openFactor: 3, minDistinctCalls: 5 });
    t.ingest([...baselineSpots(10), ...burstSpots(8)], NOW);
    t.analyze(NOW); // opening

    // 10 min later: 4 of the 8 burst calls are still inside the short window
    // (4 distinct calls, factor ≈ 2.2) — below the open criteria (5 calls, 3×)
    // but above the close criteria (3 calls, 1.5×).
    const mid = NOW + 10 * MIN;
    const res = t.analyze(mid);
    expect(res).toHaveLength(1);
    expect(res[0].state).toBe('active');
  });

  it('sorts opening/active before closing', () => {
    const t = createBandOpeningTracker();
    t.ingest([...burstSpots(8, { band: '10m' })], NOW);
    t.analyze(NOW); // 10m opening
    // Add a fresh burst on 15m much later, while 10m decays to closing.
    const later = NOW + 40 * MIN;
    const freshBurst = burstSpots(6, { band: '15m' }).map((s) => ({
      ...s,
      id: `late-${s.id}`,
      timestamp: s.timestamp + 40 * MIN,
    }));
    t.ingest(freshBurst, later);
    const res = t.analyze(later);
    expect(res.map((r) => [r.band, r.state])).toEqual([
      ['15m', 'opening'],
      ['10m', 'closing'],
    ]);
  });
});

describe('createBandOpeningTracker — warm-up bookkeeping', () => {
  it('reports the observed data span and full-baseline coverage', () => {
    const t = createBandOpeningTracker();
    expect(t.dataSpanMs(NOW)).toBe(0);
    expect(t.hasFullBaseline(NOW)).toBe(false);

    t.ingest([spot('G0AAA', -30)], NOW);
    expect(t.dataSpanMs(NOW)).toBe(30 * MIN);
    expect(t.hasFullBaseline(NOW)).toBe(false);

    // Once the oldest ingested spot is 3h in the past, the baseline is covered.
    expect(t.hasFullBaseline(NOW + 150 * MIN)).toBe(true);
  });

  it('honors custom thresholds', () => {
    const t = createBandOpeningTracker({ openFactor: 10, minDistinctCalls: 2 });
    t.ingest([...baselineSpots(10), ...burstSpots(8)], NOW);
    expect(t.analyze(NOW)).toEqual([]); // 8 calls but factor < 10×

    const t2 = createBandOpeningTracker({ openFactor: 2, minDistinctCalls: 2 });
    t2.ingest([...baselineSpots(10), ...burstSpots(3)], NOW);
    const res = t2.analyze(NOW);
    expect(res).toHaveLength(1);
    expect(res[0].state).toBe('opening');
  });
});
