/**
 * webSdr.js — build "listen online" URLs for public web-accessible SDR receivers.
 *
 * Lets users without a connected rig hear a spotted station: click 🎧 on a
 * DX cluster spot and a browser SDR opens already tuned to the spot's
 * frequency and mode.
 *
 * Two receiver ecosystems matter here:
 *  - WebSDR (websdr.org software): tune via `?tune=<kHz><mode>`
 *  - KiwiSDR: tune via `?f=<kHz><mode>z<zoom>` (modes: am/amn/usb/lsb/cw/cwn/iq)
 *
 * Receiver selection is tiered:
 *  1. The live KiwiSDR public directory, via our server proxy
 *     (/api/websdr/receivers — see server/routes/websdr.js): the nearest
 *     online receiver with a free slot whose coverage includes the spot
 *     frequency. Loaded once per session (module-level cache, 30 min TTL).
 *  2. A tiny curated list of well-known, long-running public wideband
 *     receivers per rough region, for when the directory hasn't loaded
 *     (first paint, server offline).
 *  3. The KiwiSDR directory page (rx.linkfanel.net) as a last-ditch "find a
 *     receiver yourself" link when nothing above covers the frequency.
 */
import { apiFetch } from './apiFetch';

/** KiwiSDR public directory — "find a receiver near you" fallback. */
export const KIWISDR_DIRECTORY_URL = 'http://rx.linkfanel.net/';

// ── Live directory receivers (tier 1) ────────────────────────────────────
// Shared module-level cache: every panel instance sees the same list, and
// the server is asked at most once per TTL regardless of re-mounts.
const RECEIVERS_TTL_MS = 30 * 60 * 1000;
const RECEIVERS_RETRY_MS = 5 * 60 * 1000; // after a failed/empty load

const directoryStore = { list: null, fetchedAt: 0, promise: null };

/** Test hook — reset the module-level receiver cache. */
export const _resetReceiverDirectory = () => {
  directoryStore.list = null;
  directoryStore.fetchedAt = 0;
  directoryStore.promise = null;
};

/**
 * Fetch the nearest-receivers list for the user's DE location, once.
 * Concurrent callers share one in-flight promise; results are cached for
 * RECEIVERS_TTL_MS (RECEIVERS_RETRY_MS after a failure). Resolves with the
 * receiver list (possibly stale), or null when nothing has ever loaded —
 * getListenUrl() then just uses the curated fallbacks.
 *
 * @param {number} lat - DE latitude
 * @param {number} lon - DE longitude
 * @returns {Promise<Array|null>}
 */
