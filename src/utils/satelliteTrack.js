/**
 * Satellite orbit track computation.
 *
 * Extracted from useSatellites so the track-window logic is pure and testable,
 * and so every consumer renders from one source of truth: the flat-map layer
 * (useSatelliteLayer) and the 3D globe (Globe3D) both draw the `track` array
 * this module produces. The track is symmetric around "now" — `durationMins`
 * of past ground track and `durationMins` of predicted track — so consumers
 * that split at the midpoint (Globe3D's past/lead styling) keep working for
 * any duration.
 */
import * as satellite from 'satellite.js';

export const DEFAULT_TRACK_DURATION_MINS = 45; // each side of "now" (legacy hardcoded value)
export const MIN_TRACK_DURATION_MINS = 15;
export const MAX_TRACK_DURATION_MINS = 120;
export const TRACK_STEP_MINUTES = 1;

/**
 * Clamp a user-supplied track duration to the supported range.
 * Non-numeric input falls back to the default.
 * @param {*} mins requested duration in minutes (each side of "now")
 * @returns {number} duration in [MIN_TRACK_DURATION_MINS, MAX_TRACK_DURATION_MINS]
 */
export function clampTrackDuration(mins) {
  if (mins == null || mins === '') return DEFAULT_TRACK_DURATION_MINS; // Number(null) is 0, treat as unset
  const n = Number(mins);
  if (!Number.isFinite(n)) return DEFAULT_TRACK_DURATION_MINS;
  return Math.min(MAX_TRACK_DURATION_MINS, Math.max(MIN_TRACK_DURATION_MINS, n));
}

/**
 * Minute offsets of the track window, symmetric around 0 ("now").
 * @param {number} durationMins minutes each side of "now"
 * @param {number} stepMinutes sample spacing
 * @returns {number[]} e.g. [-45, -44, ..., 0, ..., 44, 45]
 */
export function trackWindowOffsets(durationMins, stepMinutes = TRACK_STEP_MINUTES) {
  const d = clampTrackDuration(durationMins);
  const offsets = [];
  for (let m = -d; m <= d; m += stepMinutes) {
    offsets.push(m);
  }
  return offsets;
}

/**
 * Compute the ground track for one satellite.
 * @param {object} satrec satellite.js record (from json2satrec/twoline2satrec)
 * @param {Date} now center time of the window
 * @param {number} durationMins minutes each side of "now"
 * @param {number} stepMinutes sample spacing
 * @returns {Array<[number, number]>} [lat, lon] pairs in degrees
 */
export function computeOrbitTrack(
  satrec,
  now,
  durationMins = DEFAULT_TRACK_DURATION_MINS,
  stepMinutes = TRACK_STEP_MINUTES,
) {
  const track = [];

  trackWindowOffsets(durationMins, stepMinutes).forEach((m) => {
    const trackTime = new Date(now.getTime() + m * 60 * 1000);
    const trackPV = satellite.propagate(satrec, trackTime);

    if (trackPV.position) {
      const trackGmst = satellite.gstime(trackTime);
      const trackGd = satellite.eciToGeodetic(trackPV.position, trackGmst);
      track.push([satellite.degreesLat(trackGd.latitude), satellite.degreesLong(trackGd.longitude)]);
    }
  });

  return track;
}
