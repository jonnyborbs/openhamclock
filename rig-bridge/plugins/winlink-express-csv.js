'use strict';
/**
 * winlink-express-csv.js — Winlink Express form-export CSV ingest plugin
 *
 * Winlink Express at an EOC accumulates a continuously-updated CSV of
 * received forms (Field Situation Reports, Damage Assessments, ...) with
 * embedded geolocation. No API exists — the CSV file on disk is the
 * interface. This plugin watches that file (fs.watch on the parent directory
 * plus an interval-poll fallback, since Winlink Express rewrites the file),
 * parses rows tolerantly (header-driven column mapping via
 * lib/winlink-csv-parser), dedupes rows by content hash, and POSTs new rows
 * to the OHC server's /api/emcomm/field-reports endpoint where the EmComm
 * layout displays them as a list and map markers.
 *
 * Config section: config.winlinkExpressCsv
 *   enabled:       boolean  (default: false)
 *   csvPath:       string   Absolute path to the Winlink Express CSV export
 *   pollInterval:  number   Poll interval in seconds (default: 30)
 *   ohcUrl:        string   OHC server URL (default: 'http://localhost:8080')
 *   verbose:       boolean  Log every parsed/posted row (default: false)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parseWinlinkCsv } = require('../lib/winlink-csv-parser');

let _currentInstance = null;

const MAX_SEEN_HASHES = 5000; // bound the dedupe set for very large CSVs
const POST_BATCH_MAX = 100; // rows per POST — matches server-side cap of 500 stored

const descriptor = {
  id: 'winlink-express-csv',
  name: 'Winlink Express CSV Ingest',
  category: 'integration',
  configKey: 'winlinkExpressCsv',

  registerRoutes(app) {
    app.get('/api/winlink-express-csv/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
  },

  create(config, services) {
    const cfg = config.winlinkExpressCsv || {};
    const csvPath = cfg.csvPath || '';
    const pollMs = Math.max(5, cfg.pollInterval ?? 30) * 1000;
    const ohcUrl = (cfg.ohcUrl || 'http://localhost:8080').replace(/\/$/, '');
    const verbose = !!cfg.verbose;

    let running = false;
    let pollTimer = null;
    let watcher = null;
    let watchDebounce = null;
    let checking = false;
    let lastMtimeMs = 0;
    let lastSize = -1;
    let rowsParsed = 0;
    let rowsPosted = 0;
    let postErrors = 0;
    let lastCheckTime = null;
    let lastPostTime = null;
    let lastError = null;

    // Dedupe by row content hash — insertion-ordered Map used as an LRU-ish
    // bounded set (oldest entries evicted first).
    const seen = new Map(); // hash → true

    function markSeen(hash) {
      seen.set(hash, true);
      if (seen.size > MAX_SEEN_HASHES) {
        const oldest = seen.keys().next().value;
        seen.delete(oldest);
      }
    }

    // POST a batch of new reports to the OHC server. Fire-and-forget with
    // error counting — a down OHC server never stalls the watch loop.
    function postReports(reports) {
      let parsed;
      try {
        parsed = new URL(`${ohcUrl}/api/emcomm/field-reports`);
      } catch (e) {
        lastError = `Invalid ohcUrl: ${e.message}`;
        return;
      }
      const body = JSON.stringify({ reports });
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          res.resume(); // drain
          if (res.statusCode >= 200 && res.statusCode < 300) {
            rowsPosted += reports.length;
            lastPostTime = Date.now();
            lastError = null;
            if (verbose) console.log(`[Winlink-CSV] Posted ${reports.length} report(s) to ${parsed.hostname}`);
          } else {
            postErrors++;
            lastError = `OHC server responded ${res.statusCode}`;
            console.warn(`[Winlink-CSV] POST failed: HTTP ${res.statusCode}`);
          }
        },
      );
      req.on('error', (err) => {
        postErrors++;
        lastError = err.message;
        console.warn(`[Winlink-CSV] POST error: ${err.message}`);
      });
      req.setTimeout(5000, () => req.destroy());
      req.write(body);
      req.end();
    }

    // Read + parse the CSV, forward rows not seen before.
    function checkFile(force) {
      if (checking || !running) return;
      checking = true;
      lastCheckTime = Date.now();
      try {
        let st;
        try {
          st = fs.statSync(csvPath);
        } catch (e) {
          lastError = `CSV not found: ${csvPath}`;
          return;
        }
        // Skip re-parsing when the file is untouched (poll path).
        if (!force && st.mtimeMs === lastMtimeMs && st.size === lastSize) return;
        lastMtimeMs = st.mtimeMs;
        lastSize = st.size;

        const text = fs.readFileSync(csvPath, 'utf8');
        const { reports, skipped } = parseWinlinkCsv(text);
        rowsParsed = reports.length;

        const fresh = [];
        for (const report of reports) {
          if (seen.has(report.id)) continue;
          markSeen(report.id);
          fresh.push({ ...report, receivedVia: 'winlink-express-csv' });
        }
        if (verbose && (fresh.length || skipped)) {
          console.log(`[Winlink-CSV] ${reports.length} row(s) in file, ${fresh.length} new, ${skipped} skipped`);
        }
        for (let i = 0; i < fresh.length; i += POST_BATCH_MAX) {
          postReports(fresh.slice(i, i + POST_BATCH_MAX));
        }
      } catch (e) {
        lastError = e.message;
        console.warn(`[Winlink-CSV] Parse error: ${e.message}`);
      } finally {
        checking = false;
      }
    }

    function connect() {
      if (!csvPath) {
        console.warn('[Winlink-CSV] Cannot start: set winlinkExpressCsv.csvPath in rig-bridge config');
        return;
      }
      running = true;
      console.log(`[Winlink-CSV] Watching ${csvPath} (poll every ${pollMs / 1000}s)`);

      // fs.watch on the parent directory — Winlink Express rewrites the file,
      // which breaks per-file watchers on rename. Debounced so a burst of
      // write events triggers a single parse.
      try {
        const dir = path.dirname(csvPath);
        const base = path.basename(csvPath);
        watcher = fs.watch(dir, (eventType, filename) => {
          if (filename && filename !== base) return;
          clearTimeout(watchDebounce);
          watchDebounce = setTimeout(() => checkFile(false), 1000);
        });
        watcher.on('error', (err) => {
          console.warn(`[Winlink-CSV] fs.watch error (${err.message}) — falling back to polling only`);
          try {
            watcher.close();
          } catch (e) {}
          watcher = null;
        });
      } catch (e) {
        console.warn(`[Winlink-CSV] fs.watch unavailable (${e.message}) — polling only`);
        watcher = null;
      }

      // Polling fallback — also the primary mechanism on network shares where
      // fs.watch events are unreliable.
      pollTimer = setInterval(() => checkFile(false), pollMs);

      // Initial read so existing rows are forwarded on startup.
      checkFile(true);
    }

    function disconnect() {
      running = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      clearTimeout(watchDebounce);
      watchDebounce = null;
      if (watcher) {
        try {
          watcher.close();
        } catch (e) {}
        watcher = null;
      }
      _currentInstance = null;
      console.log(`[Winlink-CSV] Stopped (parsed: ${rowsParsed}, posted: ${rowsPosted}, errors: ${postErrors})`);
    }

    function getStatus() {
      return {
        enabled: !!cfg.enabled,
        running,
        csvPath,
        pollIntervalSec: pollMs / 1000,
        ohcUrl,
        watching: watcher !== null,
        rowsParsed,
        rowsPosted,
        postErrors,
        lastCheckTime,
        lastPostTime,
        lastError,
        seenHashes: seen.size,
      };
    }

    const instance = { connect, disconnect, getStatus, checkFile };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