export const loadNearbyReceivers = (lat, lon) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve(directoryStore.list);
  if (directoryStore.promise) return directoryStore.promise;
  const ttl = directoryStore.list?.length ? RECEIVERS_TTL_MS : RECEIVERS_RETRY_MS;
  if (directoryStore.fetchedAt && Date.now() - directoryStore.fetchedAt < ttl) {
    return Promise.resolve(directoryStore.list);
  }
  directoryStore.promise = (async () => {
    try {
      const res = await apiFetch(`/api/websdr/receivers?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
      if (!res?.ok) throw new Error(`websdr receivers HTTP ${res?.status}`);
      const body = await res.json();
      if (Array.isArray(body?.receivers)) directoryStore.list = body.receivers;
    } catch {
      // keep whatever we had (possibly null) — curated fallback covers us
    } finally {
      directoryStore.fetchedAt = Date.now();
      directoryStore.promise = null;
    }
    return directoryStore.list;
  })();
  return directoryStore.promise;
};

/**
 * Map a cluster spot mode (from detectMode/classifySpotMode: FT8, FT4, FT2,
 * CW, SSB, RTTY, PSK, AM, FM, or null) to an SDR demodulator string.
 * Band convention: phone/unknown above 10 MHz is USB, below is LSB.
 * All the narrowband digital modes are transmitted as audio in a USB passband.
 *
 * @param {string|null} mode - spot mode label
 * @param {number} freqKhz - frequency in kHz (picks usb/lsb sideband)
 * @returns {string} demod: 'cw' | 'usb' | 'lsb' | 'am' | 'fm'
 */
export const spotModeToDemod = (mode, freqKhz) => {
  const sideband = freqKhz >= 10000 ? 'usb' : 'lsb';
  switch ((mode || '').toUpperCase()) {
    case 'CW':
      return 'cw';
    case 'AM':
      return 'am';
    case 'FM':
      return 'fm';
    case 'FT8':
    case 'FT4':
    case 'FT2':
    case 'RTTY':
    case 'PSK':
      return 'usb'; // digital modes ride in a USB audio passband
    case 'SSB':
    default:
      return sideband;
  }
};

/**
 * Build a KiwiSDR URL for a specific receiver host.
 * Form: http://<host>/?f=<kHz><mode>z<zoom>  e.g. ?f=14074usbz8
 * KiwiSDR has no plain 'fm' demod on HF; NBFM is spelled 'nbfm'.
 *
 * @param {string} host - receiver host[:port], with or without http://
 * @param {number} freqKhz
 * @param {string|null} mode - spot mode label (see spotModeToDemod)
 * @param {number} [zoom=8]
 */
export const buildKiwiUrl = (host, freqKhz, mode, zoom = 8) => {
  const base = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  const demod = spotModeToDemod(mode, freqKhz);
  const kiwiDemod = demod === 'fm' ? 'nbfm' : demod;
  return `${base.replace(/\/$/, '')}/?f=${Math.round(freqKhz)}${kiwiDemod}z${zoom}`;
};

/**
 * Curated public receivers. Short and factual on purpose — each entry is a
 * well-known, long-running, institutionally-run wideband receiver. Users who
 * want something closer to home can browse KIWISDR_DIRECTORY_URL.
 * `minKhz`/`maxKhz` bound the receiver's usable coverage; `tune` returns a
 * fully-formed URL.
 */
export const WEB_SDR_RECEIVERS = [
  {
    id: 'twente',
    name: 'University of Twente WebSDR',
    region: 'EU',
    // Continuous 0.03–29.16 MHz, Enschede NL — online since 2008.
    minKhz: 30,
    maxKhz: 29160,
    tune: (kHz, demod) => `http://websdr.ewi.utwente.nl:8901/?tune=${Math.round(kHz)}${demod}`,
  },
  {
    id: 'utah-low',
    name: 'Northern Utah WebSDR (low bands)',
    region: 'NA',
    // websdr1: 2200/630/160/80/60/40 m — sdrutah.org
    minKhz: 135,
    maxKhz: 7300,
    tune: (kHz, demod) => `http://websdr1.sdrutah.org:8901/?tune=${Math.round(kHz)}${demod}`,
  },
  {
    id: 'utah-high',
    name: 'Northern Utah WebSDR (high bands)',
    region: 'NA',
    // websdr2: 30/20/17/15/12/10/6 m — sdrutah.org
    minKhz: 10100,
    maxKhz: 54000,
    tune: (kHz, demod) => `http://websdr2.sdrutah.org:8902/?tune=${Math.round(kHz)}${demod}`,
  },
];

/**
 * Guess the user's rough region from the browser timezone. A receiver near
 * the *listener* best approximates what their own antenna would hear.
 * @returns {'NA'|'EU'}
 */
const guessRegion = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz.startsWith('America')) return 'NA';
  } catch {
    /* default below */
  }
  return 'EU'; // Twente covers all of HF continuously — the safest default
};

/**
 * Build a listen URL for a spot, synchronously (the 🎧 link must be a plain
 * <a href> so popup blockers stay quiet — no async work at click time).
 *
 * Tier 1: nearest directory receiver (already sorted nearest-first by the
 *         server) whose coverage includes the frequency — covers VHF/UHF
 *         spots too when a VHF-capable Kiwi exists in the list.
 * Tier 2: curated regional receiver covering the frequency.
 * Tier 3: the KiwiSDR directory page, so the user can hunt manually.
 *
 * @param {number} freqKhz - frequency in kHz
 * @param {string|null} mode - spot mode label (FT8/CW/SSB/…)
 * @returns {{url: string, name: string}|null} null for nonsense frequencies
 */
export const getListenUrl = (freqKhz, mode) => {
  if (!Number.isFinite(freqKhz) || freqKhz <= 0) return null;
  const demod = spotModeToDemod(mode, freqKhz);

  // Tier 1 — live directory (if loadNearbyReceivers has delivered)
  if (Array.isArray(directoryStore.list)) {
    const kiwi = directoryStore.list.find(
      (r) => r?.url && r.coverage && freqKhz >= r.coverage.min_khz && freqKhz <= r.coverage.max_khz,
    );
    if (kiwi) return { url: buildKiwiUrl(kiwi.url, freqKhz, mode, 10), name: kiwi.name || kiwi.url };
  }

  // Tier 2 — curated regional receivers
  const covering = WEB_SDR_RECEIVERS.filter((r) => freqKhz >= r.minKhz && freqKhz <= r.maxKhz);
  const region = guessRegion();
  const pick = covering.find((r) => r.region === region) || covering[0];
  if (pick) return { url: pick.tune(freqKhz, demod), name: pick.name };

  // Tier 3 — directory page
  return { url: KIWISDR_DIRECTORY_URL, name: 'KiwiSDR directory' };
};

export default getListenUrl;
