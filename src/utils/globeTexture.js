/**
 * Globe Texture Builder
 * Fetches Web Mercator raster tiles and composites them into an
 * equirectangular (plate carrée) canvas suitable for wrapping a sphere.
 *
 * three.js SphereGeometry maps texture V linearly to latitude, so Mercator
 * tiles cannot be applied directly — every row has to be remapped first.
 * tileReproject.js does the equivalent remap per-pixel while sampling for the
 * azimuthal canvas; here we bake it once into a texture the GPU can reuse.
 */

import { fetchCountriesGeojson, paintCountriesMercator } from './countriesBasemap.js';

const DEG = Math.PI / 180;
const MAX_MERCATOR_LAT = 85.0511287798066;

const MAX_CONCURRENT = 6;

const subdomains = ['a', 'b', 'c'];
let subIdx = 0;

function resolveTileUrl(template, z, x, y, lang) {
  const s = subdomains[subIdx++ % subdomains.length];
  return template
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{s}', s)
    .replace('{r}', '')
    .replace('{lang}', lang || 'en');
}

// Mercator pixel Y for a given latitude, on a dim×dim world mosaic.
function latToMercatorY(lat, dim) {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const mercN = Math.log(Math.tan(Math.PI / 4 + (clamped * DEG) / 2));
  return dim / 2 - (dim * mercN) / (2 * Math.PI);
}

function loadTile(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous'; // required, or the canvas taints and WebGL upload fails

    // Checking the signal only up front would let every in-flight download run
    // to completion after an abort, competing with the next style's burst.
    const onAbort = () => {
      img.onload = null;
      img.onerror = null;
      img.src = ''; // cancels the in-flight request in every major browser
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    img.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`tile failed: ${url}`));
    };
    img.src = url;
  });
}

/**
 * Build an equirectangular texture canvas from a Leaflet-style tile template.
 *
 * @param {object}   opts
 * @param {string}   opts.tileUrlTemplate - Leaflet URL template ({z}/{x}/{y})
 * @param {object}   [opts.polar]         - { north, south } ArcGIS MapServer URLs for
 *                                        real polar imagery; omit for sources that
 *                                        publish Mercator only
 * @param {number}   [opts.tileZoom=3]    - Zoom level; 2^z × 2^z tiles are fetched
 * @param {string}   [opts.lang]          - Language for {lang} templates
 * @param {Function} [opts.onProgress]    - Called with 0..1 as tiles land
 * @param {AbortSignal} [opts.signal]     - Cancels in-flight work
 * @returns {Promise<HTMLCanvasElement>}  - 2:1 equirectangular canvas
 */
