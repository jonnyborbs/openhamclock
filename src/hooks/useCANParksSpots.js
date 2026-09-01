/**
 * useCANParksSpots Hook
 * Fetches CANParks (canparks.ca — Canadian parks program) activations via
 * server proxy. The server normalizes upstream field names and enriches
 * spots with coordinates/grid/name and POTA/WWFF cross-references from the
 * parks directory, so this hook only shapes rows for ActivatePanel.
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';
import { latLonToMaidenhead } from '../utils/geo';
import { getBandFromFreq } from '../utils';

export const useCANParksSpots = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const lastNewestSpotRef = useRef(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchCANParks = async () => {
      try {
        // Use server proxy for caching - reduces external API calls
        // Server sets Cache-Control: no-store; fetch no-store bypasses browser cache
        const res = await apiFetch('/api/canparks/spots', { cache: 'no-store' });
        if (res?.ok) {
          const payload = await res.json();
          // Server returns { ok, generated_at, count, spots } — accept a bare
          // array too so a future shape change degrades gracefully.
          const spots = Array.isArray(payload) ? payload : Array.isArray(payload?.spots) ? payload.spots : [];
          console.info(`[CANParks] Fetched ${spots.length} spots`);

          // Only mark as "updated" when data content actually changes
          let newestTime = null;
          if (spots.length > 0) {
            const times = spots
              .map((s) => s.time)
              .filter(Boolean)
              .sort()
              .reverse();
            newestTime = times[0] || null;
          }
          if (newestTime !== lastNewestSpotRef.current || lastNewestSpotRef.current === null) {
            lastNewestSpotRef.current = newestTime;
            setLastUpdated(Date.now());
          }

          // Filter out QRT spots and spots older than 60 minutes, newest first
          const validSpots = spots
            .filter((s) => {
              if (!s || !s.call) return false;
              if (/\bQRT\b/.test((s.comments || '').toUpperCase().trim())) return false;
              if (s.time) {
                const ageMs = Date.now() - new Date(s.time).getTime();
                if (Number.isFinite(ageMs) && ageMs > 60 * 60 * 1000) return false;
              }
              return true;
            })
            .sort((a, b) => {
              const timeA = a.time ? new Date(a.time).getTime() : 0;
              const timeB = b.time ? new Date(b.time).getTime() : 0;
              return timeB - timeA;
            });

          setData(
            validSpots.map((s) => {
              const lat = Number.isFinite(s.lat) ? s.lat : null;
              const lon = Number.isFinite(s.lon) ? s.lon : null;
              return {
                call: s.call,
                ref: s.ref || '',
                // Server already normalized to MHz (kHz/Hz detection included)
                freq: s.freq != null ? s.freq.toString() : '',
                band: getBandFromFreq(s.freq),
                mode: s.mode || '',
                name: s.name || '',
                comments: (s.comments || '').trim(),
                lat,
                lon,
                time: s.time ? s.time.substring(11, 16) + 'z' : '',
                isoTime: s.time || null,
                grid: s.grid || latLonToMaidenhead({ lat, lon }),
                // POTA cross-reference from the parks directory — rendered as
                // a muted chip so hunters see the dual-program overlap.
                potaRef: s.potaRef || null,
              };
            }),
          );
        } else {
          console.warn(`[CANParks] Fetch failed: ${res?.status || 'no response'} ${res?.statusText || ''}`);
        }
      } catch (err) {
        console.error('[CANParks] Fetch error:', err.message || err);
      } finally {
        setLastChecked(Date.now());
        setLoading(false);
      }
    };

    fetchCANParks();
    fetchRef.current = fetchCANParks;
    const interval = setInterval(fetchCANParks, 120 * 1000); // 2 minutes, same as POTA/WWFF
    return () => clearInterval(interval);
  }, []);

  // Refresh immediately when tab becomes visible (handles browser throttling)
  useVisibilityRefresh(() => fetchRef.current?.(), 10000);

  return { data, loading, lastUpdated, lastChecked };
};

export default useCANParksSpots;
