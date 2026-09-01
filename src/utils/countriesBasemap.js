/**
 * countriesBasemap — shared bits of the "Countries" map style (#1166).
 *
 * The 2D map renders this style as Esri's transparent boundary/label tiles
 * over a Leaflet GeoJSON layer that fills every country with a stable hashed
 * color. The 3D globe bakes its basemap from tiles only, so without this
 * module it showed just the light-blue base with faint boundaries. The globe
 * texture builder now paints the same filled countries onto its Mercator
 * mosaic (beneath the boundary tiles), using the same palette and hash so
 * both projections agree.
 */

export const COUNTRIES_GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json';

/** Bright distinct fills, tuned for contrast between neighbors. */
export const COUNTRY_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9A6324',
  '#800000',
  '#aaffc3',
  '#808000',
  '#000075',
  '#e6beff',
  '#ff6961',
  '#77dd77',
  '#fdfd96',
  '#84b6f4',
  '#fdcae1',
  '#c1e1c1',
  '#b39eb5',
  '#ffb347',
];

/** Stable hash → palette pick, so a country keeps its color everywhere. */
export function countryColor(name) {
  const str = String(name || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return COUNTRY_COLORS[Math.abs(hash) % COUNTRY_COLORS.length];
}

// One fetch per session — the file is static (~240 KB, Natural Earth 110m).
let geojsonPromise = null;

/** Cached countries GeoJSON; a failed fetch clears the cache so retries work. */
export function fetchCountriesGeojson() {
  if (!geojsonPromise) {
    geojsonPromise = fetch(COUNTRIES_GEOJSON_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        geojsonPromise = null;
        throw err;
      });
  }
  return geojsonPromise;
}

const MAX_MERC_LAT = 85.0511287798;

/**
 * Paint filled+stroked countries onto a Web-Mercator canvas whose full world
 * is `worldDim` pixels square. `offsetX`/`offsetY` shift the drawing for
 * canvases that cover only a window of the world (detail patches).
 *
 * Rings are longitude-unwrapped relative to their previous vertex and the
 * whole world is drawn at -worldDim/0/+worldDim, so countries crossing the
 * antimeridian fill correctly instead of streaking across the canvas.
 */
export function paintCountriesMercator(ctx, worldDim, geojson, { offsetX = 0, offsetY = 0 } = {}) {
  const features = geojson?.features;
  if (!Array.isArray(features) || !features.length) return;

  const lonToX = (lon) => ((lon + 180) / 360) * worldDim;
  const latToY = (lat) => {
    const clamped = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat));
    const phi = (clamped * Math.PI) / 180;
    return worldDim * (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI));
  };

  ctx.save();
  ctx.translate(-offsetX, -offsetY);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, worldDim / 2048);

  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    if (!polys.length) continue;
    const fill = countryColor(feature.properties?.name || feature.id || 'Unknown');

    // Trace one ring. A ring whose unwrapped path ends a full world away
    // from its start circles a pole (Antarctica): closing it directly draws
    // a chord across the map, so when `closePolar` is set it closes via the
    // clamped pole edge instead. Returns whether the ring was polar so the
    // stroke pass can skip the synthetic closure edges (they are not
    // coastline and would draw a white line down the map).
    const traceRing = (ring, xOff, closePolar) => {
      let prevLon = null;
      let firstLon = null;
      let firstX = 0;
      let lastX = 0;
      let latSum = 0;
      for (let i = 0; i < ring.length; i++) {
        let lon = ring[i][0];
        if (prevLon !== null) {
          while (lon - prevLon > 180) lon -= 360;
          while (lon - prevLon < -180) lon += 360;
        }
        prevLon = lon;
        const x = lonToX(lon) + xOff;
        const y = latToY(ring[i][1]);
        latSum += ring[i][1];
        if (i === 0) {
          firstLon = lon;
          firstX = x;
          ctx.moveTo(x, y);
        } else {
          lastX = x;
          ctx.lineTo(x, y);
        }
      }
      const polar = Math.abs(prevLon - firstLon) > 180;
      if (polar && closePolar) {
        const poleY = latToY(latSum / ring.length < 0 ? -90 : 90);
        ctx.lineTo(lastX, poleY);
        ctx.lineTo(firstX, poleY);
      }
      if (!polar || closePolar) ctx.closePath();
      return polar;
    };

    for (const xOff of [-worldDim, 0, worldDim]) {
      // Fill each polygon (outer ring + holes) independently — same as the
      // flat map's Leaflet layer, and it keeps islands from punching
      // even-odd holes in the pole-closed Antarctic cap.
      for (const poly of polys) {
        if (!Array.isArray(poly)) continue;
        const rings = poly.filter((r) => Array.isArray(r) && r.length >= 3);
        if (!rings.length) continue;

        ctx.beginPath();
        let hadPolar = false;
        for (const ring of rings) hadPolar = traceRing(ring, xOff, true) || hadPolar;
        ctx.globalAlpha = 0.65;
        ctx.fillStyle = fill;
        ctx.fill('evenodd');

        // Stroke: real coastline only — rebuild without the polar closure.
        if (hadPolar) {
          ctx.beginPath();
          for (const ring of rings) traceRing(ring, xOff, false);
        }
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export default { COUNTRIES_GEOJSON_URL, COUNTRY_COLORS, countryColor, fetchCountriesGeojson, paintCountriesMercator };
