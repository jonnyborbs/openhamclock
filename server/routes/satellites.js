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

  app.get('/api/satellites/tle', async (req, res) => {
    // Don't let Fastly/CDN pin an empty payload — when all sources fail we want
    // the next request after backoff to hit the origin, not the edge cache.
    const sendTle = (payload) => {
      if (!payload || Object.keys(payload).length === 0) {
        res.set('Cache-Control', 'no-store');
      }
      return res.json(payload);
    };

    try {
      const now = Date.now();

      // Return memory cache if fresh
      if (tleCache.data && now - tleCache.timestamp < TLE_CACHE_DURATION) {
        return res.json(tleCache.data);
      }

      // If all sources recently failed, serve stale cache or empty
      if (now - tleNegativeCache < TLE_NEGATIVE_TTL) {
        if (tleCache.data && now - tleCache.timestamp < TLE_STALE_SERVE_LIMIT) {
          res.set('X-TLE-Stale', 'true');
          return res.json(tleCache.data);
        }
        return sendTle(tleCache.data || {});
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const groups = ['amateur', 'weather', 'goes'];
      let tleData = {};
      let sourceUsed = null;

      // Try each source in order until one succeeds with meaningful data
      for (const sourceKey of TLE_SOURCE_ORDER) {
        const source = TLE_SOURCES[sourceKey];
        try {
          tleData = await source.fetchGroups(groups, controller.signal);
          if (Object.keys(tleData).length >= 5) {
            sourceUsed = source.name;
            break; // Got enough data
          }
          logDebug(
            `[Satellites] ${source.name} returned only ${Object.keys(tleData).length} satellites, trying next source...`,
          );
        } catch (e) {
          logWarn(`[Satellites] ${source.name} failed: ${e.message}`);
        }
      }

      clearTimeout(timeout);

      // Fill missing satellites — CelesTrak group files don't include every ham sat.
      // Fetch individual TLEs by NORAD catalog number for any HAM_SATELLITES not yet resolved.
      // Tries CelesTrak CATNR first, then SatNOGS API as fallback.
      const foundNorads = new Set(Object.values(tleData).map((s) => s.norad));
      const missingSats = Object.entries(HAM_SATELLITES).filter(([, s]) => !foundNorads.has(s.norad));
      // Run the per-NORAD fallback when group fetches returned nothing (banned IP / rate-limited)
      // OR when only a handful are missing. The <= 30 cap protects against hammering when most
      // satellites are already resolved; when group fetches gave us zero, hammering is the goal.
      if (missingSats.length > 0 && (Object.keys(tleData).length === 0 || missingSats.length <= 30)) {
        logDebug(
          `[Satellites] ${missingSats.length} sats missing from group files: ${missingSats.map(([k]) => k).join(', ')}`,
        );
        // Fetch in batches of 5 to avoid hammering upstream
        for (let i = 0; i < missingSats.length; i += 5) {
          const batch = missingSats.slice(i, i + 5);
          const results = await Promise.allSettled(
            batch.map(async ([key, sat]) => {
              // Try CelesTrak individual CATNR lookup first
              try {
                const catRes = await fetch(
                  `https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.norad}&FORMAT=tle`,
                  {
                    headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
                    signal: AbortSignal.timeout(5000),
                  },
                );
                if (catRes.ok) {
                  const catText = await catRes.text();
                  const catLines = catText.trim().split('\n');
                  if (catLines.length >= 3 && catLines[1].trim().startsWith('1 ')) {
                    const tleKey = key.replace(/[^A-Z0-9\-]/g, '_').toUpperCase();
                    tleData[tleKey] = { ...sat, tle1: catLines[1].trim(), tle2: catLines[2].trim() };
                    logDebug(`[Satellites] Filled ${key} (NORAD ${sat.norad}) from CelesTrak CATNR`);
                    return key;
                  }
                  logDebug(
                    `[Satellites] CelesTrak CATNR ${sat.norad} returned unexpected format: ${catLines.length} lines`,
                  );
                }
              } catch (e) {
                logDebug(`[Satellites] CelesTrak CATNR ${sat.norad} failed: ${e.message}`);
              }

              // Fallback: SatNOGS TLE API
              try {
                const satnogsRes = await fetch(
                  `https://db.satnogs.org/api/tle/?norad_cat_id=${sat.norad}&format=json`,
                  {
                    headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
                    signal: AbortSignal.timeout(5000),
                  },
                );
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
          // Small delay between batches to be polite
          if (i + 5 < missingSats.length) await new Promise((r) => setTimeout(r, 300));
        }
        logDebug(`[Satellites] After fill: ${Object.keys(tleData).length} total satellites resolved`);
      }

      // ISS fallback — try CelesTrak direct if ISS not found
      const issExists = Object.values(tleData).some((sat) => sat.norad === 25544);
      if (!issExists) {
        try {
          const issRes = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle', {
            signal: AbortSignal.timeout(5000),
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
        tleCache = { data: tleData, timestamp: now };
        if (sourceUsed) logInfo(`[Satellites] Loaded ${Object.keys(tleData).length} satellites from ${sourceUsed}`);
      } else {
        // All sources failed — set negative cache to avoid hammering
        tleNegativeCache = now;
        logWarn('[Satellites] All TLE sources failed, backing off for 30 min');
        // Serve stale if available
        if (tleCache.data && now - tleCache.timestamp < TLE_STALE_SERVE_LIMIT) {
          res.set('X-TLE-Stale', 'true');
          return res.json(tleCache.data);
        }
      }

      sendTle(tleData);
    } catch (error) {
      // Return stale cache or empty if everything fails
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
