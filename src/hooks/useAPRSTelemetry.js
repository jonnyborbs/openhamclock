/**
 * useAPRSTelemetry Hook
 * Polls /api/aprs/telemetry for per-station APRS telemetry (analog channels,
 * digital bits, and server-kept history for trend charts).
 * Only polls while enabled (i.e. while a telemetry view is mounted).
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/apiFetch';

const POLL_INTERVAL = 30000; // telemetry beacons are slow (typically 1-10 min)

export const useAPRSTelemetry = (options = {}) => {
  const { enabled = true } = options;
  const [telemetry, setTelemetry] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;

    const fetchTelemetry = async () => {
      try {
        const res = await apiFetch('/api/aprs/telemetry', { cache: 'no-store' });
        if (alive && res?.ok) {
          const data = await res.json();
          setTelemetry(Array.isArray(data.telemetry) ? data.telemetry : []);
        }
      } catch {
        // keep last data on transient failure
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, POLL_INTERVAL);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);

  return { telemetry, loading };
};
