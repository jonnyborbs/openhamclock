/**
 * GitHub-style heading slugger.
 *
 * Mirrors the algorithm GitHub uses for markdown heading anchors
 * (github-slugger): lowercase, strip everything that isn't a letter,
 * number, mark, space, hyphen, or underscore, then turn each space
 * into a hyphen. Consecutive spaces produce consecutive hyphens —
 * that's intentional, GitHub does the same ("Layouts (Settings →
 * Display)" → "layouts-settings--display").
 *
 * Used by the in-app manual renderer (MarkdownView) and the help
 * deep-link map (helpTopics.js) so anchors always match what GitHub
 * renders for docs/MANUAL.md.
 */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * Stateful slugger that de-duplicates repeated headings the way
 * GitHub does: second "Foo" becomes "foo-1", third "foo-2", etc.
 *
 * @returns {(text: string) => string}
 */
export function createSlugger() {
  const counts = new Map();
  return (text) => {
    const base = slugify(text);
    const n = counts.get(base) || 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

export default slugify;
