/**
 * useEmcommData Hook
 * Polls NWS Alerts, FEMA Shelters, and FEMA Disaster Declarations.
 * Zero API calls when not in EmComm layout.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/apiFetch';

const ALERTS_INTERVAL = 3 * 60 * 1000; // 3 min
const SHELTERS_INTERVAL = 5 * 60 * 1000; // 5 min
const DISASTERS_INTERVAL = 15 * 60 * 1000; // 15 min

export const useEmcommData = (options = {}) => {
  const { location, enabled = false } = options;

  const [alerts, setAlerts] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [disasters, setDisasters] = useState([]);
  const [loading, setLoading] = useState(false);

  const locationRef = useRef(location);
  locationRef.current = location;

  const fetchAlerts = useCallback(async () => {
    const loc = locationRef.current;
    if (!loc?.lat || !loc?.lon) return;
    try {
      const res = await apiFetch(`/api/emcomm/alerts?lat=${loc.lat}&lon=${loc.lon}`, { cache: 'no-store' });
      if (res?.ok) {
        const data = await res.json();
        setAlerts(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('[EmComm] Alerts fetch error:', err);
    }
  }, []);

  const fetchShelters = useCallback(async () => {
    const loc = locationRef.current;
    if (!loc?.lat || !loc?.lon) return;
    try {
      const res = await apiFetch(`/api/emcomm/shelters?lat=${loc.lat}&lon=${loc.lon}&radius=200`, {
        cache: 'no-store',
      });
      if (res?.ok) {
        const data = await res.json();
        setShelters(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('[EmComm] Shelters fetch error:', err);
    }
  }, []);

  const fetchDisasters = useCallback(async () => {
    const loc = locationRef.current;
    // Derive state from location — use the config's state if available
    // For now, we pass the state via a simple reverse-geocode or fallback
    if (!loc?.state) return;
    try {
      const res = await apiFetch(`/api/emcomm/disasters?state=${encodeURIComponent(loc.state)}`, {
        cache: 'no-store',
      });
      if (res?.ok) {
        const data = await res.json();
        setDisasters(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('[EmComm] Disasters fetch error:', err);
    }
  }, []);

  // Poll all endpoints at different intervals
  useEffect(() => {
    if (!enabled) {
      // Clear data when disabled
      setAlerts([]);
      setShelters([]);
      setDisasters([]);
      return;
    }

    setLoading(true);

    // Initial fetch
    Promise.all([fetchAlerts(), fetchShelters(), fetchDisasters()]).finally(() => setLoading(false));

    const alertsTimer = setInterval(fetchAlerts, ALERTS_INTERVAL);
    const sheltersTimer = setInterval(fetchShelters, SHELTERS_INTERVAL);
    const disastersTimer = setInterval(fetchDisasters, DISASTERS_INTERVAL);

    return () => {
      clearInterval(alertsTimer);
      clearInterval(sheltersTimer);
      clearInterval(disastersTimer);
    };
  }, [enabled, fetchAlerts, fetchShelters, fetchDisasters]);

  return { alerts, shelters, disasters, loading };
};
