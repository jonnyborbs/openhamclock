/**
 * useBandOpenings Hook
 * Polls GET /api/band-openings (server-side surge detection over the RBN and
 * DX-cluster spot streams — see server/routes/band-openings.js) every 75 s.
 *
 * Returns:
 *   data       — the raw payload { generated_at, warming, openings, … }
 *   alertItems — openings shaped for the audio-alert engine. Each live
 *                (band × path) episode carries the hour bucket in which this
 *                client FIRST saw it, so the alert item key
 *                (band+from+to+firstSeenHour) stays stable for the episode's
 *                whole lifetime — one alert per opening, no re-alerts as the
 *                state machine moves opening → active → closing. Items are
 *                suppressed entirely while the server baseline is warming.
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

const POLL_INTERVAL_MS = 75 * 1000; // between the server's 60 s recompute and 90 s

export const useBandOpenings = () => {
  const [data, setData] = useState(null);
  const [alertItems, setAlertItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);
  // (band|from|to) → hour bucket when this client first observed the episode
  const firstSeenRef = useRef(new Map());

  useEffect(() => {
    const fetchOpenings = async () => {
      try {
        const res = await apiFetch('/api/band-openings', { cache: 'no-store' });
        if (res?.ok) {
          const payload = await res.json();
          setData(payload);

          const items = [];
          if (payload && !payload.warming && Array.isArray(payload.openings)) {
            const generatedMs = Date.parse(payload.generated_at || '') || Date.now();
            const hourBucket = Math.floor(generatedMs / (60 * 60 * 1000));
            const live = new Set();
            for (const o of payload.openings) {
              if (!o || !o.band) continue;
              const key = `${o.band}|${o.from_continent}|${o.to_continent}`;
              live.add(key);
              if (!firstSeenRef.current.has(key)) firstSeenRef.current.set(key, hourBucket);
              // Every live state is kept in the item list (closing included)
              // so brief opening↔closing flapping never re-alerts; the alert
              // fires once, when the episode's key first appears.
              items.push({ ...o, firstSeenHour: firstSeenRef.current.get(key) });
            }
            // Episodes that left the payload entirely (past the closing
            // linger) can re-alert if the path surges again later.
            for (const key of firstSeenRef.current.keys()) {
              if (!live.has(key)) firstSeenRef.current.delete(key);
            }
          }
          setAlertItems(items);
        }
      } catch (err) {
        console.error('Band openings error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOpenings();
    fetchRef.current = fetchOpenings;
    const interval = setInterval(fetchOpenings, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), POLL_INTERVAL_MS);

  return { data, alertItems, loading };
};

export default useBandOpenings;
