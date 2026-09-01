import { describe, it, expect } from 'vitest';
import {
  IBP_BEACONS,
  IBP_BANDS,
  CYCLE_SECONDS,
  SLOT_SECONDS,
  HISTORY_MAX_CYCLES,
  getCurrentSlot,
  getSchedule,
  getCycleStartMs,
  getUpcomingSchedule,
  updateHeardHistory,
} from './ibp.js';

const CYCLE_MS = CYCLE_SECONDS * 1000;

describe('getCycleStartMs', () => {
  it('returns the exact 3-minute boundary containing the date', () => {
    // 12:04:25.750Z → cycle start 12:03:00.000Z
    const d = new Date('2026-08-27T12:04:25.750Z');
    expect(getCycleStartMs(d)).toBe(new Date('2026-08-27T12:03:00.000Z').getTime());
  });

  it('is idempotent on a cycle boundary', () => {
    const boundary = new Date('2026-08-27T00:06:00.000Z');
    expect(getCycleStartMs(boundary)).toBe(boundary.getTime());
  });

  it('strips sub-second milliseconds', () => {
    const d = new Date('2026-08-27T00:00:00.999Z');
    expect(getCycleStartMs(d)).toBe(new Date('2026-08-27T00:00:00.000Z').getTime());
  });
});

describe('getUpcomingSchedule', () => {
  it('returns one entry per 10-second slot for the requested cycles', () => {
    const entries = getUpcomingSchedule(new Date('2026-08-27T12:00:00Z'), 2);
    expect(entries).toHaveLength((2 * CYCLE_SECONDS) / SLOT_SECONDS); // 36
  });

  it('starts at the containing cycle boundary with slot 0', () => {
    const midCycle = new Date('2026-08-27T12:04:25Z'); // cycle start 12:03:00
    const entries = getUpcomingSchedule(midCycle, 1);
    expect(entries[0].startDate.getTime()).toBe(new Date('2026-08-27T12:03:00Z').getTime());
    expect(entries[0].slot).toBe(0);
    expect(entries.map((e) => e.slot)).toEqual([...Array(18).keys()]);
  });

  it('slot numbers agree with getCurrentSlot at each entry start time', () => {
    // Regression: the pre-Phase-4 implementation offset slots by the elapsed
    // slots of the query time, giving wrong beacons except at cycle start.
    const midCycle = new Date('2026-08-27T12:04:25Z');
    for (const entry of getUpcomingSchedule(midCycle, 2)) {
      expect(entry.slot).toBe(getCurrentSlot(entry.startDate));
    }
  });

  it('per-slot bands agree with getSchedule for the same instant', () => {
    const midCycle = new Date('2026-08-27T09:31:47Z');
    for (const entry of getUpcomingSchedule(midCycle, 2)) {
      const live = getSchedule(entry.startDate);
      entry.bands.forEach(({ band, beacon }, i) => {
        expect(band).toBe(live[i].band);
        expect(beacon.callsign).toBe(live[i].beacon.callsign);
      });
    }
  });

  it('every beacon runs 20m exactly once per cycle (bands[0] has offset 0)', () => {
    const entries = getUpcomingSchedule(new Date('2026-08-27T12:00:05Z'), 1);
    const on20m = entries.map((e) => e.bands[0].beacon.callsign);
    expect(new Set(on20m).size).toBe(IBP_BEACONS.length);
    // First 20m beacon of a cycle is the first beacon in transmission order.
    expect(on20m[0]).toBe(IBP_BEACONS[0].callsign);
  });

  it('band ordering matches IBP_BANDS', () => {
    const [first] = getUpcomingSchedule(new Date('2026-08-27T12:00:00Z'), 1);
    expect(first.bands.map((b) => b.band.label)).toEqual(IBP_BANDS.map((b) => b.label));
  });
});

