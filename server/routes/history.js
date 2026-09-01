/**
 * Spot History routes — 24-hour DX spot recorder for map playback.
 *
 * The DX cluster path cache retains only ~60 minutes (enough for live
 * filtering, useless for "what was 10m doing at 1800Z?"). This route samples
 * that cache once a minute, dedupes into a rolling 24-hour ring, and serves
 * time-window queries for the History Playback map layer.
 *
 * Records are trimmed to what playback draws: endpoints, call/spotter, freq,
 * timestamp, and a short comment slice for client-side mode inference.
 * Responses are stride-downsampled (not newest-N) so a scrubbed window keeps
 * even coverage across its whole span.
 *
 * Storage: in-memory, periodic file persistence via the same writable-path
 * waterfall as sibling stores, so a restart keeps the day's history.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (app, ctx) {
  const { ROOT_DIR, logInfo, logWarn } = ctx;

  const RETENTION_MS = 24 * 60 * 60 * 1000;
  const MAX_SPOTS = 50000; // ~24h of mode-balanced cluster flow with headroom
  const RESPONSE_CAP = 4000;
  const SAMPLE_MS = 60 * 1000;
  const SAVE_MS = 10 * 60 * 1000;
  const COMMENT_MAX = 30;

  const HISTORY_FILE = (() => {
    const candidates = [
      process.env.SPOT_HISTORY_FILE,
      '/data/spot-history.json',
      path.join(ROOT_DIR, 'data', 'spot-history.json'),
      '/tmp/openhamclock-spot-history.json',
    ];
    for (const p of candidates) {
      if (!p) continue;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        return p;
      } catch {
        continue;
      }
    }
    return '/tmp/openhamclock-spot-history.json';
  })();

  let spots = []; // ascending by timestamp
  const seen = new Set(); // identity keys currently inside the ring

  const identity = (p) =>
    p.id != null ? `i${p.id}` : `${p.spotter}|${p.dxCall}|${p.freq}|${Math.round((p.timestamp || 0) / 60000)}`;

  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    if (Array.isArray(parsed)) {
      const cutoff = Date.now() - RETENTION_MS;
      spots = parsed.filter((s) => s && s.timestamp > cutoff).slice(-MAX_SPOTS);
      for (const s of spots) seen.add(identity(s));
      if (spots.length) logInfo(`[History] Loaded ${spots.length} spot(s) from ${HISTORY_FILE}`);
    }
  } catch {
    /* first run */
  }

  const trim = (p) => ({
    timestamp: p.timestamp,
    dxCall: p.dxCall,
    spotter: p.spotter,
    freq: p.freq,
    dxLat: p.dxLat,
    dxLon: p.dxLon,
    spotterLat: p.spotterLat,
    spotterLon: p.spotterLon,
    comment: typeof p.comment === 'string' ? p.comment.substring(0, COMMENT_MAX) : '',
    id: p.id,
  });

  function sample() {
    const cache = ctx.dxSpotPathsCacheByKey;
    if (!cache || typeof cache.values !== 'function') return;
    const now = Date.now();
    let added = 0;
    for (const entry of cache.values()) {
      const paths = entry?.pathsCache?.allPaths || entry?.allPaths;
      if (!Array.isArray(paths)) continue;
      for (const p of paths) {
        if (!p?.dxCall || !Number.isFinite(p.timestamp)) continue;
        if (now - p.timestamp > RETENTION_MS) continue;
        const key = identity(p);
        if (seen.has(key)) continue;
        seen.add(key);
        spots.push(trim(p));
        added++;
      }
    }
    if (added) spots.sort((a, b) => a.timestamp - b.timestamp);

    // Prune the ring: retention window first, then the hard cap.
    const cutoff = now - RETENTION_MS;
    let dropFrom = 0;
    while (dropFrom < spots.length && spots[dropFrom].timestamp <= cutoff) dropFrom++;
    const overflow = Math.max(0, spots.length - dropFrom - MAX_SPOTS);
    if (dropFrom + overflow > 0) {
      for (const s of spots.slice(0, dropFrom + overflow)) seen.delete(identity(s));
      spots = spots.slice(dropFrom + overflow);
    }
  }

  const sampleTimer = setInterval(sample, SAMPLE_MS);
  sampleTimer.unref?.();
  setTimeout(sample, 15 * 1000).unref?.(); // first sample soon after boot

  const saveTimer = setInterval(() => {
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(spots), 'utf8');
    } catch (err) {
      logWarn(`[History] Could not persist spot history: ${err.message}`);
    }
  }, SAVE_MS);
  saveTimer.unref?.();

  app.get('/api/history/meta', (req, res) => {
    res.json({
      count: spots.length,
      earliest: spots[0]?.timestamp ?? null,
      latest: spots[spots.length - 1]?.timestamp ?? null,
      retentionMs: RETENTION_MS,
    });
  });

  // GET /api/history/spots?from=<ms>&to=<ms> — spots inside [from, to),
  // stride-downsampled to RESPONSE_CAP for even coverage across the window.
  app.get('/api/history/spots', (req, res) => {
    const to = Math.min(parseInt(req.query.to, 10) || Date.now(), Date.now());
    const from = Math.max(parseInt(req.query.from, 10) || to - 15 * 60 * 1000, to - RETENTION_MS);
    if (!(from < to)) return res.status(400).json({ error: 'from must be before to' });

    // Binary search the ascending array for the window edges.
    const lowerBound = (t) => {
      let lo = 0;
      let hi = spots.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spots[mid].timestamp < t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const start = lowerBound(from);
    const end = lowerBound(to);
    const inWindow = spots.slice(start, end);

    let out = inWindow;
    let downsampled = false;
    if (inWindow.length > RESPONSE_CAP) {
      downsampled = true;
      out = [];
      const stride = inWindow.length / RESPONSE_CAP;
      for (let i = 0; i < RESPONSE_CAP; i++) out.push(inWindow[Math.floor(i * stride)]);
    }

    res.json({ from, to, total: inWindow.length, downsampled, spots: out });
  });

  return {};
};
