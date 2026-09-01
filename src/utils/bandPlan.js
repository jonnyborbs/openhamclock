import bandPlan from './bandplan.json';

/**
 * Band Plan Utilities
 * Determines default mode based on frequency using bandplan.json
 */

/**
 * Get recommended mode from frequency (Hz)
 * @param {number} hz - Frequency in Hz
 * @returns {string} - 'LSB', 'USB', 'CW', 'FM', 'AM'
 */
export const getModeFromFreq = (hz) => {
  if (!hz) return 'USB'; // Default safe fallback

  const khz = hz / 1000;
  const mhz = hz / 1000000;

  // Check specific ranges from JSON
  for (const range of bandPlan) {
    if (khz >= range.min && khz <= range.max) {
      return range.mode;
    }
  }

  // Generic Rules if outside specific ham bands
  // < 10 MHz -> LSB
  // >= 10 MHz -> USB
  if (mhz < 10) return 'LSB';
  return 'USB';
};

/**
 * Get the base sideband (USB/LSB) for a given frequency
 * @param {number} hz - Frequency in Hz
 * @returns {string} - 'USB' or 'LSB'
 */
export const getSideband = (hz) => {
  if (!hz) return 'USB';
  const mhz = hz / 1000000;

  // Check for 60m exception (always USB)
  if (mhz >= 5.3 && mhz <= 5.405) return 'USB';

  // Standard rule: < 10MHz is LSB, >= 10MHz is USB
  return mhz < 10 ? 'LSB' : 'USB';
};

/**
 * Map a generic mode (e.g. 'FT8', 'DATA', 'SSB') to a rig-specific mode
 * (e.g. 'DATA-USB', 'USB') based on frequency conventions.
 *
 * CW is passed through unchanged — the rig-listener protocol layer (Yaesu MD03;,
 * Kenwood MD3;, Icom 0x03) handles it correctly for all supported radios.
 *
 * @param {string} mode - The mode string (e.g. 'FT8', 'CW', 'SSB', 'DATA')
 * @param {number} freq - The frequency in Hz
 * @returns {string} - The mapped mode string
 */
export const mapModeToRig = (mode, freq) => {
  if (!mode) return '';
  const m = mode.toUpperCase();
  const sb = getSideband(freq);

  // CW: pass through as-is — rig-listener translates to MD03; (Yaesu),
  // MD3; (Kenwood/Elecraft), or CI-V 0x03 (Icom) for all supported radios.
  if (m === 'CW' || m === 'CW-R') return m;

  // FM and AM: always pass through unchanged
  if (m === 'FM' || m === 'AM' || m === 'WFM') return m;

  // Already a fully-qualified mode: USB, LSB, DATA-USB, DATA-LSB, etc.
  if (m === 'USB' || m === 'LSB') return m;
  if (m === 'DATA-USB' || m === 'DATA-LSB') return m;

  // Digital/data modes → DATA-USB or DATA-LSB based on band convention
  const digitalModes = ['DATA', 'FT8', 'FT4', 'FT2', 'JS8', 'WSPR', 'JT65', 'JT9', 'PSK31', 'PSK63', 'RTTY', 'PKT'];
  if (digitalModes.includes(m)) {
    return sb === 'USB' ? 'DATA-USB' : 'DATA-LSB';
  }

  // Generic SSB → resolved sideband
  if (m === 'SSB') return sb;

  // Unknown modes: pass through so the rig can decide
  return m;
};

// ── Band plan display helpers (BandPlanBar) ─────────────────────────────────

/**
 * Group the flat bandplan.json ranges into contiguous amateur bands.
 * Built once at module load. Each band: { name, min, max, segments } (kHz).
 * The band name is derived from the first segment's desc ("160m CW" → "160m").
 */
const buildBands = () => {
  const sorted = [...bandPlan].sort((a, b) => a.min - b.min);
  const bands = [];
  for (const seg of sorted) {
    const cur = bands[bands.length - 1];
    if (cur && seg.min <= cur.max) {
      // Contiguous with (or overlapping) the current band — extend it
      cur.max = Math.max(cur.max, seg.max);
      cur.segments.push(seg);
    } else {
      bands.push({
        name: (seg.desc || '').split(' ')[0] || '',
        min: seg.min,
        max: seg.max,
        segments: [seg],
      });
    }
  }
  return bands;
};

const BANDS = buildBands();

/**
 * Find the amateur band containing a frequency.
 * @param {number} hz - Frequency in Hz
 * @returns {{name: string, min: number, max: number, segments: Array}|null}
 *          Band with min/max in kHz, or null when out of any known band.
 */
export const getBandForFreq = (hz) => {
  if (!hz || !Number.isFinite(hz)) return null;
  const khz = hz / 1000;
  return BANDS.find((b) => khz >= b.min && khz <= b.max) || null;
};

/**
 * Position of a frequency within a band, as a percentage (0–100).
 * @param {number} hz - Frequency in Hz
 * @param {{min: number, max: number}} band - Band from getBandForFreq (kHz)
 * @returns {number|null} - Clamped 0–100, or null when inputs are invalid
 */
export const getMarkerPosition = (hz, band) => {
  if (!hz || !band || band.max <= band.min) return null;
  const khz = hz / 1000;
  const pct = ((khz - band.min) / (band.max - band.min)) * 100;
  return Math.max(0, Math.min(100, pct));
};

/**
 * Map a bandplan.json mode to a display class for segment coloring.
 * @param {string} mode - 'CW', 'DATA', 'USB', 'LSB', 'FM', 'AM'
 * @returns {string} - 'cw' | 'data' | 'phone' | 'fm'
 */
export const getSegmentClass = (mode) => {
  switch ((mode || '').toUpperCase()) {
    case 'CW':
      return 'cw';
    case 'DATA':
      return 'data';
    case 'FM':
      return 'fm';
    default:
      // USB / LSB / AM and anything else voice-shaped
      return 'phone';
  }
};