describe('updateHeardHistory', () => {
  const T0 = new Date('2026-08-27T12:00:00Z').getTime();
  const snap = (obj) => new Map(Object.entries(obj));

  it('appends a new cycle record from an empty history', () => {
    const h1 = updateHeardHistory([], T0, snap({ '4U1UN': { maxSNR: 12, count: 3 } }));
    expect(h1).toHaveLength(1);
    expect(h1[0].cycleStartMs).toBe(T0);
    expect(h1[0].heard.get('4U1UN')).toEqual({ maxSNR: 12, count: 3 });
  });

  it('appends an empty record on cycle rollover so the timeline advances', () => {
    const h1 = updateHeardHistory([], T0, new Map());
    const h2 = updateHeardHistory(h1, T0 + CYCLE_MS, new Map());
    expect(h2).toHaveLength(2);
    expect(h2[1].cycleStartMs).toBe(T0 + CYCLE_MS);
    expect(h2[1].heard.size).toBe(0);
  });

  it('merges same-cycle snapshots keeping max SNR and max count', () => {
    let h = updateHeardHistory([], T0, snap({ W6WX: { maxSNR: 5, count: 2 } }));
    h = updateHeardHistory(h, T0, snap({ W6WX: { maxSNR: 11, count: 1 }, OH2B: { maxSNR: null, count: 4 } }));
    expect(h).toHaveLength(1);
    expect(h[0].heard.get('W6WX')).toEqual({ maxSNR: 11, count: 2 });
    expect(h[0].heard.get('OH2B')).toEqual({ maxSNR: null, count: 4 });
  });

  it('a null SNR never downgrades a known SNR', () => {
    let h = updateHeardHistory([], T0, snap({ ZL6B: { maxSNR: 20, count: 1 } }));
    h = updateHeardHistory(h, T0, snap({ ZL6B: { maxSNR: null, count: 1 } }));
    expect(h[0].heard.get('ZL6B')).toEqual({ maxSNR: 20, count: 1 });
  });

  it('returns the same reference when nothing changed', () => {
    const h1 = updateHeardHistory([], T0, snap({ CS3B: { maxSNR: 8, count: 2 } }));
    const h2 = updateHeardHistory(h1, T0, snap({ CS3B: { maxSNR: 8, count: 2 } }));
    expect(h2).toBe(h1);
    const h3 = updateHeardHistory(h1, T0, new Map());
    expect(h3).toBe(h1);
  });

  it('does not mutate previous history entries on merge', () => {
    const h1 = updateHeardHistory([], T0, snap({ CS3B: { maxSNR: 8, count: 2 } }));
    updateHeardHistory(h1, T0, snap({ CS3B: { maxSNR: 30, count: 5 } }));
    expect(h1[0].heard.get('CS3B')).toEqual({ maxSNR: 8, count: 2 });
  });

  it('ignores snapshots for cycles older than the newest record', () => {
    const h1 = updateHeardHistory([], T0, new Map());
    const h2 = updateHeardHistory(h1, T0 - CYCLE_MS, snap({ YV5B: { maxSNR: 9, count: 1 } }));
    expect(h2).toBe(h1);
  });

  it('trims to maxCycles, dropping the oldest records', () => {
    let h = [];
    for (let i = 0; i < HISTORY_MAX_CYCLES + 3; i++) {
      h = updateHeardHistory(h, T0 + i * CYCLE_MS, new Map());
    }
    expect(h).toHaveLength(HISTORY_MAX_CYCLES);
    expect(h[0].cycleStartMs).toBe(T0 + 3 * CYCLE_MS);
    expect(h[h.length - 1].cycleStartMs).toBe(T0 + (HISTORY_MAX_CYCLES + 2) * CYCLE_MS);
  });

  it('respects a custom maxCycles', () => {
    let h = [];
    for (let i = 0; i < 5; i++) {
      h = updateHeardHistory(h, T0 + i * CYCLE_MS, new Map(), 3);
    }
    expect(h).toHaveLength(3);
    expect(h[0].cycleStartMs).toBe(T0 + 2 * CYCLE_MS);
  });
});
