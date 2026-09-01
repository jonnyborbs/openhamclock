/**
 * Sked Planner helpers — pure functions behind SkedPlannerPanel.
 *
 * The prediction data comes from the same pipeline that feeds the VOACAP
 * panel (usePropagation → browser WASM P.533 engine, REST/heuristic on the
 * fallback path): `hourlyPredictions` is { band: [{hour, reliability}, ×24] }
 * with `hour` in UTC. The engine computes ONE diurnal 24-hour cycle for the
 * current month — there is no true multi-day forecast — so the 48-hour view
 * tiles that cycle twice. That is honest for HF: P.533 predictions are
 * monthly-median and repeat diurnally; day 2 is "same conditions, tomorrow".
 */

/** Bands shown in the sked grid, low → high (matches the VOACAP chart). */
export const SKED_BANDS = ['80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];

export const SKED_HOURS = 48;

/**
 * Tile the engine's 24h diurnal cycle into 48 slots starting at `startHour`
 * (current UTC hour). Slot i covers UTC hour (startHour + i) % 24 on day
 * floor((startHour + i) / 24).
 *
 * @param {Object} hourlyPredictions  { band: [{hour, reliability}] }
 * @param {number} startHour          current UTC hour 0-23
 * @returns {Object} { band: [{offset, utcHour, day, reliability} ×48] }
 */
export function tile48(hourlyPredictions, startHour) {
  const out = {};
  if (!hourlyPredictions) return out;
  for (const band of Object.keys(hourlyPredictions)) {
    const byHour = new Map();
    for (const h of hourlyPredictions[band] || []) {
      if (h && Number.isFinite(h.hour)) byHour.set(h.hour, h.reliability ?? 0);
    }
    const slots = [];
    for (let i = 0; i < SKED_HOURS; i++) {
      const utcHour = (((startHour + i) % 24) + 24) % 24;
      slots.push({
        offset: i,
        utcHour,
        day: Math.floor((startHour + i) / 24),
        reliability: byHour.get(utcHour) ?? 0,
      });
    }
    out[band] = slots;
  }
  return out;
}

/**
 * Find the best contact windows in a tiled 48h grid.
 *
 * A window is a contiguous run of slots at or above a reliability threshold.
 * The threshold adapts downward on hard paths (70% of the global peak,
 * floored at 10) so marginal paths still show their least-bad windows instead
 * of nothing. At most one window per band (its best run), ranked by average
 * reliability with longer runs winning ties.
 *
 * Because day 2 repeats day 1's diurnal cycle, windows are searched in the
 * first 24 slots only — otherwise every "best" window would appear twice.
 *
 * @param {Object} tiled  output of tile48
 * @param {Object} [opts] { maxWindows=3, minRel=40 }
 * @returns {Array<{band, startOffset, endOffset, avgRel, peakRel, len}>}
 */
export function findBestWindows(tiled, { maxWindows = 3, minRel = 40 } = {}) {
  const bands = Object.keys(tiled || {});
  let globalPeak = 0;
  for (const band of bands) {
    for (const s of tiled[band].slice(0, 24)) globalPeak = Math.max(globalPeak, s.reliability);
  }
  if (globalPeak <= 0) return [];
  const threshold = Math.min(minRel, Math.max(10, Math.round(globalPeak * 0.7)));

  const perBandBest = [];
  for (const band of bands) {
    const slots = tiled[band].slice(0, 24);
    let best = null;
    let run = null;
    const flush = () => {
      if (!run) return;
      const avgRel = Math.round(run.sum / run.len);
      const win = { band, startOffset: run.start, endOffset: run.end, avgRel, peakRel: run.peak, len: run.len };
      if (!best || avgRel > best.avgRel || (avgRel === best.avgRel && win.len > best.len)) best = win;
      run = null;
    };
    for (const s of slots) {
      if (s.reliability >= threshold) {
        if (!run) run = { start: s.offset, end: s.offset, sum: 0, peak: 0, len: 0 };
        run.end = s.offset;
        run.sum += s.reliability;
        run.peak = Math.max(run.peak, s.reliability);
        run.len += 1;
      } else {
        flush();
      }
    }
    flush();
    if (best) perBandBest.push(best);
  }

  perBandBest.sort((a, b) => b.avgRel - a.avgRel || b.len - a.len);
  return perBandBest.slice(0, maxWindows);
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Human label for a window: "20m 02:00–05:00z (78%)".
 * End is exclusive (a 1-slot window at offset 0 spans a full hour).
 */
export function windowLabel(win, startHour) {
  const start = (((startHour + win.startOffset) % 24) + 24) % 24;
  const end = (((startHour + win.endOffset + 1) % 24) + 24) % 24;
  return `${win.band} ${pad2(start)}:00–${pad2(end)}:00z (${win.avgRel}%)`;
}

/**
 * Parse the "HH:MM" strings calculateSunTimes returns into a fractional UTC
 * hour. Non-time strings ('Polar night', 'Midnight sun', '') → null.
 */
export function parseSunHHMM(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hr = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  if (hr > 23 || mn > 59) return null;
  return hr + mn / 60;
}

/**
 * Local hour of day (0-23) at `utcMs` for an IANA timezone. Invalid/empty
 * timezones fall back to a solar approximation from longitude when given,
 * else the browser's zone.
 */
export function localHourAt(utcMs, timeZone, fallbackLon = null) {
  if (timeZone) {
    try {
      const s = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(new Date(utcMs));
      const h = parseInt(s, 10);
      if (Number.isFinite(h)) return h % 24;
    } catch {
      /* fall through */
    }
  }
  if (Number.isFinite(fallbackLon)) {
    const utcHour = new Date(utcMs).getUTCHours();
    return (((utcHour + Math.round(fallbackLon / 15)) % 24) + 24) % 24;
  }
  return new Date(utcMs).getHours();
}

export default {
  SKED_BANDS,
  SKED_HOURS,
  tile48,
  findBestWindows,
  windowLabel,
  parseSunHHMM,
  localHourAt,
};
