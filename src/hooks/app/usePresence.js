/**
 * usePresence Hook
 * Reports this user's callsign and location to the presence API
 * so they appear on the Active Users map layer for other operators.
 * Runs globally for all configured users (callsign != N0CALL).
 */
import { useEffect, useRef } from 'react';

const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutes
// Server locks out repeat presence POSTs from one IP for 1 minute — don't
// even send a heartbeat earlier than that (tab wake-ups and remounts fire
// the effect again well before the interval elapses).
const MIN_HEARTBEAT_SPACING = 61 * 1000;

// Module-level so every mount of the hook in this tab shares the throttle
let lastHeartbeatAt = 0;

export default function usePresence({ callsign, locator, sharePresence = true }) {
  const locationRef = useRef(null);

  // Parse locator to lat/lon
  useEffect(() => {
    if (!locator || locator.length < 4) {
      locationRef.current = null;
      return;
    }
    const g = locator.toUpperCase();
    const lonField = (g.charCodeAt(0) - 65) * 20 - 180;
    const latField = (g.charCodeAt(1) - 65) * 10 - 90;
    const lonSquare = parseInt(g[2]) * 2;
    const latSquare = parseInt(g[3]) * 1;
    let lat = latField + latSquare + 0.5;
    let lon = lonField + lonSquare + 1;
    if (g.length >= 6) {
      const lonSub = (g.charCodeAt(4) - 65) * (2 / 24);
      const latSub = (g.charCodeAt(5) - 65) * (1 / 24);
      lat = latField + latSquare + latSub + 1 / 48;
      lon = lonField + lonSquare + lonSub + 1 / 24;
    }
    locationRef.current = { lat, lon };
  }, [locator]);

  // Send heartbeat
  useEffect(() => {
    if (!sharePresence || !callsign || callsign === 'N0CALL' || !locationRef.current) return;

    const sendHeartbeat = async () => {
      if (!locationRef.current) return;
      if (Date.now() - lastHeartbeatAt < MIN_HEARTBEAT_SPACING) return;
      lastHeartbeatAt = Date.now();
      try {
        // Plain fetch, NOT apiFetch: the server 429s heartbeats that arrive
        // inside its per-IP lockout (second tab, shared IP, early wake-up),
        // and that expected, endpoint-specific throttle must not arm
        // apiFetch's global 30s backoff — it was freezing every panel in
        // the app each heartbeat cycle.
        await fetch('/api/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callsign,
            lat: locationRef.current.lat,
            lon: locationRef.current.lon,
            grid: locator || '',
          }),
        });
      } catch {
        // Not critical
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Remove presence immediately when the tab closes
    const handleUnload = () => {
      // navigator.sendBeacon is fire-and-forget — works even during unload
      const payload = JSON.stringify({ callsign });
      navigator.sendBeacon('/api/presence/leave', payload);
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
      // Remove presence immediately when stopping (toggle off or unmount)
      navigator.sendBeacon('/api/presence/leave', JSON.stringify({ callsign }));
    };
  }, [callsign, locator, sharePresence]);
}
