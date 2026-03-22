/**
 * HTML escape utility for preventing XSS in Leaflet popups and other raw HTML contexts.
 *
 * esc(str)       — escapes &, <, >, ", ' for safe HTML interpolation
 * sanitizeUrl(u) — returns the URL only if it uses http/https protocol, otherwise '#'
 */

export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '#';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
    return '#';
  } catch {
    return '#';
  }
}