export async function buildGlobeTexture({
  tileUrlTemplate,
  tileZoom = 3,
  lang,
  baseColor,
  countries,
  polar,
  onProgress,
  signal,
}) {
  const numTiles = Math.pow(2, tileZoom);
  const dim = numTiles * 256;

  // Stage 1 — composite the raw Mercator mosaic.
  const merc = document.createElement('canvas');
  merc.width = dim;
  merc.height = dim;
  const mctx = merc.getContext('2d');

  // Backdrop for failed tiles, and for styles whose tiles are a transparent
  // overlay (e.g. Countries) rather than a full basemap — those would otherwise
  // be nothing but holes.
  mctx.fillStyle = baseColor || '#0b1a2b';
  mctx.fillRect(0, 0, dim, dim);

  // Countries style: the flat map fills every country with a hashed color
  // under the transparent boundary tiles; paint the same fills here so the
  // globe matches (#1166). A failed fetch degrades to base + boundary tiles.
  if (countries) {
    try {
      const geojson = await fetchCountriesGeojson();
      if (signal?.aborted) throw new Error('aborted');
      paintCountriesMercator(mctx, dim, geojson);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[globeTexture] countries fills unavailable:', e?.message || e);
    }
  }

  const queue = [];
  for (let ty = 0; ty < numTiles; ty++) {
    for (let tx = 0; tx < numTiles; tx++) {
      queue.push({ tx, ty });
    }
  }

  let loaded = 0;
  const total = queue.length;
  let next = 0;

  // Firing all 64-256 tile requests at once gets us rate-limited (HTTP 429) by
  // the tile providers, and a throttled tile is a hole in the texture. Match
  // the concurrency tileReproject.js settled on.
  async function worker() {
    while (next < queue.length) {
      if (signal?.aborted) return;
      const { tx, ty } = queue[next++];
      const url = resolveTileUrl(tileUrlTemplate, tileZoom, tx, ty, lang);
      try {
        const img = await loadTile(url, signal);
        if (!signal?.aborted) mctx.drawImage(img, tx * 256, ty * 256, 256, 256);
      } catch {
        // Missing tile — the base fill already covers it. An abort, though,
        // means a newer run owns the progress bar now: reporting here would
        // overwrite its 0% and make the bar jump backwards.
        if (signal?.aborted) return;
      }
      loaded++;
      if (onProgress) onProgress(loaded / total);
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  if (signal?.aborted) throw new Error('aborted');

  // Stage 2 — remap Mercator rows to equirectangular.
  const outW = dim;
  const outH = dim / 2; // equirectangular is always 2:1
  const eq = document.createElement('canvas');
  eq.width = outW;
  eq.height = outH;
  const ectx = eq.getContext('2d');

  for (let y = 0; y < outH; y++) {
    const lat = 90 - ((y + 0.5) / outH) * 180;
    // Beyond ±85.05° Mercator has no data, so clamping repeats the last real
    // row across the cap. For basemaps with a polar source those rows are then
    // replaced with real imagery; for the rest they stay as they have always
    // been.
    const srcY = Math.max(0, Math.min(dim - 1, Math.floor(latToMercatorY(lat, dim))));
    ectx.drawImage(merc, 0, srcY, dim, 1, 0, y, outW, 1);
  }

  // Polar caps: basemaps with a polar source (Satellite) get real imagery
  // drawn into the cap; every basemap then has its remaining cap rows faded
  // into a flat disc of the boundary band's average colour, so the clamped
  // Mercator repeat never renders as wedges or as blur rings at the poles.
  // Without a polar source drawPolarImagery fetches nothing and reports the
  // full cap as unfilled, which routes the whole cap to the settle pass.
  const capRows = Math.floor(((90 - MAX_MERCATOR_LAT) / 180) * outH);
  if (capRows >= 1) {
    const hole = await drawPolarImagery(ectx, outW, outH, capRows, polar, signal);
    settlePolarCap(ectx, outW, outH, hole.north, -1, hole.north);
    settlePolarCap(ectx, outW, outH, outH - 1 - hole.south, 1, hole.south);
  }

  return { canvas: eq, meanLuma: measureMeanLuma(eq) };
}

/**
 * Per-channel mean and standard deviation over a block of pixels.
 *
 * `stride` skips transparent pixels when reading a fetched strip; the texture
 * itself is always opaque, so the alpha test simply passes there.
 */
function channelStats(data) {
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    for (let c = 0; c < 3; c++) {
      sum[c] += data[i + c];
      sumSq[c] += data[i + c] * data[i + c];
    }
    n++;
  }
  if (n === 0) return null;
  return [0, 1, 2].map((c) => {
    const mean = sum[c] / n;
    return { mean, sd: Math.sqrt(Math.max(0, sumSq[c] / n - mean * mean)) };
  });
}

/** Average colour of one pixel row, as [r, g, b]. */
function averageRow(ctx, width, y) {
  const stats = channelStats(ctx.getImageData(0, y, width, 1).data);
  return stats ? stats.map((c) => Math.round(c.mean)) : [0, 0, 0];
}

/**
 * One polar cap as a plate-carrée strip, fetched from a polar-projected service.
 *
 * Web Mercator has no data past ±85.05°, but the same imagery exists in polar
 * projections. Rather than reprojecting here, the ArcGIS export endpoint is
 * asked for the strip already in EPSG:4326 — the projection this texture is in —
 * so the result drops straight into the cap rows.
 *
 * Returns null rather than throwing: real polar imagery is an improvement on
 * the fallback, never a requirement for building a texture.
 */
async function fetchPolarStrip(serviceUrl, hemisphere, width, rows, signal) {
  if (!serviceUrl || rows < 1) return null;

  const bbox = hemisphere === 'north' ? `-180,${MAX_MERCATOR_LAT},180,90` : `-180,-90,180,${-MAX_MERCATOR_LAT}`;

  // png32 keeps an alpha channel, which is how the no-data hole over the pole
  // is told apart from genuinely dark ocean.
  const url =
    `${serviceUrl}/export?bbox=${bbox}&bboxSR=4326&imageSR=4326` +
    `&size=${width},${rows}&format=png32&transparent=true&f=image`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Prepare a fetched strip for compositing: close its gaps, match it to the
 * basemap, and ease it in at the join.
 *
 * All three have to happen here, on the strip's own pixels, rather than on the
 * texture afterwards. The strip is transparent for about 11px either side of
 * ±180 and over the pole itself; correcting colour after compositing also
 * scales whatever showed through those gaps, which turned the leftover Mercator
 * row bright green down each edge.
 *
 * @param {object} target - channelStats() of the basemap rows below the cap
 * @returns {{ canvas: HTMLCanvasElement, hole: number }} hole = rows at the pole
 *          still carrying no data
 */
function preparePolarStrip(bitmap, hemisphere, target) {
  const w = bitmap.width;
  const h = bitmap.height;
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bitmap, 0, 0);

  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  const alphaAt = (x, y) => d[(y * w + x) * 4 + 3];

  // Close the antimeridian sliver by interpolating between the last valid column
  // each side. The gap spans ±180, so those columns are neighbours once the
  // texture wraps and the join is invisible.
  for (let y = 0; y < h; y++) {
    let left = 0;
    while (left < w && alphaAt(left, y) < 128) left++;
    if (left >= w) continue; // whole row is hole; the fallback covers it
    let right = w - 1;
    while (right > left && alphaAt(right, y) < 128) right--;

    const gap = left + (w - 1 - right);
    if (gap === 0 || gap > w / 8) continue; // nothing to do, or not an edge sliver

    const from = (y * w + right) * 4;
    const to = (y * w + left) * 4;
    for (let i = 0; i < gap; i++) {
      const x = i < w - 1 - right ? right + 1 + i : i - (w - 1 - right);
      const t = (i + 1) / (gap + 1);
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[o + c] = d[from + c] * (1 - t) + d[to + c] * t;
      d[o + 3] = 255;
    }
  }

  // Match level and spread to the basemap. Matching the mean alone leaves the
  // deep cap looking wrong, because these services differ in contrast as well
  // as brightness; scaling about the mean fixes both. Clamped, because a wild
  // ratio means the sources disagree too badly to force together.
  const source = channelStats(d);
  if (target && source) {
    const k = [0, 1, 2].map((c) => (source[c].sd < 1 ? 1 : Math.max(0.5, Math.min(2, target[c].sd / source[c].sd))));
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        d[i + c] = (d[i + c] - source[c].mean) * k[c] + target[c].mean;
      }
    }
  }

  // Rows with no data at the pole, counted from the polar end.
  const order = hemisphere === 'north' ? [...Array(h).keys()] : [...Array(h).keys()].reverse();
  let hole = 0;
  for (const y of order) {
    let opaque = 0;
    for (let x = 0; x < w; x++) if (alphaAt(x, y) >= 128) opaque++;
    if (opaque < w * 0.5) hole++;
    else break;
  }

  // Ease the strip in across the rows nearest the boundary. Matching statistics
  // gets the level right, but any residual difference still reads as a ring on a
  // sphere; ramping the alpha lets it emerge from the Mercator imagery instead
  // of starting at full strength on one row.
  const blendRows = Math.max(2, Math.round(h * 0.15));
  for (let i = 0; i < blendRows; i++) {
    const y = hemisphere === 'north' ? h - 1 - i : i;
    if (y < 0 || y >= h) break;
    const t = (i + 1) / (blendRows + 1);
    for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] *= t;
  }

  sctx.putImageData(img, 0, 0);
  return { canvas: scratch, hole };
}

