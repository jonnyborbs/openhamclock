/**
 * Reverse Beacon Network ingest.
 *
 * RBN runs two open telnet feeds explicitly intended for automated
 * consumption (unlike DXSpider nodes, where unattended clients are a
 * courtesy problem — see the NC7J saga):
 *   telnet.reversebeacon.net:7000  — CW / RTTY skimmer spots
 *   telnet.reversebeacon.net:7001  — FT8 / FT4 skimmer spots
 *
 * Login is just a callsign at the prompt. Volume is high (hundreds of spots
 * per minute on 7000), so everything goes into the store flagged isSkimmer
 * for call+band+mode aggregation.
 */

const net = require('net');

const RECONNECT_BASE_MS = 10 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const STALE_MS = 3 * 60 * 1000; // RBN is never quiet for 3 min — assume dead link
const MAX_BUFFER = 64 * 1024;

// DX de KM3T-#:    14025.1  W1AW       CW    23 dB  22 WPM  CQ     1234Z
// DX de S50ARX-#:  14074.0  DL1ABC     FT8  -13 dB           CQ    1234Z
const RBN_LINE_RE =
  /^DX de\s+([A-Z0-9/\-]+?)(-#)?:\s+(\d+\.?\d*)\s+([A-Z0-9/]+)\s+([A-Z0-9]+)\s+([+-]?\d+)\s*dB(?:\s+(\d+)\s*(?:WPM|BPS))?\s+(.*?)\s*(\d{4})Z?\s*$/i;

function parseRbnLine(line) {
  const m = line.trim().match(RBN_LINE_RE);
  if (!m) return null;
  const freqKhz = parseFloat(m[3]);
  if (!Number.isFinite(freqKhz) || freqKhz <= 0) return null;

  const mode = m[5].toUpperCase();
  const snr = parseInt(m[6], 10);
  const wpm = m[7] ? parseInt(m[7], 10) : null;
  const extra = (m[8] || '').trim(); // CQ / NCDXF B / DX / ...

  const commentParts = [mode, `${snr} dB`];
  if (wpm) commentParts.push(`${wpm} WPM`);
  if (extra) commentParts.push(extra);

  return {
    spotter: `${m[1].toUpperCase()}-#`, // keep skimmer marker, cluster convention
    call: m[4].toUpperCase(),
    freqKhz,
    mode,
    snr: Number.isFinite(snr) ? snr : null,
    wpm: Number.isFinite(wpm) ? wpm : null,
    comment: commentParts.join(' '),
    timestamp: Date.now(), // RBN spots are live; HHMM in line adds nothing
    source: 'RBN',
    isSkimmer: true,
  };
}

class RbnFeed {
  constructor({ host, port, callsign, store, log, name }) {
    this.host = host;
    this.port = port;
    this.callsign = callsign;
    this.store = store;
    this.log = log;
    this.name = name || `${host}:${port}`;

    this.client = null;
    this.buffer = '';
    this.loginSent = false;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.staleTimer = null;
    this.lastDataAt = 0;
    this.spotCount = 0;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.staleTimer);
    try {
      this.client?.destroy();
    } catch {}
    this.client = null;
    this.connected = false;
  }

  status() {
    return {
      name: this.name,
      connected: this.connected,
      spotCount: this.spotCount,
      lastDataAgeMs: this.lastDataAt ? Date.now() - this.lastDataAt : null,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  _connect() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.destroy();
      } catch {}
    }

    this.buffer = '';
    this.loginSent = false;
    const client = new net.Socket();
    this.client = client;

    this.log('CONNECT', `[RBN ${this.name}] connecting as ${this.callsign}`);

    client.connect(this.port, this.host, () => {
      this.connected = true;
      this.lastDataAt = Date.now();
      this.log('CONNECT', `[RBN ${this.name}] connected`);

      clearInterval(this.staleTimer);
      this.staleTimer = setInterval(() => {
        if (Date.now() - this.lastDataAt > STALE_MS) {
          this.log('TIMEOUT', `[RBN ${this.name}] no data for ${STALE_MS / 1000}s — reconnecting`);
          this._scheduleReconnect();
        }
      }, 30 * 1000);

      // Fallback login in case the prompt text isn't matched
      setTimeout(() => {
        if (this.client === client && this.connected && !this.loginSent) {
          this.loginSent = true;
          client.write(`${this.callsign}\r\n`);
        }
      }, 3000);
    });

    client.on('data', (data) => {
      this.lastDataAt = Date.now();
      this.buffer += data.toString('utf8');
      if (this.buffer.length > MAX_BUFFER) this.buffer = this.buffer.slice(-MAX_BUFFER);

      if (!this.loginSent && /please enter your call/i.test(this.buffer)) {
        this.loginSent = true;
        client.write(`${this.callsign}\r\n`);
        return;
      }

      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        const spot = parseRbnLine(line);
        if (spot) {
          this.spotCount++;
          this.reconnectAttempts = 0; // healthy feed
          this.store.add(spot);
        }
      }
    });

    client.on('error', (err) => {
      this.log('ERROR', `[RBN ${this.name}] ${err.message}`);
      this._scheduleReconnect();
    });

    client.on('close', () => {
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.connected = false;
    clearInterval(this.staleTimer);
    try {
      this.client?.removeAllListeners();
      this.client?.destroy();
    } catch {}
    this.client = null;

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.log('RECONNECT', `[RBN ${this.name}] reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }
}

module.exports = { RbnFeed, parseRbnLine };
