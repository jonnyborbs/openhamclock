/**
 * SpotStore — central in-memory spot accumulator.
 *
 * Two classes of spots flow through here:
 *  - Skimmer spots (RBN): enormous volume, many skimmers spotting the same
 *    station. Collapsed by call+band+mode into one living spot whose SNR,
 *    frequency and timestamp refresh as new skimmer reports arrive.
 *  - Human spots (HamQTH poll, telnet DX command, HTTP submissions): low
 *    volume, every distinct one kept (deduped by spotter+call+freq window).
 *
 * Subscribers (telnet broadcast, future websocket) get notified only when a
 * spot is NEW to the stream — a skimmer refresh of an existing aggregate does
 * not re-fire unless the rebroadcast window has elapsed.
 */

const { bandForKhz, toHHMMz } = require('./format.js');

const DEFAULTS = {
  retentionMs: 30 * 60 * 1000, // drop spots older than 30 min
  maxSpots: 2000, // hard cap across all sources
  humanDedupWindowMs: 2 * 60 * 1000, // same spotter+call+freq within 2 min = dupe
  skimmerRebroadcastMs: 10 * 60 * 1000, // re-announce a busy station at most every 10 min
};

class SpotStore {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.spots = []; // newest first
    this.skimmerIndex = new Map(); // call|band|mode -> spot ref
    this.listeners = new Set();
    this.counters = { received: 0, stored: 0, collapsed: 0, dropped: 0 };
  }

  onSpot(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(spot) {
    for (const fn of this.listeners) {
      try {
        fn(spot);
      } catch {}
    }
  }

  /**
   * Add a spot. Expected shape:
   * { spotter, call, freqKhz, comment, mode, source, timestamp,
   *   dxGrid?, spotterGrid?, snr?, wpm?, isSkimmer? }
   * Returns the stored spot, or null if dropped as a duplicate.
   */
  add(raw) {
    this.counters.received++;
    const freqKhz = parseFloat(raw.freqKhz);
    if (!raw.spotter || !raw.call || !Number.isFinite(freqKhz) || freqKhz <= 0) {
      this.counters.dropped++;
      return null;
    }

    const timestamp = Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now();
    const spot = {
      spotter: String(raw.spotter).toUpperCase(),
      call: String(raw.call).toUpperCase(),
      freqKhz,
      freq: (freqKhz / 1000).toFixed(3), // MHz string, matches dxspider-proxy shape
      band: bandForKhz(freqKhz),
      mode: raw.mode || null,
      comment: String(raw.comment || '').trim(),
      time: toHHMMz(timestamp),
      timestamp,
      dxGrid: raw.dxGrid || null,
      spotterGrid: raw.spotterGrid || null,
      snr: Number.isFinite(raw.snr) ? raw.snr : null,
      wpm: Number.isFinite(raw.wpm) ? raw.wpm : null,
      skimmerCount: raw.isSkimmer ? 1 : 0,
      source: raw.source || 'OHC',
    };

    if (raw.isSkimmer) {
      return this._addSkimmer(spot);
    }
    return this._addHuman(spot);
  }

  _addSkimmer(spot) {
    const key = `${spot.call}|${spot.band || 'oob'}|${spot.mode || '?'}`;
    const existing = this.skimmerIndex.get(key);

    if (existing && spot.timestamp - existing.timestamp < this.opts.retentionMs) {
      // Refresh the living aggregate in place
      existing.skimmerCount += 1;
      existing.timestamp = spot.timestamp;
      existing.time = spot.time;
      existing.freqKhz = spot.freqKhz;
      existing.freq = spot.freq;
      existing.spotter = spot.spotter; // most recent skimmer
      if (spot.snr != null && (existing.snr == null || spot.snr > existing.snr)) {
        existing.snr = spot.snr;
        existing.comment = spot.comment; // comment follows best report
      }
      this.counters.collapsed++;

      // Re-announce long-running activity occasionally so late joiners see it
      if (spot.timestamp - (existing.lastBroadcast || 0) >= this.opts.skimmerRebroadcastMs) {
        existing.lastBroadcast = spot.timestamp;
        this._emit(existing);
      }
      return existing;
    }

    spot.lastBroadcast = spot.timestamp;
    this.skimmerIndex.set(key, spot);
    this._insert(spot);
    this._emit(spot);
    return spot;
  }

  _addHuman(spot) {
    const dupe = this.spots.some(
      (s) =>
        s.call === spot.call &&
        s.spotter === spot.spotter &&
        Math.abs(s.freqKhz - spot.freqKhz) < 0.5 &&
        Math.abs(spot.timestamp - s.timestamp) < this.opts.humanDedupWindowMs,
    );
    if (dupe) {
      this.counters.dropped++;
      return null;
    }
    this._insert(spot);
    this._emit(spot);
    return spot;
  }

  _insert(spot) {
    this.spots.unshift(spot);
    this.counters.stored++;
    if (this.spots.length > this.opts.maxSpots) {
      const evicted = this.spots.splice(this.opts.maxSpots);
      for (const s of evicted) this._dropFromIndex(s);
    }
  }

  _dropFromIndex(spot) {
    if (!spot.skimmerCount) return;
    const key = `${spot.call}|${spot.band || 'oob'}|${spot.mode || '?'}`;
    if (this.skimmerIndex.get(key) === spot) this.skimmerIndex.delete(key);
  }

  /** Most recent spots, optionally filtered. */
  query({ limit = 50, source = null, band = null, mode = null, humanOnly = false } = {}) {
    const out = [];
    for (const s of this.spots) {
      if (source && s.source !== source) continue;
      if (band && s.band !== band) continue;
      if (mode && s.mode !== mode) continue;
      if (humanOnly && s.skimmerCount > 0) continue;
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }

  cleanup() {
    const cutoff = Date.now() - this.opts.retentionMs;
    const keep = [];
    let removed = 0;
    for (const s of this.spots) {
      // Sort order is only approximate (skimmer refreshes update timestamps
      // in place), so walk the whole array rather than slicing at first-stale.
      if (s.timestamp > cutoff) {
        keep.push(s);
      } else {
        this._dropFromIndex(s);
        removed++;
      }
    }
    this.spots = keep;
    return removed;
  }

  stats() {
    return {
      activeSpots: this.spots.length,
      skimmerAggregates: this.skimmerIndex.size,
      ...this.counters,
    };
  }
}

module.exports = { SpotStore };
