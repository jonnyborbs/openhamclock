/**
 * OpenHamClock Cluster — our own DX cluster node.
 *
 * Born 2026-06-10 after the NC7J sysop suggested we "build our own cluster".
 * OK. Done.
 *
 * Ingest:  RBN skimmer feeds (CW/RTTY + FT8/FT4), HamQTH human spots,
 *          user submissions (telnet `dx` command + HTTP POST).
 * Serve:   classic telnet cluster on :7300, HTTP API on :3002.
 *
 * Environment:
 *   PORT          HTTP port             (default 3002)
 *   TELNET_PORT   telnet cluster port   (default 7300)
 *   CALLSIGN      callsign used to log in to RBN          (default K0CJH)
 *   NODE_CALL     node callsign shown to telnet users     (default K0CJH-2)
 *   RBN_ENABLED   set to '0' to disable RBN ingest
 *   HAMQTH_ENABLED set to '0' to disable HamQTH ingest
 *   LOG_LEVEL     debug | info | warn   (default info)
 */

const { SpotStore } = require('./lib/store.js');
const { RbnFeed } = require('./lib/rbn.js');
const { HamqthPoller } = require('./lib/hamqth.js');
const { TelnetClusterServer } = require('./lib/telnetServer.js');
const { buildHttpApi } = require('./lib/httpApi.js');
const { isValidCallsign } = require('./lib/callsign.js');
const pkg = require('./package.json');

const HTTP_PORT = parseInt(process.env.PORT, 10) || 3002;
const TELNET_PORT = parseInt(process.env.TELNET_PORT, 10) || 7300;
const CALLSIGN = (process.env.CALLSIGN || 'K0CJH').trim().toUpperCase();
const NODE_CALL = (process.env.NODE_CALL || 'K0CJH-2').trim().toUpperCase();

// Same fail-closed stance as dxspider-proxy: never present an invalid
// callsign to anyone else's infrastructure.
if (!isValidCallsign(CALLSIGN)) {
  console.error(`FATAL: CALLSIGN "${CALLSIGN}" is not a valid amateur callsign. Set the CALLSIGN env var.`);
  process.exit(1);
}

// Log levels: debug shows per-spot noise, info shows lifecycle events
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_LEVELS = { debug: 0, info: 1, warn: 2 };
const CATEGORY_LEVELS = {
  SPOT: 'debug',
  CLEANUP: 'debug',
  CONNECT: 'info',
  CLOSE: 'info',
  RECONNECT: 'info',
  AUTH: 'info',
  START: 'info',
  TIMEOUT: 'warn',
  ERROR: 'warn',
};
const log = (category, message) => {
  const lvl = LOG_LEVELS[CATEGORY_LEVELS[category] || 'info'] ?? 1;
  if (lvl < (LOG_LEVELS[LOG_LEVEL] ?? 1)) return;
  console.log(`[${new Date().toISOString()}] [${category}] ${message}`);
};

const startTime = Date.now();
const store = new SpotStore();

// Periodic retention sweep
setInterval(() => {
  const removed = store.cleanup();
  if (removed > 0) log('CLEANUP', `Removed ${removed} expired spots`);
}, 60 * 1000);

// ── Ingest ────────────────────────────────────────────────────────────
const feeds = [];
if (process.env.RBN_ENABLED !== '0') {
  feeds.push(
    new RbnFeed({ host: 'telnet.reversebeacon.net', port: 7000, callsign: CALLSIGN, store, log, name: 'cw-rtty' }),
    new RbnFeed({ host: 'telnet.reversebeacon.net', port: 7001, callsign: CALLSIGN, store, log, name: 'ft8-ft4' }),
  );
  for (const feed of feeds) feed.start();
}

let hamqth = null;
if (process.env.HAMQTH_ENABLED !== '0') {
  hamqth = new HamqthPoller({ store, log, appVersion: pkg.version });
  hamqth.start();
}

// ── Serve ─────────────────────────────────────────────────────────────
const telnetServer = new TelnetClusterServer({
  port: TELNET_PORT,
  nodeCall: NODE_CALL,
  store,
  log,
  motd: 'Welcome to the OpenHamClock DX Cluster (openhamclock.com)\r\nIn memory of Elwood Downey, WB0OEW.',
});
telnetServer.start();

const app = buildHttpApi({ store, feeds, telnetServer, hamqth, log, startTime, nodeCall: NODE_CALL });
app.listen(HTTP_PORT, () => {
  log('START', `OHC-Cluster v${pkg.version} — HTTP :${HTTP_PORT}, telnet :${TELNET_PORT}, node call ${NODE_CALL}`);
});

// ── Shutdown ──────────────────────────────────────────────────────────
const shutdown = () => {
  log('START', 'Shutting down');
  for (const feed of feeds) feed.stop();
  hamqth?.stop();
  telnetServer.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