/**
 * Paint real polar imagery over the repeated Mercator rows.
 *
 * Returns how many rows at each pole still carry no data, so the cosmetic
 * fallback only has to cover what is left — typically the half-degree hole
 * these services leave over the pole itself, or the whole cap if a fetch failed.
 */
async function drawPolarImagery(ctx, width, height, capRows, polar, signal) {
  const reach = { north: capRows, south: capRows };
  if (!polar || capRows < 1) return reach;

  const stripWidth = Math.min(width, 4096);
  const [north, south] = await Promise.all([
    fetchPolarStrip(polar.north, 'north', stripWidth, capRows, signal),
    fetchPolarStrip(polar.south, 'south', stripWidth, capRows, signal),
  ]);

  // Match against a band of basemap rows below the cap rather than a single
  // row, so one unusual row of cloud or ice cannot skew the whole correction.
  const band = (y0) => channelStats(ctx.getImageData(0, y0, width, Math.max(1, Math.round(capRows / 4))).data);

  for (const [bitmap, hemisphere] of [
    [north, 'north'],
    [south, 'south'],
  ]) {
    if (!bitmap) continue;
    const target = hemisphere === 'north' ? band(capRows) : band(height - capRows - Math.round(capRows / 4));
    const { canvas, hole } = preparePolarStrip(bitmap, hemisphere, target);
    const destY = hemisphere === 'north' ? 0 : height - capRows;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, destY, width, capRows);
    reach[hemisphere] = hole;
    bitmap.close?.();
  }

  return reach;
}

