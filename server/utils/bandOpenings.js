/**
 * Band-opening detection — pure analysis over recent spot activity.
 *
 * Feed the tracker recent spots (from the RBN telnet stream and/or the DX
 * cluster path cache); it aggregates them per (band × DX-continent →
 * spotter-continent) key and compares a short trailing window (default 15 min)
 * against a long trailing baseline (default 3 h):
 *
 *   shortRate    = spots-per-minute in the short window
 *   baselineRate = spots-per-minute in the baseline period *excluding* the
 *                  short window (so a surge doesn't inflate its own baseline)
 *   factor       = shortRate / baselineRate
 *
 * A key is flagged as OPEN when factor >= openFactor (default 3×) AND the
 * short window contains at least minDistinctCalls distinct DX calls
 * (default 5) — the absolute floor keeps quiet bands (baseline ≈ 0) from
 * false-positiving on a couple of spots.
 *
 * State machine per key (evaluated on each analyze() call):
 *   (none)  --open criteria met-->  'opening'
 *   opening --still met-->          'active'
 *   active  --falls below close-->  'closing'   (hysteresis: close criteria
 *   closing --met again-->          'active'     are half the open criteria)
 *   closing --linger expired-->     (removed)
 *
 * Everything is deterministic on the injected `now` timestamps — no timers,
 * no I/O — so it is directly unit-testable and restarts are harmless (the
 * baseline simply warms back up; see hasFullBaseline()).
 */

const DEFAULTS = {
  shortWindowMs: 15 * 60 * 1000, // trailing "right now" window
  baselineWindowMs: 3 * 60 * 60 * 1000, // trailing baseline window
  openFactor: 3, // short rate must exceed baseline rate by this factor
  minDistinctCalls: 5, // absolute floor of distinct DX calls in the short window
  closingLingerMs: 10 * 60 * 1000, // how long a 'closing' entry stays visible
  maxSpotsPerKey: 20000, // hard memory cap per (band × path) key
};

function keyFor(band, fromContinent, toContinent) {
  return `${band}|${fromContinent}|${toContinent}`;
}

/**
 * Create a band-opening tracker.
 *
 * @param {object} [options] — overrides for DEFAULTS above.
 * @returns {{ ingest, analyze, hasFullBaseline, dataSpanMs, stats }}
 */
