/**
 * logStats — pure logbook analytics for the Log Stats panel.
 *
 * Everything here is computed from the QSO records kept by
 * src/services/logbookStore.js (ADIF-aligned lowercase keys:
 * qso_date 'YYYYMMDD', time_on 'HHMMSS', call, band, mode, gridsquare,
 * my_gridsquare, ...). No React, no I/O — the panel calls computeLogStats
 * on every store notification and renders the result.
 *
 * Distances reuse the existing geo utils: QSO grid → lat/lon via
 * maidenheadToLatLon, from the QSO's my_gridsquare when present, else the
 * configured DE location. QSOs without a valid grid are skipped for the
 * best-DX pick but still count everywhere else.
 */
import { calculateDistance, maidenheadToLatLon, validateGridLocator } from './geo.js';

/** 'YYYYMMDD' → 'YYYY-MM-DD', or null when malformed. */
export const qsoDayKey = (qso) => {
  const d = String(qso?.qso_date || '').trim();
  if (!/^\d{8}$/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};

/** Normalized grid (uppercase) if valid, else null. */
const validGrid = (raw) => {
  const g = String(raw || '')
    .trim()
    .toUpperCase();
  return g && validateGridLocator(g) ? g : null;
};

/** Tally a field into [{ key, count }], sorted by count desc then key. */
export const tallyBy = (qsos, field) => {
  const counts = new Map();
  for (const q of qsos) {
    const raw = String(q?.[field] || '').trim();
    if (!raw) continue;
    const key = field === 'band' ? raw.toLowerCase() : raw.toUpperCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

/** Map of 'YYYY-MM-DD' → QSO count (invalid dates skipped). */
export const qsosPerDay = (qsos) => {
  const counts = new Map();
  for (const q of qsos) {
    const day = qsoDayKey(q);
    if (!day) continue;
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return counts;
};

const dayKeyOf = (date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * GitHub-contribution-style grid for the trailing 12 months.
 *
 * Returns { weeks, maxCount, monthLabels } where weeks is an array of
 * columns, each a 7-element array of { date: 'YYYY-MM-DD', count } rows
 * (row 0 = Sunday), covering from the Sunday on/before (now − 364 days)
 * through today; days after `now` are null. monthLabels are
 * { weekIndex, label } for the first week of each new month.
 */
export const buildHeatmap = (counts, now = new Date()) => {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back to Sunday

  const weeks = [];
  const monthLabels = [];
  let maxCount = 0;
  let lastMonth = -1;

  const cursor = new Date(start);
  while (cursor <= today) {
    const week = [];
    for (let dow = 0; dow < 7; dow++) {
      if (cursor > today) {
        week.push(null);
      } else {
        const key = dayKeyOf(cursor);
        const count = counts.get(key) || 0;
        if (count > maxCount) maxCount = count;
        week.push({ date: key, count });
        if (dow === 0) {
          const month = cursor.getUTCMonth();
          if (month !== lastMonth) {
            monthLabels.push({
              weekIndex: weeks.length,
              label: cursor.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
            });
            lastMonth = month;
          }
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  return { weeks, maxCount, monthLabels };
};

/**
 * Best (farthest) DX in the log.
 *
 * From-point: the QSO's own my_gridsquare when valid, else the DE
 * location's lat/lon when finite. To-point: the QSO's gridsquare. QSOs
 * missing either end are skipped.
 *
 * @returns {{ call, km, grid, date }|null}
 */
export const bestDx = (qsos, deLocation) => {
  const hasDE = Number.isFinite(deLocation?.lat) && Number.isFinite(deLocation?.lon);
  let best = null;
  for (const q of qsos) {
    const toGrid = validGrid(q?.gridsquare);
    if (!toGrid) continue;
    const to = maidenheadToLatLon(toGrid);
    if (!to) continue;

    const myGrid = validGrid(q?.my_gridsquare);
    const from = myGrid ? maidenheadToLatLon(myGrid) : hasDE ? { lat: deLocation.lat, lon: deLocation.lon } : null;
    if (!from) continue;

    const km = calculateDistance(from.lat, from.lon, to.lat, to.lon);
    if (!best || km > best.km) {
      best = { call: String(q?.call || '').toUpperCase(), km, grid: toGrid, date: qsoDayKey(q) };
    }
  }
  return best;
};

/** Chronological sort key: qso_date + time_on, missing parts padded. */
const chronoKey = (q) => `${String(q?.qso_date || '').padEnd(8, '0')}${String(q?.time_on || '').padEnd(6, '0')}`;

/**
 * All headline stats in one pass.
 *
 * @param {Array<object>} qsos
 * @param {{lat?:number, lon?:number}|null} deLocation
 * @param {Date} [now] injectable for tests
 */
export const computeLogStats = (qsos, deLocation = null, now = new Date()) => {
  const valid = Array.isArray(qsos) ? qsos : [];

  const uniqueCalls = new Set();
  const uniqueGrids = new Set(); // 4-char squares, the usual "grids" unit
  for (const q of valid) {
    const call = String(q?.call || '')
      .trim()
      .toUpperCase();
    if (call) uniqueCalls.add(call);
    const grid = validGrid(q?.gridsquare);
    if (grid) uniqueGrids.add(grid.slice(0, 4));
  }

  const perDay = qsosPerDay(valid);
  let busiestDay = null;
  for (const [date, count] of perDay) {
    if (!busiestDay || count > busiestDay.count) busiestDay = { date, count };
  }

  const dated = valid.filter((q) => qsoDayKey(q));
  let first = null;
  let latest = null;
  for (const q of dated) {
    if (!first || chronoKey(q) < chronoKey(first)) first = q;
    if (!latest || chronoKey(q) > chronoKey(latest)) latest = q;
  }

  return {
    total: valid.length,
    uniqueCalls: uniqueCalls.size,
    uniqueGrids: uniqueGrids.size,
    firstQsoDate: first ? qsoDayKey(first) : null,
    latestQsoDate: latest ? qsoDayKey(latest) : null,
    busiestDay,
    bands: tallyBy(valid, 'band'),
    modes: tallyBy(valid, 'mode'),
    bestDx: bestDx(valid, deLocation),
    heatmap: buildHeatmap(perDay, now),
  };
};

export default { qsoDayKey, tallyBy, qsosPerDay, buildHeatmap, bestDx, computeLogStats };