/**
 * Cover whatever real imagery does not reach at one pole.
 *
 * Used for the no-data hole the polar services leave over the point, and for
 * the whole cap when a polar fetch fails. Both cases are the same problem: rows
 * that are copies of the last real Mercator row, which a sphere collapses into
 * a pinwheel of wedges because every column of a row meets at the pole.
 *
 * Blur and blend in one pass over one readback. The blur is horizontal only —
 * the stripes are variation *along* a row and every row here is a copy of the
 * same one, so a vertical blur would move no pixels — and its window wraps at
 * the antimeridian, which a canvas filter would not.
 *
 * @param {number} edge - row index of the last real imagery
 * @param {number} dir  - -1 walking north, +1 walking south
 * @param {number} rows - how many rows still need covering
 */
function settlePolarCap(ctx, width, height, edge, dir, rows) {
  if (rows < 1) return;
  const blockTop = dir < 0 ? Math.max(0, edge - rows) : Math.min(height - 1, edge + 1);
  const blockRows = Math.min(rows, dir < 0 ? edge : height - 1 - edge);
  if (blockRows < 1) return;

  const settled = averageRow(ctx, width, edge);
  const ease = (t) => t * t * (3 - 2 * t);
  // The cap becomes a flat disc of the settled colour, reached within the
  // first ~40% of the cap. The short feather fades each column's clamped
  // streak before it can read as a wedge; going flat immediately after kills
  // both the striping a pure blend leaves AND the concentric pucker a
  // progressive horizontal blur produces on busy basemaps.
  const FEATHER = 0.4;

  const img = ctx.getImageData(0, blockTop, width, blockRows);
  const d = img.data;

  for (let i = 1; i <= blockRows; i++) {
    const row = edge + dir * i - blockTop;
    if (row < 0 || row >= blockRows) continue;

    const base = row * width * 4;
    const alpha = ease(Math.min(1, i / rows / FEATHER));

    for (let x = 0; x < width; x++) {
      const o = base + x * 4;
      for (let c = 0; c < 3; c++) {
        d[o + c] = d[o + c] * (1 - alpha) + settled[c] * alpha;
      }
    }
  }

  ctx.putImageData(img, 0, blockTop);
}

/**
 * Mean luminance of a texture, sampled from a small downscale.
 *
 * Basemaps vary enormously in brightness — CARTO's dark style is almost black
 * at globe zoom, where on a flat map its labels still carry the detail. The
 * caller uses this to lift dark textures back to a legible range instead of
 * hardcoding a per-style fudge factor.
 */
function measureMeanLuma(canvas) {
  const w = 64;
  const h = 32;
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, w, h);

  let data;
  try {
    data = sctx.getImageData(0, 0, w, h).data;
  } catch {
    return 0.5; // tainted canvas — assume mid brightness and skip the boost
  }

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  }
  return sum / (data.length / 4);
}

/**
 * Tile zoom to use for the globe texture.
 * Zoom 3 = 64 tiles / 2048², zoom 4 = 256 tiles / 4096². Anything higher costs
 * more than the sphere can show at typical panel sizes.
 */
export function chooseGlobeTileZoom({ lowMemory = false, pixelRatio = 1 } = {}) {
  if (lowMemory) return 2;
  return pixelRatio >= 2 ? 4 : 3;
}

// Inverse of latToMercatorY: latitude at a Mercator pixel row.
function mercatorYToLat(y, dim) {
  return (2 * Math.atan(Math.exp(((dim / 2 - y) * 2 * Math.PI) / dim)) - Math.PI / 2) / DEG;
}

