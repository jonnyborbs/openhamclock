/**
 * Meteor shower data + radiant geometry for meteor-scatter (MSK144) operators.
 *
 * Embeds the IMO working list of major annual showers with approximate
 * activity windows, peak dates, ZHR, radiant RA/Dec (at peak) and entry speed.
 * Peak dates drift slightly year to year; the standard approximate dates are
 * used and "days until peak" is computed against the current year, wrapping to
 * next year once a peak has passed.
 *
 * Radiant alt/az uses the same sub-point construction as getMoonAzEl in
 * geo.js: the point where the radiant is at zenith has lat = Dec and
 * lon = RA − GMST; for an effectively infinitely distant radiant the
 * elevation is simply 90° minus the great-circle angular distance to that
 * sub-point, and the azimuth is the initial bearing toward it.
 */
import { calculateBearing, calculateDistance } from './geo.js';

const EARTH_RADIUS_KM = 6371;

// IMO working list — major annual showers.
// months are 1-based; RA/Dec in degrees (radiant position at peak); speed km/s.
export const METEOR_SHOWERS = [
  {
    code: 'QUA',
    name: 'Quadrantids',
    start: [12, 28],
    end: [1, 12],
    peak: [1, 3],
    zhr: 110,
    ra: 230,
    dec: 49,
    speed: 41,
  },
  { code: 'LYR', name: 'Lyrids', start: [4, 14], end: [4, 30], peak: [4, 22], zhr: 18, ra: 271, dec: 34, speed: 49 },
  {
    code: 'ETA',
    name: 'Eta Aquariids',
    start: [4, 19],
    end: [5, 28],
    peak: [5, 6],
    zhr: 50,
    ra: 338,
    dec: -1,
    speed: 66,
  },
  {
    code: 'ARI',
    name: 'Daytime Arietids',
    start: [5, 14],
    end: [6, 24],
    peak: [6, 7],
    zhr: 30,
    ra: 44,
    dec: 24,
    speed: 38,
  },
  {
    code: 'JBO',
    name: 'June Bootids',
    start: [6, 22],
    end: [7, 2],
    peak: [6, 27],
    zhr: 5,
    ra: 224,
    dec: 48,
    speed: 18,
    variable: true,
  },
  {
    code: 'SDA',
    name: 'S. Delta Aquariids',
    start: [7, 12],
    end: [8, 23],
    peak: [7, 30],
    zhr: 25,
    ra: 340,
    dec: -16,
    speed: 41,
  },
  { code: 'PER', name: 'Perseids', start: [7, 17], end: [8, 24], peak: [8, 12], zhr: 100, ra: 48, dec: 58, speed: 59 },
  {
    code: 'DRA',
    name: 'Draconids',
    start: [10, 6],
    end: [10, 10],
    peak: [10, 8],
    zhr: 10,
    ra: 262,
    dec: 54,
    speed: 20,
    variable: true,
  },
  { code: 'ORI', name: 'Orionids', start: [10, 2], end: [11, 7], peak: [10, 21], zhr: 20, ra: 95, dec: 16, speed: 66 },
  { code: 'STA', name: 'S. Taurids', start: [9, 10], end: [11, 20], peak: [11, 5], zhr: 5, ra: 52, dec: 13, speed: 27 },
  {
    code: 'NTA',
    name: 'N. Taurids',
    start: [10, 20],
    end: [12, 10],
    peak: [11, 12],
    zhr: 5,
    ra: 58,
    dec: 22,
    speed: 29,
  },
  { code: 'LEO', name: 'Leonids', start: [11, 6], end: [11, 30], peak: [11, 17], zhr: 15, ra: 152, dec: 22, speed: 71 },
  {
    code: 'GEM',
    name: 'Geminids',
    start: [12, 4],
    end: [12, 20],
    peak: [12, 14],
    zhr: 150,
    ra: 112,
    dec: 33,
    speed: 34,
  },
  { code: 'URS', name: 'Ursids', start: [12, 17], end: [12, 26], peak: [12, 22], zhr: 10, ra: 217, dec: 76, speed: 33 },
];

/** UTC Date for a [month, day] in a given year (noon UTC to dodge TZ edges) */
const dateFor = (year, [month, day]) => new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

/**
 * Next peak Date for a shower relative to `now` — this year's peak, or next
 * year's once this year's has passed (by more than a day, so "peaking now"
 * still reads correctly on the day after the nominal peak).
 */
export function nextPeakDate(shower, now = new Date()) {
  const y = now.getUTCFullYear();
  let peak = dateFor(y, shower.peak);
  if (peak.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    peak = dateFor(y + 1, shower.peak);
  }
  return peak;
}

/** Signed days from now until the next peak (negative → just past peak) */
export function daysToPeak(shower, now = new Date()) {
  return (nextPeakDate(shower, now).getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
}

/** True while `now` falls inside the shower's activity window (handles the year wrap) */
export function isActive(shower, now = new Date()) {
  const y = now.getUTCFullYear();
  const wraps = shower.start[0] > shower.end[0]; // e.g. Quadrantids Dec 28 → Jan 12
  if (!wraps) {
    return now >= dateFor(y, shower.start) && now <= dateFor(y, shower.end);
  }
  return now >= dateFor(y, shower.start) || now <= dateFor(y, shower.end);
}

/** Greenwich Mean Sidereal Time in degrees (same series as geo.js getMoonPosition) */
export function gmstDegrees(date) {
  const JD = date.getTime() / 86400000 + 2440587.5;
  const gmst = (280.46061837 + 360.98564736629 * (JD - 2451545.0)) % 360;
  return (gmst + 360) % 360;
}

/**
 * Topocentric altitude/azimuth of a shower radiant.
 * Sub-radiant point: lat = Dec, lon = RA − GMST (normalized to ±180).
 * For an infinitely distant point, elevation = 90° − angular distance.
 *
 * @returns {{elevation: number, azimuth: number}} degrees; azimuth 0–360 from true north
 */
export function radiantAltAz(shower, date, lat, lon) {
  const subLat = shower.dec;
  const subLon = ((((shower.ra - gmstDegrees(date)) % 360) + 540) % 360) - 180;
  const dDeg = (calculateDistance(lat, lon, subLat, subLon) / EARTH_RADIUS_KM) * (180 / Math.PI);
  return {
    elevation: 90 - dDeg,
    azimuth: calculateBearing(lat, lon, subLat, subLon),
  };
}

/**
 * Full per-shower status list, sorted by proximity to peak (peaking/nearest
 * first). Each entry: { ...shower, active, peaking, daysToPeak, peakDate,
 * elevation, azimuth }.
 */
export function getShowerStatus(now = new Date(), lat = null, lon = null) {
  return METEOR_SHOWERS.map((shower) => {
    const dtp = daysToPeak(shower, now);
    const active = isActive(shower, now);
    const altAz =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? radiantAltAz(shower, now, lat, lon)
        : { elevation: null, azimuth: null };
    return {
      ...shower,
      active,
      peaking: active && Math.abs(dtp) <= 1,
      daysToPeak: dtp,
      peakDate: nextPeakDate(shower, now),
      elevation: altAz.elevation,
      azimuth: altAz.azimuth,
    };
  }).sort((a, b) => Math.abs(a.daysToPeak) - Math.abs(b.daysToPeak));
}

export default { METEOR_SHOWERS, nextPeakDate, daysToPeak, isActive, gmstDegrees, radiantAltAz, getShowerStatus };
