/**
 * useSWPCAlerts Hook
 * Fetches recent NOAA SWPC space weather alerts/watches/warnings.
 * Refreshes every 5 minutes (matches the server-side cache TTL).
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useSWPCAlerts = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const response = await apiFetch('/api/swpc/alerts');
        if (response?.ok) {
          const alerts = await response.json();
          if (Array.isArray(alerts)) {
            setData(alerts);
            setError(null);
          }
        }
      } catch (err) {
        console.error('SWPC alerts error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
    fetchRef.current = fetchAlerts;
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 30000);

  return { data, loading, error };
};

export default useSWPCAlerts;
