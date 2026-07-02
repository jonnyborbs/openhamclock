/**
 * Callsign validation shared by the telnet login and spot submission paths.
 *
 * Deliberately permissive about real callsign shapes (prefixed/suffixed
 * portable calls included) but rejects junk like 'OPENHAMCLOCK-56' — we
 * learned the hard way that presenting invalid callsigns to the cluster
 * network gets you flagged as abusive.
 */

// Core callsign body: prefix (1-3 alphanumerics ending in a letter rule is too
// strict for special events), digit, suffix letters. Examples: W1AW, K0CJH,
// EA8/DL1ABC, VK2XYZ/P, 9A1A.
const CORE_RE = /^[A-Z0-9]{1,3}\d[A-Z]{1,4}$/i;

// Optional SSID like -2 or -56 (telnet cluster convention)
const SSID_RE = /^-\d{1,2}$/;

function isValidCallsign(raw) {
  if (typeof raw !== 'string') return false;
  const call = raw.trim().toUpperCase();
  if (call.length < 3 || call.length > 16) return false;

  // Split off SSID if present
  const ssidIdx = call.lastIndexOf('-');
  let body = call;
  if (ssidIdx > 0) {
    if (!SSID_RE.test(call.slice(ssidIdx))) return false;
    body = call.slice(0, ssidIdx);
  }

  // Portable prefixes/suffixes: EA8/DL1ABC, DL1ABC/P, DL1ABC/QRP
  const parts = body.split('/');
  if (parts.length > 3) return false;

  // At least one part must look like a full callsign core
  const hasCore = parts.some((p) => CORE_RE.test(p));
  if (!hasCore) return false;

  // Every part must be plausible (alphanumeric, sane length)
  return parts.every((p) => /^[A-Z0-9]{1,8}$/i.test(p));
}

// Strip SSID and portable decorations down to the base call (for rate keys)
function baseCallsign(raw) {
  const call = String(raw || '')
    .trim()
    .toUpperCase()
    .split('-')[0];
  const parts = call.split('/');
  // Pick the part that looks like a core callsign, longest wins on ties
  const cores = parts.filter((p) => CORE_RE.test(p)).sort((a, b) => b.length - a.length);
  return cores[0] || parts[0] || '';
}

// Strip control characters so a login line can never smuggle telnet commands
function sanitizeLine(raw) {
  return String(raw || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

module.exports = { isValidCallsign, baseCallsign, sanitizeLine };