/**
 * High-zoom detail patch for the visible window of the globe.
 *
 * A whole-globe equirect texture tops out around z5 (8192px for the entire
 * planet), which magnifies badly up close. This fetches Mercator tiles at a
 * Leaflet-grade zoom for ONLY the requested lon/lat window, remaps them to
 * equirectangular, and returns the canvas plus the tile-aligned bounds the
 * shader needs to blend it over the base texture.
 *
 * Longitude wraps across the antimeridian: columns are fetched modulo the
 * world width and composed on a continuous (unwrapped) canvas.
 *
 * @returns {Promise<{canvas, bounds:{lonMin, lonSpan, latTop, latBottom}}>}
 */
export async function buildGlobeDetailPatch({
  tileUrlTemplate,
  lang,
  zoom,
  lonMin,
  lonSpan,
  latTop,
  latBottom,
  countries,
  signal,
}) {
  const worldTiles = Math.pow(2, zoom);
  const worldDim = worldTiles * 256;

  // Tile-align the window.
  const xStart = Math.floor(((lonMin + 180) / 360) * worldTiles);
  const xCount = Math.min(worldTiles, Math.ceil(((lonMin + lonSpan + 180) / 360) * worldTiles) - xStart);
  const yTopPx = latToMercatorY(Math.min(latTop, MAX_MERCATOR_LAT), worldDim);
  const yBotPx = latToMercatorY(Math.max(latBottom, -MAX_MERCATOR_LAT), worldDim);
  const tyStart = Math.max(0, Math.floor(yTopPx / 256));
  const tyEnd = Math.min(worldTiles - 1, Math.floor((yBotPx - 1) / 256));
  const yCount = tyEnd - tyStart + 1;
  if (xCount < 1 || yCount < 1) throw new Error('empty patch window');

  const merc = document.createElement('canvas');
  merc.width = xCount * 256;
  merc.height = yCount * 256;
  const mctx = merc.getContext('2d');
  mctx.fillStyle = countries ? '#4a90d9' : '#0b1a2b';
  mctx.fillRect(0, 0, merc.width, merc.height);

  // Countries style: repaint the fills into the patch window too, or the
  // close-zoom detail blend would stomp them with bare ocean blue (#1166).
  if (countries) {
    try {
      const geojson = await fetchCountriesGeojson();
      if (signal?.aborted) throw new Error('aborted');
      paintCountriesMercator(mctx, worldDim, geojson, { offsetX: xStart * 256, offsetY: tyStart * 256 });
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }

  const queue = [];
  for (let j = 0; j < yCount; j++) {
    for (let i = 0; i < xCount; i++) {
      queue.push({ i, j, tx: (xStart + i) % worldTiles, ty: tyStart + j });
    }
  }
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      if (signal?.aborted) return;
      const { i, j, tx, ty } = queue[next++];
      try {
        const img = await loadTile(resolveTileUrl(tileUrlTemplate, zoom, tx, ty, lang), signal);
        if (!signal?.aborted) mctx.drawImage(img, i * 256, j * 256, 256, 256);
      } catch {
        if (signal?.aborted) return;
      }
    }
  }
  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
  if (signal?.aborted) throw new Error('aborted');

  // Actual bounds of the tile-aligned patch.
  const alignedLonMin = (xStart / worldTiles) * 360 - 180;
  const alignedLonSpan = (xCount / worldTiles) * 360;
  const alignedLatTop = mercatorYToLat(tyStart * 256, worldDim);
  const alignedLatBottom = mercatorYToLat((tyEnd + 1) * 256, worldDim);

  // Remap Mercator rows to an equirectangular patch (linear in latitude).
  const outW = merc.width;
  const pxPerDeg = outW / alignedLonSpan;
  const outH = Math.max(1, Math.round((alignedLatTop - alignedLatBottom) * pxPerDeg));
  const eq = document.createElement('canvas');
  eq.width = outW;
  eq.height = outH;
  const ectx = eq.getContext('2d');
  for (let y = 0; y < outH; y++) {
    const lat = alignedLatTop - ((y + 0.5) / outH) * (alignedLatTop - alignedLatBottom);
    const srcY = Math.max(0, Math.min(merc.height - 1, Math.floor(latToMercatorY(lat, worldDim) - tyStart * 256)));
    ectx.drawImage(merc, 0, srcY, outW, 1, 0, y, outW, 1);
  }

  return {
    canvas: eq,
    bounds: { lonMin: alignedLonMin, lonSpan: alignedLonSpan, latTop: alignedLatTop, latBottom: alignedLatBottom },
  };
}

export default { buildGlobeTexture, buildGlobeDetailPatch, chooseGlobeTileZoom };
