/**
 * Custom day/night terminator for Leaflet
 * Based on @joergdietrich/leaflet.terminator math, extended to span
 * multiple world copies (-540..540° longitude) so the gray line renders
 * correctly when users pan past the International Date Line.
 *
 * v1.1 — Graduated twilight bands for smooth day→night gradient.
 *
 * Removes CDN dependency on L.Terminator.js
 */

const PI = Math.PI;
const RAD = PI / 180;

/** Julian day number from Date */
function jday(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Greenwich Mean Sidereal Time (in radians) */
function gmst(date) {
  const jd = jday(date);
  const d = jd - 2451545.0;
  return ((280.46061837 + 360.98564736629 * d) % 360) * RAD;
}

/** Sun's ecliptic position */
function sunEclipticPosition(jd) {
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  return { lambda };
}

/** Ecliptic obliquity (radians) */
function eclipticObliquity(jd) {
  const n = jd - 2451545.0;
  return (23.439 - 0.0000004 * n) * RAD;
}

/** Sun's equatorial position (right ascension + declination) */
function sunEquatorialPosition(lambda, epsilon) {
  const alpha = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  return { alpha, delta };
}

/** Hour angle at a given longitude */
function hourAngle(gmstVal, sunPos, longitude) {
  return gmstVal + longitude * RAD - sunPos.alpha;
}

/** Compute terminator latitude for a given hour angle and sun declination */
function terminatorLat(ha, tanDelta) {
  if (Math.abs(tanDelta) < 1e-14) {
    return Math.cos(ha) > 0 ? -89.99 : 89.99;
  }
  return Math.atan(-Math.cos(ha) / tanDelta) / RAD;
}

/**
 * Compute solar constants for a given time
 */
function computeSolar(date) {
  const jd = jday(date);
  const eclPos = sunEclipticPosition(jd);
  const obliq = eclipticObliquity(jd);
  const sunPos = sunEquatorialPosition(eclPos.lambda, obliq);
  const gmstVal = gmst(date);
  return { sunPos, gmstVal, jd };
}

/**
 * Compute the terminator base line (array of [lat, lon] points)
 */
function computeTerminatorLine(solar, resolution) {
  const { sunPos, gmstVal } = solar;
  const ha0 = hourAngle(gmstVal, sunPos, -180);
  const absDeclDeg = Math.abs(sunPos.delta / RAD);
  const effectiveRes = absDeclDeg < 2 ? Math.min(resolution, 0.5) : resolution;
  const steps = Math.ceil(360 / effectiveRes);
  const tanDelta = Math.tan(sunPos.delta);
  const line = [];

  for (let i = 0; i <= steps; i++) {
    const lon = -180 + (i * 360) / steps;
    const ha = ha0 + ((i * 360) / steps) * RAD;
    const lat = terminatorLat(ha, tanDelta);
    line.push([lat, lon]);
  }

  return line;
}

/**
 * Offset a terminator line by a number of degrees toward the day side.
 * Positive offset = shift into the day side (making the dark area smaller).
 * The shift direction depends on which pole is in darkness.
 */
function offsetLine(baseLine, offsetDeg, nightPole) {
  // If south pole is dark (nightPole = -90), day side is north → shift lat UP (positive)
  // If north pole is dark (nightPole = 90), day side is south → shift lat DOWN (negative)
  const sign = nightPole < 0 ? 1 : -1;
  return baseLine.map(([lat, lon]) => {
    const shifted = lat + sign * offsetDeg;
    return [Math.max(-89.9, Math.min(89.9, shifted)), lon];
  });
}

/**
 * Build a closed polygon ring from a terminator line + night pole
 */
function lineToNightRings(line, nightPole) {
  const baseRing = [...line];
  baseRing.push([nightPole, 180]);
  baseRing.push([nightPole, -180]);

  const rings = [];
  for (const offset of [-360, 0, 360]) {
    rings.push(baseRing.map(([lat, lon]) => [lat, lon + offset]));
  }
  return rings;
}

/**
 * Build a band polygon between two terminator lines (same longitude points)
 */
function bandPolygonRings(outerLine, innerLine) {
  // Ring: outer line forward, inner line reversed
  const ring = [...outerLine, ...innerLine.slice().reverse()];
  const rings = [];
  for (const offset of [-360, 0, 360]) {
    rings.push(ring.map(([lat, lon]) => [lat, lon + offset]));
  }
  return rings;
}

/**
 * Compute the night polygon for a given time (legacy API)
 */
function computeNightPolygon(time, resolution) {
  const solar = computeSolar(time || new Date());
  const baseLine = computeTerminatorLine(solar, resolution);
  const nightPole = solar.sunPos.delta >= 0 ? -90 : 90;
  return lineToNightRings(baseLine, nightPole);
}

// Graduated twilight band definitions: each band extends N degrees into the day side
// from the terminator, with increasing fill opacity to create a visible soft edge.
// More bands + wider spread = smoother, more obvious gradient.
const TWILIGHT_BANDS = [
  { offset: 18, opacity: 0.03 }, // outermost — faintest hint
  { offset: 15, opacity: 0.06 },
  { offset: 12, opacity: 0.1 },
  { offset: 9, opacity: 0.15 },
  { offset: 6, opacity: 0.22 },
  { offset: 3, opacity: 0.3 }, // innermost — close to the night edge
];

/**
 * Create a Leaflet terminator layer with graduated twilight bands
 * Drop-in replacement for L.terminator()
 *
 * @param {Object} options - Leaflet polygon style options + resolution
 * @returns {L.LayerGroup} LayerGroup with setTime(), setStyle(), getElement(), bringToFront()
 */
export function createTerminator(options = {}) {
  const {
    resolution = 2,
    fillOpacity = 0.35,
    fillColor = '#000020',
    color = '#ffaa00',
    weight = 2,
    dashArray = '5, 5',
    time,
    wrap,
    ...otherOptions
  } = options;

  const group = L.layerGroup();
  group._terminatorResolution = resolution;
  group._fillOpacity = fillOpacity;
  group._fillColor = fillColor;
  group._nightPolygon = null;
  group._bandPolygons = [];

  function build(date) {
    const solar = computeSolar(date);
    const baseLine = computeTerminatorLine(solar, resolution);
    const nightPole = solar.sunPos.delta >= 0 ? -90 : 90;

    // Core night polygon (from terminator line to dark pole)
    const nightRings = lineToNightRings(baseLine, nightPole);

    // Graduated twilight bands (extending into the day side)
    const bands = [];
    let prevLine = baseLine;
    for (const band of TWILIGHT_BANDS) {
      const shifted = offsetLine(baseLine, band.offset, nightPole);
      const bandRings = bandPolygonRings(prevLine, shifted);
      bands.push({ rings: bandRings, opacity: band.opacity });
      prevLine = shifted;
    }

    return { nightRings, bands };
  }

  function render(date) {
    group.clearLayers();

    const { nightRings, bands } = build(date);
    const baseOp = group._fillOpacity;
    const fc = group._fillColor;

    // Render twilight bands first (outermost = lightest, bottom layer)
    // Reverse so outermost band is rendered first (underneath)
    const bandsCopy = [...bands].reverse();
    group._bandPolygons = [];
    for (const band of bandsCopy) {
      const poly = L.polygon(band.rings, {
        fillColor: fc,
        fillOpacity: band.opacity * (baseOp / 0.35), // scale proportionally to night darkness setting
        color: 'transparent',
        weight: 0,
        stroke: false,
        interactive: false,
        bubblingMouseEvents: false,
      });
      group.addLayer(poly);
      group._bandPolygons.push(poly);
    }

    // Render main night polygon on top
    group._nightPolygon = L.polygon(nightRings, {
      fillOpacity: baseOp,
      fillColor: fc,
      color: 'transparent',
      weight: 0,
      stroke: false,
      interactive: false,
      bubblingMouseEvents: false,
    });
    group.addLayer(group._nightPolygon);
  }

  // Initial render
  render(time || new Date());

  /**
   * Update the terminator to a new time
   */
  group.setTime = function (newTime) {
    render(newTime || new Date());
    // Re-apply CSS class to all sub-polygons after re-render
    group.eachLayer((layer) => {
      try {
        const el = layer.getElement?.();
        if (el) el.classList.add('terminator-path');
      } catch (e) {}
    });
  };

  /**
   * Update style — applies to all sub-layers
   */
  group.setStyle = function (style) {
    if (style.fillOpacity !== undefined) group._fillOpacity = style.fillOpacity;
    if (style.fillColor !== undefined) group._fillColor = style.fillColor;
    // Re-render with new style
    render(new Date());
  };

  /**
   * Get the SVG element of the main night polygon (for CSS class assignment)
   */
  group.getElement = function () {
    if (group._nightPolygon && typeof group._nightPolygon.getElement === 'function') {
      return group._nightPolygon.getElement();
    }
    return null;
  };

  /**
   * Bring all layers to front
   */
  group.bringToFront = function () {
    group.eachLayer((layer) => {
      if (typeof layer.bringToFront === 'function') {
        try {
          layer.bringToFront();
        } catch (e) {}
      }
    });
  };

  return group;
}

export default createTerminator;
