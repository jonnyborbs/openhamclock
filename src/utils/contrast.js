/**
 * WCAG 2.1 contrast helpers (#1112).
 *
 * Pure math for the theme contrast guard test and any future tooling:
 * hex → relative luminance → contrast ratio, plus a tiny parser that pulls
 * each theme's custom-property palette out of themes.css text.
 */

/** #rgb / #rrggbb → [r,g,b] 0-255, or null for anything else. */
export function parseHex(color) {
  const m = String(color || '')
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** WCAG relative luminance of an sRGB hex color. */
export function relativeLuminance(color) {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1..21), or null if unparsable. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (rgb) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Linear mix of two hex colors in sRGB space, t=0 → a, t=1 → b. */
export function mixHex(a, b, t) {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return a;
  return toHex(ra.map((v, i) => v + (rb[i] - v) * t));
}

/**
 * Return `color` adjusted (darkened on light backgrounds, lightened on dark
 * ones) just enough to reach `minRatio` against `bg`. Colors that already
 * pass come back untouched, so dark-theme palettes are unaffected. Mixing
 * toward black/white preserves the hue, so a band keeps its identity —
 * 40m yellow becomes dark gold on silver, not gray.
 */
export function ensureTextContrast(color, bg, minRatio = 4.5) {
  const current = contrastRatio(color, bg);
  if (current == null || current >= minRatio) return color;
  const bgLum = relativeLuminance(bg);
  const target = bgLum > 0.5 ? '#000000' : '#ffffff';
  // Binary search the smallest mix that clears the ratio.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if ((contrastRatio(mixHex(color, target, mid), bg) ?? 0) >= minRatio) hi = mid;
    else lo = mid;
  }
  const result = mixHex(color, target, hi);
  // Full mix can still miss when minRatio is unreachable — return the target.
  return (contrastRatio(result, bg) ?? 0) >= minRatio ? result : target;
}

/**
 * Parse `[data-theme='name'] { --var: value; ... }` blocks out of CSS text.
 * Returns { themeName: { varName: value } }. Only top-level custom properties
 * are collected; nested selectors and non-variable declarations are ignored.
 */
export function parseThemePalettes(cssText) {
  const palettes = {};
  const blockRe = /\[data-theme=['"]([\w-]+)['"]\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(cssText)) !== null) {
    const name = m[1];
    const vars = palettes[name] || (palettes[name] = {});
    const varRe = /--([\w-]+)\s*:\s*([^;]+);/g;
    let v;
    while ((v = varRe.exec(m[2])) !== null) {
      vars[v[1]] = v[2].trim();
    }
  }
  return palettes;
}

export default { parseHex, relativeLuminance, contrastRatio, mixHex, ensureTextContrast, parseThemePalettes };
