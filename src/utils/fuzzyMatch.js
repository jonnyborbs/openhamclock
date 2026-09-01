/**
 * fuzzyMatch — tiny, dependency-free subsequence matcher for the command
 * palette (Ctrl/Cmd+K).
 *
 * A query matches when its characters appear in the text in order (not
 * necessarily adjacent): "wmap" matches "World Map". The score prefers
 * matches at word starts, consecutive runs, and earlier positions, so exact
 * prefixes rank above scattered subsequences.
 */

/**
 * @param {string} query
 * @param {string} text
 * @returns {{ matched: boolean, score: number }}
 */
export function fuzzyMatch(query, text) {
  const q = String(query || '').toLowerCase();
  const s = String(text || '').toLowerCase();
  if (!q) return { matched: true, score: 0 };
  if (!s) return { matched: false, score: 0 };

  let score = 0;
  let ti = 0;
  let prevMatchIndex = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = s.indexOf(ch, ti);
    if (found === -1) return { matched: false, score: 0 };
    // Word-boundary bonus: first char of the text or preceded by a separator.
    if (found === 0 || /[\s\-_/():.]/.test(s[found - 1])) score += 3;
    // Consecutive-run bonus.
    if (found === prevMatchIndex + 1) score += 2;
    // Small penalty for how far we had to skip.
    score -= (found - ti) * 0.05;
    prevMatchIndex = found;
    ti = found + 1;
  }
  // Prefer shorter texts when the same query matches several entries.
  score += Math.max(0, 2 - s.length * 0.01);
  return { matched: true, score };
}

/**
 * Filter + rank a list by fuzzy match.
 *
 * @param {string} query
 * @param {Array} items
 * @param {(item) => string} getText — text to match against (defaults to String(item))
 * @returns {Array} matching items, best score first (stable for ties)
 */
export function fuzzyFilter(query, items, getText = (x) => String(x)) {
  const list = Array.isArray(items) ? items : [];
  if (!String(query || '').trim()) return [...list];
  const scored = [];
  for (let i = 0; i < list.length; i++) {
    const { matched, score } = fuzzyMatch(query, getText(list[i]));
    if (matched) scored.push({ item: list[i], score, i });
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((e) => e.item);
}

export default fuzzyMatch;
