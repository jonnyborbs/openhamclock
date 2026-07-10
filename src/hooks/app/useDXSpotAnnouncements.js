import { useEffect, useRef, useState } from 'react';

const COOLDOWN_MS = 10000; // min gap between successive announcements
const CLEARDOWN_MS = 5000; // clear announcement after 5 seconds

function formatFreq(freq) {
  if (freq == null) return '';
  const v = parseFloat(freq);
  if (!Number.isFinite(v)) return String(freq);
  const mhz = v > 1000 ? v / 1000 : v;
  return `${mhz.toFixed(3)} MHz`;
}

/**
 * Announces new DX spot arrivals via an aria-live region (#997).
 * Follows the same pattern as useLightningAnnouncements / useSatelliteAnnouncements.
 *
 * Takes the already-filtered spot list from useDXClusterData so only spots
 * matching the user's active filters are announced.
 */
export function useDXSpotAnnouncements(spots) {
  const [announcement, setAnnouncement] = useState('');
  const prevKeysRef = useRef(null); // null = baseline not yet established
  const lastAnnouncedRef = useRef(0);
  const clearTimerRef = useRef(null);

  useEffect(() => {
    // Always establish baseline on first call, even if the spot list is empty.
    // Without this, the first non-empty update would set the baseline instead of announcing.
    if (prevKeysRef.current === null) {
      prevKeysRef.current = new Set((spots ?? []).map((s) => `${s.call}-${s.freq}-${s.spotter}`));
      return;
    }

    if (!spots || spots.length === 0) return;

    const prev = prevKeysRef.current;
    const newSpots = spots.filter((s) => !prev.has(`${s.call}-${s.freq}-${s.spotter}`));
    prevKeysRef.current = new Set(spots.map((s) => `${s.call}-${s.freq}-${s.spotter}`));

    if (newSpots.length === 0) return;

    const now = Date.now();
    if (now - lastAnnouncedRef.current < COOLDOWN_MS) return;
    lastAnnouncedRef.current = now;

    const latest = newSpots[0];
    const text =
      newSpots.length === 1
        ? `New DX spot: ${latest.call} on ${formatFreq(latest.freq)}`
        : `${newSpots.length} new DX spots, latest: ${latest.call} on ${formatFreq(latest.freq)}`;

    setAnnouncement(text);

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setAnnouncement(''), CLEARDOWN_MS);
  }, [spots]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  return { announcement };
}
