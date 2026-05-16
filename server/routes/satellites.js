/**
 * Satellite TLE tracking routes.
 * Lines ~7624-8178 of original server.js
 */

const fs = require('fs');
const path = require('path');
const satellitesTracked = require('./satellites-tracked');

module.exports = function (app, ctx) {
  const { fetch, logDebug, logInfo, logWarn, logErrorOnce, APP_VERSION, ROOT_DIR } = ctx;

  // ============================================
  // SATELLITE TRACKING API
  // ============================================

  // Load satellite database from satellites.json (editable by contributors)
  // Falls back to hardcoded list if file not found
  function loadSatellitesJson() {
    const jsonPaths = [
      path.join(ROOT_DIR, 'public', 'data', 'satellites.json'),
      path.join(ROOT_DIR, 'data', 'satellites.json'),
    ];
    for (const p of jsonPaths) {
      try {
        if (fs.existsSync(p)) {
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (data.satellites && Object.keys(data.satellites).length > 0) {
            logInfo(`[Satellites] Loaded ${Object.keys(data.satellites).length} satellites from ${path.basename(p)}`);
            return data.satellites;
          }
        }
      } catch (e) {
        logWarn(`[Satellites] Failed to load ${p}: ${e.message}`);
      }
    }
    return null;
  }

  // Try JSON file first, fall back to hardcoded
  const jsonSatellites = loadSatellitesJson();

  // retrieve list of tracked satellites from separate file satellites-tracked.js
  const HAM_SATELLITES = satellitesTracked.HAM_SATELLITES;

  // Use satellites.json data if available, merging radio metadata into hardcoded entries
  // JSON file is the source of truth for radio data (downlink, uplink, tone, notes)
  // Hardcoded entries are the fallback for NORAD IDs and basic info
  if (jsonSatellites) {
    for (const [key, jsonSat] of Object.entries(jsonSatellites)) {
      if (HAM_SATELLITES[key]) {
        // Merge: JSON radio metadata into existing entry
        Object.assign(HAM_SATELLITES[key], {
          downlink: jsonSat.downlink || HAM_SATELLITES[key].downlink || '',
          uplink: jsonSat.uplink || HAM_SATELLITES[key].uplink || '',
          tone: jsonSat.tone || HAM_SATELLITES[key].tone || '',
          beacon: jsonSat.beacon || HAM_SATELLITES[key].beacon || '',
          notes: jsonSat.notes || HAM_SATELLITES[key].notes || '',
          // Allow JSON to override these too
          name: jsonSat.name || HAM_SATELLITES[key].name,
          mode: jsonSat.mode || HAM_SATELLITES[key].mode,
          color: jsonSat.color || HAM_SATELLITES[key].color,
          priority: jsonSat.priority ?? HAM_SATELLITES[key].priority,
          norad: jsonSat.norad || HAM_SATELLITES[key].norad,
        });
      } else {
        // New satellite only in JSON — add it
        HAM_SATELLITES[key] = jsonSat;
      }
    }
    logInfo(`[Satellites] Merged radio metadata — ${Object.keys(HAM_SATELLITES).length} satellites in registry`);
  }

  let tleCache = { data: null, timestamp: 0 };
  const TLE_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours — TLEs don't change that fast
  const TLE_STALE_SERVE_LIMIT = 48 * 60 * 60 * 1000; // Serve stale cache up to 48h while retrying
  let tleNegativeCache = 0; // Timestamp of last total failure
  const TLE_NEGATIVE_TTL = 30 * 60 * 1000; // 30 min backoff after all sources fail

  // TLE data sources in priority order — automatic failover
  const TLE_SOURCES = {
    celestrak: {
      name: 'CelesTrak',
      fetchGroups: async (groups, signal) => {
        const tleData = {};
        for (const group of groups) {
          try {
            const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, {
              headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
              signal,
            });
            if (res.ok) parseTleText(await res.text(), tleData, group);
            else if (res.status === 429 || res.status === 403)
              throw new Error(`CelesTrak returned ${res.status} (rate limited or banned)`);
          } catch (e) {
            if (e.message?.includes('rate limited') || e.message?.includes('banned')) throw e; // Bubble up to trigger failover
            logDebug(`[Satellites] CelesTrak group ${group} failed: ${e.message}`);
          }
        }
        return tleData;
      },
    },
    celestrak_legacy: {
      name: 'CelesTrak (legacy)',
      fetchGroups: async (groups, signal) => {
        const tleData = {};
        // Legacy domain uses different URL format
        const legacyMap = { amateur: 'amateur', weather: 'weather', goes: 'goes' };
        for (const group of groups) {
          try {
            const res = await fetch(`https://celestrak.com/NORAD/elements/${legacyMap[group] || group}.txt`, {
              headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
              signal,
            });
            if (res.ok) parseTleText(await res.text(), tleData, group);
          } catch (e) {
            logDebug(`[Satellites] CelesTrak legacy group ${group} failed: ${e.message}`);
          }
        }
        return tleData;
      },
    },
    amsat: {
      name: 'AMSAT',
      fetchGroups: async (_groups, signal) => {
        // AMSAT provides a single combined file for amateur satellites
        const tleData = {};
        try {
          const res = await fetch('https://www.amsat.org/tle/current/nasabare.txt', {
            headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
            signal,
          });
          if (res.ok) parseTleText(await res.text(), tleData, 'amateur');
        } catch (e) {
          logDebug(`[Satellites] AMSAT TLE failed: ${e.message}`);
        }
        return tleData;
      },
    },
  };

  // Configurable source order via env var: TLE_SOURCES=celestrak,amsat,celestrak_legacy
  const TLE_SOURCE_ORDER = (process.env.TLE_SOURCES || 'celestrak,celestrak_legacy,amsat')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => TLE_SOURCES[s]);

  function parseTleText(text, tleData, group) {
    // Build NORAD lookup set for fast matching
    const knownNorads = new Set(Object.values(HAM_SATELLITES).map((s) => s.norad));

    const lines = text.trim().split('\n');
    for (let i = 0; i < lines.length - 2; i += 3) {
      const name = lines[i]?.trim();
      const line1 = lines[i + 1]?.trim();
      const line2 = lines[i + 2]?.trim();
      if (name && line1 && line1.startsWith('1 ')) {
        const noradId = parseInt(line1.substring(2, 7));

        // Only include satellites we've curated in HAM_SATELLITES
        if (!knownNorads.has(noradId)) continue;

        const alreadyExists = Object.values(tleData).some((sat) => sat.norad === noradId);
        if (alreadyExists) continue;

        const hamSat = Object.values(HAM_SATELLITES).find((s) => s.norad === noradId);
        if (hamSat) {
          const key = name.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
          tleData[key] = { ...hamSat, tle1: line1, tle2: line2 };
        }
      }
    }
  }

  // Single in-flight refresh promise. Concurrent /tle requests share it instead of each
  // kicking off their own refresh — otherwise N parallel requests during a cold start fan
  // out to N parallel CelesTrak hammering attempts and almost guarantee throttling.
  let refreshInFlight = null;

  async function refreshTleCacheInternal() {
    const now = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const groups = ['amateur', 'weather', 'goes'];
    let tleData = {};
    let sourceUsed = null;

    for (const sourceKey of TLE_SOURCE_ORDER) {
      const source = TLE_SOURCES[sourceKey];
      try {
        tleData = await source.fetchGroups(groups, controller.signal);
        if (Object.keys(tleData).length >= 5) {
          sourceUsed = source.name;
          break;
        }
        logDebug(
          `[Satellites] ${source.name} returned only ${Object.keys(tleData).length} satellites, trying next source...`,
        );
      } catch (e) {
        logWarn(`[Satellites] ${source.name} failed: ${e.message}`);
      }
    }
    clearTimeout(timeout);

    // Per-NORAD fill for sats not in group files. CelesTrak rate-limits parallel CATNR
    // hammering by returning HTTP 200 with an empty body — keep parallelism low (2),
    // delay between batches, and DON'T retry on the hot path (retries dominate worst-case
    // latency and push the whole refresh past Cloudflare's 100s edge timeout). If
    // CelesTrak throttles a sat, we fall through to SatNOGS once and move on.
    const foundNorads = new Set(Object.values(tleData).map((s) => s.norad));
    const missingSats = Object.entries(HAM_SATELLITES).filter(([, s]) => !foundNorads.has(s.norad));
    if (missingSats.length > 0 && (Object.keys(tleData).length === 0 || missingSats.length <= 30)) {
      logDebug(
        `[Satellites] ${missingSats.length} sats missing from group files: ${missingSats.map(([k]) => k).join(', ')}`,
      );

      const PER_NORAD_BATCH_SIZE = 2;
      const PER_NORAD_BATCH_DELAY_MS = 400;

      for (let i = 0; i < missingSats.length; i += PER_NORAD_BATCH_SIZE) {
        const batch = missingSats.slice(i, i + PER_NORAD_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async ([key, sat]) => {
            try {
              const catRes = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.norad}&FORMAT=tle`, {
                headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
                signal: AbortSignal.timeout(4000),
              });
              if (catRes.ok) {
                const catText = await catRes.text();
                const catLines = catText.trim().split('\n');
                if (catLines.length >= 3 && catLines[1].trim().startsWith('1 ')) {
                  const tleKey = key.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
                  tleData[tleKey] = { ...sat, tle1: catLines[1].trim(), tle2: catLines[2].trim() };
                  logDebug(`[Satellites] Filled ${key} (NORAD ${sat.norad}) from CelesTrak CATNR`);
                  return key;
                }
                logDebug(`[Satellites] CelesTrak CATNR ${sat.norad} unexpected (${catLines.length} lines)`);
              }
            } catch (e) {
              logDebug(`[Satellites] CelesTrak CATNR ${sat.norad} failed: ${e.message}`);
            }

            try {
              const satnogsRes = await fetch(`https://db.satnogs.org/api/tle/?norad_cat_id=${sat.norad}&format=json`, {
                headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
                signal: AbortSignal.timeout(4000),
              });
              if (satnogsRes.ok) {
                const satnogsData = await satnogsRes.json();
                const entry = Array.isArray(satnogsData) ? satnogsData[0] : satnogsData;
                if (entry?.tle1 && entry?.tle2) {
                  const tleKey = key.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
                  tleData[tleKey] = { ...sat, tle1: entry.tle1.trim(), tle2: entry.tle2.trim() };
                  logDebug(`[Satellites] Filled ${key} (NORAD ${sat.norad}) from SatNOGS`);
                  return key;
                }
              }
            } catch (e) {
              logDebug(`[Satellites] SatNOGS ${sat.norad} failed: ${e.message}`);
            }

            logDebug(`[Satellites] Could not resolve TLE for ${key} (NORAD ${sat.norad}) from any source`);
            return null;
          }),
        );
        const filled = results.filter((r) => r.status === 'fulfilled' && r.value).map((r) => r.value);
        if (filled.length > 0) logDebug(`[Satellites] Batch filled: ${filled.join(', ')}`);
        if (i + PER_NORAD_BATCH_SIZE < missingSats.length)
          await new Promise((r) => setTimeout(r, PER_NORAD_BATCH_DELAY_MS));
      }
      logDebug(`[Satellites] After fill: ${Object.keys(tleData).length} total satellites resolved`);
    }

    // ISS fallback — try CelesTrak direct if ISS not found
    if (!Object.values(tleData).some((sat) => sat.norad === 25544)) {
      try {
        const issRes = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle', {
          signal: AbortSignal.timeout(4000),
        });
        if (issRes.ok) {
          const issLines = (await issRes.text()).trim().split('\n');
          if (issLines.length >= 3) {
            tleData['ISS'] = { ...HAM_SATELLITES['ISS'], tle1: issLines[1].trim(), tle2: issLines[2].trim() };
          }
        }
      } catch (e) {
        logDebug('[Satellites] ISS fallback failed');
      }
    }

    if (Object.keys(tleData).length > 0) {
      // Refuse to overwrite a healthier cache with a materially worse one — prevents one
      // bad refresh from stranding clients for 12h.
      const prevCount = tleCache.data ? Object.keys(tleCache.data).length : 0;
      const stillMissing = Object.entries(HAM_SATELLITES).filter(
        ([, s]) => !Object.values(tleData).some((t) => t.norad === s.norad),
      ).length;
      if (
        stillMissing >= 5 &&
        prevCount > Object.keys(tleData).length &&
        now - tleCache.timestamp < TLE_STALE_SERVE_LIMIT
      ) {
        logWarn(
          `[Satellites] Refresh degraded (got ${Object.keys(tleData).length}, prev had ${prevCount}); keeping previous cache`,
        );
        tleNegativeCache = now;
        return tleCache.data;
      }
      tleCache = { data: tleData, timestamp: now };
      if (sourceUsed) logInfo(`[Satellites] Loaded ${Object.keys(tleData).length} satellites from ${sourceUsed}`);
      return tleData;
    }

    // All sources failed
    tleNegativeCache = now;
    logWarn('[Satellites] All TLE sources failed, backing off for 30 min');
    return tleCache.data || {};
  }

  function refreshTleCache() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = refreshTleCacheInternal()
      .catch((e) => {
        logWarn(`[Satellites] Refresh threw: ${e.message}`);
        return tleCache.data || {};
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  }

  app.get('/api/satellites/tle', async (req, res) => {
    // Don't let CDN pin an empty payload — when all sources fail we want the next request
    // after backoff to hit the origin, not the edge cache.
    const sendTle = (payload, stale) => {
      if (!payload || Object.keys(payload).length === 0) {
        res.set('Cache-Control', 'no-store');
      }
      if (stale) res.set('X-TLE-Stale', 'true');
      return res.json(payload);
    };

    const now = Date.now();

    // Fresh cache hit
    if (tleCache.data && now - tleCache.timestamp < TLE_CACHE_DURATION) {
      return res.json(tleCache.data);
    }

    // Recent total failure — don't retry yet
    if (now - tleNegativeCache < TLE_NEGATIVE_TTL) {
      if (tleCache.data && now - tleCache.timestamp < TLE_STALE_SERVE_LIMIT) {
        return sendTle(tleCache.data, true);
      }
      return sendTle(tleCache.data || {});
    }

    // Stale-while-revalidate: if we have any cached data, serve it immediately and refresh
    // in the background. Only block when there is truly nothing to return — otherwise a
    // slow upstream refresh (potentially >100s) will trip Cloudflare's edge timeout.
    if (tleCache.data && Object.keys(tleCache.data).length > 0) {
      refreshTleCache(); // fire and forget
      return sendTle(tleCache.data, true);
    }

    // Cold start — must wait. The dedup in refreshTleCache ensures concurrent requests
    // share one upstream refresh.
    try {
      const data = await refreshTleCache();
      sendTle(data || {});
    } catch (e) {
      sendTle(tleCache.data || {});
    }
  });

  // Satellite debug endpoint — shows which sats resolved and which are missing
  app.get('/api/satellites/debug', (req, res) => {
    const cached = tleCache.data || {};
    const resolvedNorads = new Set(Object.values(cached).map((s) => s.norad));
    const all = Object.entries(HAM_SATELLITES).map(([key, sat]) => ({
      key,
      norad: sat.norad,
      name: sat.name,
      resolved: resolvedNorads.has(sat.norad),
      tleKey: Object.keys(cached).find((k) => cached[k].norad === sat.norad) || null,
    }));
    res.json({
      cacheAge: tleCache.timestamp ? `${Math.round((Date.now() - tleCache.timestamp) / 1000)}s ago` : 'empty',
      totalInRegistry: Object.keys(HAM_SATELLITES).length,
      totalResolved: Object.keys(cached).length,
      totalMissing: all.filter((s) => !s.resolved).length,
      missing: all.filter((s) => !s.resolved),
      resolved: all.filter((s) => s.resolved),
    });
  });
};
