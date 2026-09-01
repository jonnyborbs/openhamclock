/**
 * Ionosonde helpers — pure functions behind IonosondePanel.
 *
 * Data comes from GET /api/ionosonde (server-side 10-min cache over
 * prop.kc2g.com's stations.json — GIRO digisonde measurements). Each station
 * carries foF2 (critical frequency, MHz) and MUF(3000) (max usable frequency
 * for a 3000 km hop, MHz) — the two numbers that tell you what YOUR local
 * ionosphere is doing right now, as opposed to a model's opinion.
 */
import { calculateDistance } from './geo.js';

/**
 * Sort stations by great-circle distance from DE, attaching `distanceKm`.
 * Stations without coordinates sort last.
 */
export function sortStationsByDistance(stations, de) {
  if (!Array.isArray(stations)) return [];
  const withDist = stations.map((s) => ({
    ...s,
    distanceKm:
      de && Number.isFinite(s?.lat) && Number.isFinite(s?.lon)
        ? calculateDistance(de.lat, de.lon, s.lat, s.lon)
        : Infinity,
  }));
  withDist.sort((a, b) => a.distanceKm - b.distanceKm);
  return withDist;
}

/** Minutes since the station's measurement time (ISO string). Null if unparseable. */
export function stationAgeMinutes(timeIso, nowMs = Date.now()) {
  const t = Date.parse(timeIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 60000));
}

/** "8m" / "1h 20m" style age label. */
export function formatAge(mins) {
  if (mins == null) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * NVIS usability hint from foF2. NVIS works at frequencies below foF2
 * (near-vertical waves at f > foF2 punch through the layer).
 *   foF2 ≥ 7 MHz  → 40m and 80m both reflect overhead
 *   foF2 ≥ 4.5    → 80m solid, 40m marginal
 *   foF2 ≥ 2.5    → 80m only
 *   below         → 160m territory
 * Returns a key the panel maps to a translated string.
 */
export function nvisHint(fof2) {
  if (!Number.isFinite(fof2)) return null;
  if (fof2 >= 7) return 'nvis40';
  if (fof2 >= 4.5) return 'nvis80strong';
  if (fof2 >= 2.5) return 'nvis80';
  return 'nvis160';
}

/** Highest amateur band whose frequency sits under MUF(3000). Null if unknown. */
export function mufBandHint(mufd) {
  if (!Number.isFinite(mufd)) return null;
  if (mufd >= 28) return '10m';
  if (mufd >= 24.9) return '12m';
  if (mufd >= 21) return '15m';
  if (mufd >= 18) return '17m';
  if (mufd >= 14) return '20m';
  if (mufd >= 10.1) return '30m';
  if (mufd >= 7) return '40m';
  if (mufd >= 3.5) return '80m';
  return '160m';
}

export default {
  sortStationsByDistance,
  stationAgeMinutes,
  formatAge,
  nvisHint,
  mufBandHint,
};
