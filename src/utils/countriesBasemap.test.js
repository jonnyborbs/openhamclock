import { describe, expect, it } from 'vitest';
import { COUNTRY_COLORS, countryColor, paintCountriesMercator } from './countriesBasemap.js';

/** Recording stub for a 2D context — jsdom has no real canvas. */
const makeCtx = () => {
  const calls = [];
  const record =
    (name) =>
    (...args) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    fill: record('fill'),
    stroke: record('stroke'),
    set lineJoin(v) {},
    set lineWidth(v) {},
    set globalAlpha(v) {},
    set fillStyle(v) {},
    set strokeStyle(v) {},
  };
};

const feature = (name, ring) => ({
  type: 'Feature',
  properties: { name },
  geometry: { type: 'Polygon', coordinates: [ring] },
});

describe('countryColor', () => {
  it('is deterministic and always picks from the palette', () => {
    expect(countryColor('Germany')).toBe(countryColor('Germany'));
    for (const name of ['United States of America', 'Fiji', 'Japan', '', null]) {
      expect(COUNTRY_COLORS).toContain(countryColor(name));
    }
  });
});

describe('paintCountriesMercator', () => {
  const square = feature('Testland', [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
    [10, 10],
  ]);

  it('fills and strokes each world copy of a polygon', () => {
    const ctx = makeCtx();
    paintCountriesMercator(ctx, 2048, { features: [square] });
    expect(ctx.calls.filter(([n]) => n === 'fill')).toHaveLength(3); // -world, 0, +world copies
    expect(ctx.calls.filter(([n]) => n === 'stroke')).toHaveLength(3);
    expect(ctx.calls.filter(([n]) => n === 'closePath')).toHaveLength(3);
  });

  it('unwraps rings across the antimeridian instead of streaking', () => {
    const fiji = feature('Fijiland', [
      [175, -15],
      [-175, -15], // 10° hop across the antimeridian, not 350° back
      [-175, -20],
      [175, -20],
      [175, -15],
    ]);
    const ctx = makeCtx();
    paintCountriesMercator(ctx, 3600, { features: [fiji] }); // 10px per degree
    const center = ctx.calls.filter(([n]) => n === 'moveTo' || n === 'lineTo').slice(0, 5);
    const xs = center.map(([, x]) => x);
    const spanX = Math.max(...xs) - Math.min(...xs);
    expect(spanX).toBeLessThanOrEqual(110); // ~10° wide, never ~350°
  });

  it('applies the patch offset', () => {
    const ctx = makeCtx();
    paintCountriesMercator(ctx, 2048, { features: [square] }, { offsetX: 512, offsetY: 256 });
    expect(ctx.calls).toContainEqual(['translate', -512, -256]);
  });

  it('tolerates empty or malformed input', () => {
    const ctx = makeCtx();
    paintCountriesMercator(ctx, 2048, null);
    paintCountriesMercator(ctx, 2048, { features: [{ geometry: null }] });
    expect(ctx.calls.filter(([n]) => n === 'fill')).toHaveLength(0);
  });
});

describe('polar rings (Antarctica)', () => {
  it('closes pole-circling rings via the pole edge, not a chord', () => {
    // Synthetic Antarctica: a ring circling the globe at 70°S, closed.
    const lons = Array.from({ length: 37 }, (_, i) => -180 + i * 10);
    const ring = lons.map((lon) => [lon, -70]);
    ring.push([-180, -70]);
    const ctx = makeCtx();
    paintCountriesMercator(ctx, 2048, { features: [feature('Antarctica', ring)] });
    // The closure must touch the clamped south-pole edge (bottom of the map)
    const ys = ctx.calls.filter(([n]) => n === 'lineTo').map(([, , y]) => y);
    expect(Math.max(...ys)).toBeGreaterThan(2048 * 0.95);
  });

  it('leaves ordinary closed rings alone', () => {
    const ctx = makeCtx();
    paintCountriesMercator(ctx, 2048, {
      features: [
        feature('Testland', [
          [10, 10],
          [20, 10],
          [20, 20],
          [10, 20],
          [10, 10],
        ]),
      ],
    });
    const ys = ctx.calls.filter(([n]) => n === 'lineTo').map(([, , y]) => y);
    expect(Math.max(...ys)).toBeLessThan(2048 * 0.6); // nothing near the pole edge
  });
});
