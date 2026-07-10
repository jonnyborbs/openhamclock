/**
 * Per-user callbook (QRZ / HamQTH) credentials for the hosted instance.
 *
 * Stored ONLY in this browser's localStorage — deliberately kept out of the
 * settings sync so they are never written to any server config. They are
 * sent as base64 auth headers on /api/callsign lookups; the server exchanges
 * them for callbook session keys held in memory and never persists them, and
 * lookup results are cached per credential so one subscriber's callbook data
 * is never served to another user.
 */
const STORAGE_KEY = 'ohc-callbook-auth';

export function getCallbookCredentials() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function setCallbookCredentials(creds) {
  const clean = {};
  for (const key of ['qrzUsername', 'qrzPassword', 'hamqthUsername', 'hamqthPassword']) {
    if (creds?.[key]) clean[key] = creds[key];
  }
  try {
    if (Object.keys(clean).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // localStorage unavailable (private mode) — credentials just won't persist
  }
}

// btoa() chokes on non-ASCII; encode via UTF-8 bytes so any password works
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export function callbookAuthHeaders() {
  const creds = getCallbookCredentials();
  const headers = {};
  try {
    if (creds.qrzUsername && creds.qrzPassword) {
      headers['X-QRZ-Auth'] = b64(`${creds.qrzUsername}:${creds.qrzPassword}`);
    }
    if (creds.hamqthUsername && creds.hamqthPassword) {
      headers['X-HamQTH-Auth'] = b64(`${creds.hamqthUsername}:${creds.hamqthPassword}`);
    }
  } catch {
    // malformed stored values — fail open with no auth headers
  }
  return headers;
}
