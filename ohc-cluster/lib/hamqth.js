/**
 * HamQTH DX cluster CSV poller — our source of HUMAN spots until enough
 * OHC users submit their own.
 *
 * HamQTH publishes an HTTP CSV feed of cluster spots; one polite poll per
 * minute is well within good-neighbour territory (the main app already polls
 * the same feed today).
 *
 * CSV format (caret-separated):
 * Spotter^FreqKHz^DXCall^Comment^HHMM YYYY-MM-DD^^^Continent^Band^Country^DXCC
 */

const POLL_INTERVAL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const URL = 'https://www.hamqth.com/dxc_csv.php?limit=50';

function parseHamqthTimestamp(timeDate) {
  // "2149 2025-05-27" -> UTC epoch ms
  const m = String(timeDate || '')
    .trim()
    .match(/^(\d{2})(\d{2})\s+(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return Date.now();
  const ts = Date.UTC(
    parseInt(m[3], 10),
    parseInt(m[4], 10) - 1,
    parseInt(m[5], 10),
    parseInt(m[1], 10),
    parseInt(m[2], 10),
  );
  return Number.isFinite(ts) ? ts : Date.now();
}

function parseHamqthCsv(text) {
  const spots = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('^')) continue;
    const parts = line.split('^');
    const freqKhz = parseFloat(parts[1]);
    if (!parts[0] || !parts[2] || !Number.isFinite(freqKhz) || freqKhz <= 0) continue;
    spots.push({
      spotter: parts[0].trim().toUpperCase(),
      call: parts[2].trim().toUpperCase(),
      freqKhz,
      comment: (parts[3] || '').trim(),
      timestamp: parseHamqthTimestamp(parts[4]),
      source: 'HamQTH',
      isSkimmer: false,
    });
  }
  return spots;
}

class HamqthPoller {
  constructor({ store, log, appVersion }) {
    this.store = store;
    this.log = log;
    this.userAgent = `OpenHamClock-Cluster/${appVersion || '0.1.0'}`;
    this.timer = null;
    this.lastPollAt = 0;
    this.lastSuccessAt = 0;
    this.pollCount = 0;
    this.errorCount = 0;
  }

  start() {
    this._poll();
    this.timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return {
      lastPollAgeMs: this.lastPollAt ? Date.now() - this.lastPollAt : null,
      lastSuccessAgeMs: this.lastSuccessAt ? Date.now() - this.lastSuccessAt : null,
      pollCount: this.pollCount,
      errorCount: this.errorCount,
    };
  }

  async _poll() {
    this.lastPollAt = Date.now();
    this.pollCount++;
    try {
      const response = await fetch(URL, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const spots = parseHamqthCsv(await response.text());
      // Store dedupes by spotter+call+freq window, so re-polling the same
      // window every minute only inserts genuinely new spots.
      for (const spot of spots) this.store.add(spot);
      this.lastSuccessAt = Date.now();
    } catch (err) {
      this.errorCount++;
      this.log('ERROR', `[HamQTH] poll failed: ${err.message}`);
    }
  }
}

module.exports = { HamqthPoller, parseHamqthCsv, parseHamqthTimestamp };
