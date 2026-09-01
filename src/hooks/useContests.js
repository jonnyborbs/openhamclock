/**
 * useContests Hook
 * Fetches upcoming amateur radio contests
 */
import { useState, useEffect, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

export const useContests = () => {
  const [data, setData] = useState([]);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchContests = async () => {
      try {
        const response = await apiFetch('/api/contests');
        if (response?.ok) {
          const payload = await response.json();
          // Envelope { contests, source, fetchedAt }; tolerate the legacy bare array
          setData(Array.isArray(payload) ? payload : payload.contests || []);
          setSource(Array.isArray(payload) ? null : payload.source || null);
        }
      } catch (err) {
        console.error('Contests error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchContests();
    fetchRef.current = fetchContests;
    const interval = setInterval(fetchContests, 30 * 60 * 1000); // 30 minutes
    return () => clearInterval(interval);
  }, []);

  useVisibilityRefresh(() => fetchRef.current?.(), 30000);

  return { data, loading, source };
};

export default useContests;
