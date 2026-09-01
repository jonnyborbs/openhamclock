/**
 * Helpers for shaping /api/aprs/telemetry entries for display.
 *
 * A telemetry entry (per station) looks like:
 * {
 *   call, seq, values: [a1..a5], bits: '10110000', timestamp, source,
 *   params: ['Battery', 'Temp', ...],   // from PARM message (13 fields: 5 analog + 8 digital)
 *   units:  ['V', 'F', ...],            // from UNIT message
 *   computed: [12.4, 71.2, ...],        // values with EQNS coefficients applied (if defined)
 *   history: [{ seq, values, bits, timestamp, computed? }, ...]  // oldest → newest
 * }
 */

/** Build per-channel view models (label, unit, latest value, history series). */
export function buildChannels(entry) {
  if (!entry) return [];
  const params = entry.params || [];
  const units = entry.units || [];
  const latest = entry.computed || entry.values || [];
  const history = Array.isArray(entry.history) ? entry.history : [];
  return latest.map((value, i) => ({
    label: params[i] || `A${i + 1}`,
    unit: units[i] || '',
    value,
    series: history
      .map((h) => (h.computed || h.values || [])[i])
      .filter((v) => typeof v === 'number' && Number.isFinite(v)),
  }));
}

/** Digital bits with labels. PARM fields 6-13 name the 8 digital channels. */
export function buildBits(entry) {
  if (!entry || !entry.bits) return [];
  const params = entry.params || [];
  return entry.bits
    .split('')
    .slice(0, 8)
    .map((b, i) => ({
      label: params[5 + i] || `B${i + 1}`,
      on: b === '1',
    }));
}

/** Compact numeric formatting for channel values. */
export function formatTelemetryValue(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
}

/**
 * Points attribute for an inline SVG <polyline> sparkline.
 * Returns '' when there aren't at least two samples to draw a trend.
 */
export function sparklinePoints(series, width = 100, height = 28, pad = 2) {
  if (!Array.isArray(series) || series.length < 2) return '';
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const step = (width - pad * 2) / (series.length - 1);
  return series
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
