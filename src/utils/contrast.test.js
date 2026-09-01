/**
 * WCAG AA contrast guard (#1112): every theme palette in themes.css must keep
 * its text readable and its accent colors distinguishable on the surfaces
 * they render on. Fails the build when a palette edit reintroduces an
 * invisible-text combination (Retro once shipped accent-cyan identical to its
 * own background).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contrastRatio,
  ensureTextContrast,
  mixHex,
  parseHex,
  parseThemePalettes,
  relativeLuminance,
} from './contrast.js';

const css = readFileSync(resolve(process.cwd(), 'src/styles/themes.css'), 'utf8');
const themes = parseThemePalettes(css);

const TEXT_VARS = ['text-primary', 'text-secondary', 'text-muted'];
const ACCENT_VARS = ['accent-amber', 'accent-green', 'accent-red', 'accent-blue', 'accent-cyan', 'accent-purple'];
const SURFACES = ['bg-primary', 'bg-secondary'];

// Deliberate identity tradeoffs, each with a reason. Keep this list SHORT.
const EXCEPTIONS = new Set([
  // Retro's amber is tuned dark for the silver panels where it actually
  // renders (DX cluster frequency column etc.); nothing draws amber text
  // directly on the teal desktop, and a color passing BOTH surfaces would
  // have to be near-black. Staging screenshot 2026-08-29 confirmed the
  // bright-yellow variant was washed out on silver — panels win.
  'retro:accent-amber:bg-primary',
]);

describe('contrast math', () => {
  it('parses hex and computes known ratios', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#008080')).toEqual([0, 128, 128]);
    expect(parseHex('teal')).toBeNull();
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#008080', '#008080')).toBeCloseTo(1, 5);
  });
});

describe('themes.css meets WCAG AA (#1112)', () => {
  it('found the theme palettes', () => {
    expect(Object.keys(themes).length).toBeGreaterThan(5);
    expect(themes.retro).toBeDefined();
    expect(themes.light).toBeDefined();
  });

  for (const [name, vars] of Object.entries(themes)) {
    for (const surface of SURFACES) {
      const bg = vars[surface];
      if (!parseHex(bg)) continue; // rgba()/gradient surfaces are out of scope

      it(`${name}: text >= 4.5:1 on ${surface}`, () => {
        for (const tv of TEXT_VARS) {
          if (!parseHex(vars[tv])) continue;
          if (EXCEPTIONS.has(`${name}:${tv}:${surface}`)) continue;
          const ratio = contrastRatio(vars[tv], bg);
          expect(
            ratio,
            `${name} --${tv} (${vars[tv]}) vs --${surface} (${bg}) = ${ratio?.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      it(`${name}: accents >= 3:1 on ${surface}`, () => {
        for (const av of ACCENT_VARS) {
          if (!parseHex(vars[av])) continue;
          if (EXCEPTIONS.has(`${name}:${av}:${surface}`)) continue;
          const ratio = contrastRatio(vars[av], bg);
          expect(
            ratio,
            `${name} --${av} (${vars[av]}) vs --${surface} (${bg}) = ${ratio?.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});

describe('ensureTextContrast (readable band colors, #997/#1112 follow-up)', () => {
  it('leaves colors alone when they already pass', () => {
    expect(ensureTextContrast('#ffcc66', '#0d1520', 4.5)).toBe('#ffcc66'); // 40m on dark
    expect(ensureTextContrast('#000000', '#ffffff', 4.5)).toBe('#000000');
  });

  it('darkens a washed-out color on light backgrounds until it passes', () => {
    const out = ensureTextContrast('#ffcc66', '#c0c0c0', 4.5); // 40m yellow on retro silver
    expect(out).not.toBe('#ffcc66');
    expect(contrastRatio(out, '#c0c0c0')).toBeGreaterThanOrEqual(4.5);
    // Hue survives: still warm (r >= g >= b ordering of the original)
    const [r, g, b] = parseHex(out);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
  });

  it('lightens on dark backgrounds when needed', () => {
    const out = ensureTextContrast('#222222', '#000000', 4.5);
    expect(contrastRatio(out, '#000000')).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back to black/white when the ratio is unreachable mid-scale', () => {
    const out = ensureTextContrast('#808080', '#808080', 21); // impossible target
    expect(['#000000', '#ffffff']).toContain(out);
  });

  it('mixHex interpolates and tolerates junk', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('nope', '#ffffff', 0.5)).toBe('nope');
  });
});