function createBandOpeningTracker(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const { shortWindowMs, baselineWindowMs, openFactor, minDistinctCalls, closingLingerMs, maxSpotsPerKey } = opts;

  // Hysteresis: a key stops being "open" only when it falls below half the
  // opening criteria — prevents flapping right at the threshold.
  const closeFactor = openFactor / 2;
  const closeDistinctCalls = Math.max(2, Math.ceil(minDistinctCalls / 2));

  const spotsByKey = new Map(); // key → [{ call, ts }] (pruned to baseline window)
  const seenIds = new Map(); // spot id → ts (dedupe across repeated ingests)
  const states = new Map(); // key → { state: 'opening'|'active'|'closing', since, closingSince }
  let oldestIngestedTs = null;
  let ingestedCount = 0;

  /**
   * Ingest spots. Each spot:
   *   { id?, call, band, fromContinent, toContinent, timestamp }
   * `id` (any stable string) dedupes across repeated ingests of the same
   * cache snapshot; when omitted one is derived from the other fields.
   * Spots missing a band, either continent, or a finite timestamp are skipped.
   *
   * @returns {number} spots actually accepted (new, valid, in-window)
   */
  function ingest(spots, now = Date.now()) {
    if (!Array.isArray(spots)) return 0;
    const cutoff = now - baselineWindowMs;
    let accepted = 0;

    for (const spot of spots) {
      if (!spot) continue;
      const { call, band, fromContinent, toContinent } = spot;
      const ts = Number(spot.timestamp);
      if (!call || !band || band === 'Other' || band === 'Unknown') continue;
      if (!fromContinent || !toContinent) continue;
      if (!Number.isFinite(ts) || ts <= cutoff || ts > now + 60 * 1000) continue;

      const id = spot.id || `${call}|${band}|${fromContinent}|${toContinent}|${ts}`;
      if (seenIds.has(id)) continue;
      seenIds.set(id, ts);

      const key = keyFor(band, fromContinent, toContinent);
      let list = spotsByKey.get(key);
      if (!list) {
        list = [];
        spotsByKey.set(key, list);
      }
      list.push({ call: String(call).toUpperCase(), ts });
      if (list.length > maxSpotsPerKey) list.splice(0, list.length - maxSpotsPerKey);

      if (oldestIngestedTs === null || ts < oldestIngestedTs) oldestIngestedTs = ts;
      accepted++;
      ingestedCount++;
    }
    prune(now);
    return accepted;
  }

  function prune(now) {
    const cutoff = now - baselineWindowMs;
    for (const [key, list] of spotsByKey) {
      const kept = list.filter((s) => s.ts > cutoff);
      if (kept.length === 0) spotsByKey.delete(key);
      else if (kept.length !== list.length) spotsByKey.set(key, kept);
    }
    for (const [id, ts] of seenIds) {
      if (ts <= cutoff) seenIds.delete(id);
    }
  }

  /**
   * Analyze current activity and advance the per-key state machine.
   * Returns opening entries sorted by factor (strongest first):
   *   { band, from_continent, to_continent, state, shortCount, baselineRate,
   *     factor, sampleCalls }
   */
  function analyze(now = Date.now()) {
    prune(now);
    const shortCutoff = now - shortWindowMs;
    const baselinePeriodMs = baselineWindowMs - shortWindowMs;
    const results = [];
    const liveKeys = new Set();

    for (const [key, list] of spotsByKey) {
      const shortCalls = new Map(); // call → latest ts (distinct-call counting + samples)
      let shortSpots = 0;
      let baselineSpots = 0;
      for (const s of list) {
        if (s.ts > shortCutoff) {
          shortSpots++;
          const prev = shortCalls.get(s.call);
          if (prev === undefined || s.ts > prev) shortCalls.set(s.call, s.ts);
        } else {
          baselineSpots++;
        }
      }

      const shortCount = shortCalls.size;
      const shortRate = shortSpots / (shortWindowMs / 60000); // spots per minute
      const baselineRate = baselineSpots / (baselinePeriodMs / 60000); // spots per minute
      const factor = baselineRate > 0 ? shortRate / baselineRate : shortSpots > 0 ? Infinity : 0;

      const meetsOpen = shortCount >= minDistinctCalls && factor >= openFactor;
      const meetsClose = shortCount >= closeDistinctCalls && factor >= closeFactor;

      const prev = states.get(key);
      let state = null;

      if (!prev || prev.state === 'closing') {
        if (meetsOpen) {
          state = prev ? 'active' : 'opening'; // re-opening from 'closing' resumes as active
          states.set(key, { state, since: prev?.since ?? now, closingSince: null });
        } else if (prev) {
          // Still closing — linger, then drop.
          if (now - prev.closingSince > closingLingerMs) {
            states.delete(key);
          } else {
            state = 'closing';
          }
        }
      } else {
        // prev.state is 'opening' or 'active'
        if (meetsClose) {
          state = 'active';
          states.set(key, { state, since: prev.since, closingSince: null });
        } else {
          state = 'closing';
          states.set(key, { state, since: prev.since, closingSince: now });
        }
      }

      if (state) {
        liveKeys.add(key);
        const [band, fromContinent, toContinent] = key.split('|');
        const sampleCalls = [...shortCalls.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([call]) => call);
        results.push({
          band,
          from_continent: fromContinent,
          to_continent: toContinent,
          state,
          shortCount,
          baselineRate: Number(baselineRate.toFixed(3)),
          factor: Number.isFinite(factor) ? Number(factor.toFixed(2)) : null,
          sampleCalls,
        });
      }
    }

    // Keys whose spots aged out entirely can still hold stale state — clear them.
    for (const key of states.keys()) {
      if (!liveKeys.has(key) && !spotsByKey.has(key)) states.delete(key);
    }

    const rank = { opening: 0, active: 1, closing: 2 };
    results.sort((a, b) => rank[a.state] - rank[b.state] || (b.factor ?? Infinity) - (a.factor ?? Infinity));
    return results;
  }

  /** Milliseconds of history the tracker has actually observed. */
  function dataSpanMs(now = Date.now()) {
    return oldestIngestedTs === null ? 0 : Math.max(0, now - oldestIngestedTs);
  }

  /** True once the observed history covers the full baseline window. */
  function hasFullBaseline(now = Date.now()) {
    return dataSpanMs(now) >= baselineWindowMs;
  }

  function stats() {
    let spots = 0;
    for (const list of spotsByKey.values()) spots += list.length;
    return { keys: spotsByKey.size, spots, ingested: ingestedCount, states: states.size };
  }

  return { ingest, analyze, hasFullBaseline, dataSpanMs, stats, options: opts };
}

module.exports = { createBandOpeningTracker, DEFAULTS };
