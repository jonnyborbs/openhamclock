/**
 * useCallsignLookup — fetches station info for a callsign.
 *
 * Returns { data, loading, error }
 * data shape: { callsign, name, grid, country, state, county,
 *               lat, lon, cqZone, ituZone, geoloc, source }
 *
 * Uses an in-memory cache to avoid redundant requests.
 * Falls back gracefully to ctyLookup data if the API is unavailable.
 *
 * Usage:
 *   const { data, loading } = useCallsignLookup('K1ABC');
 *   // data is null on first load, then populated on resolve
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/apiFetch.js';
import { callbookAuthHeaders } from '../../utils/callbookAuth.js';
import { extractBaseCall } from '../../components/CallsignLink.jsx';

// TTL: 24 hours (matches server-side cache TTL)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// LRU cache: Map keeps insertion order; first key = least recently used.
const cache = new Map(); // callsign → { data, timestamp }
const CACHE_MAX = 500;

function setCachedCall(callsign, data) {
  // Move existing entry to end (most recently used)
  if (cache.has(callsign)) {
    const entry = cache.get(callsign);
    cache.delete(callsign);
  }

  // Evict LRU if at cap
  if (cache.size >= CACHE_MAX) {
    const lruKey = cache.keys().next().value;
    if (lruKey) cache.delete(lruKey);
  }

  cache.set(callsign, { data, timestamp: Date.now() });
}

function getCachedCall(callsign) {
  const entry = cache.get(callsign);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(callsign);
    return null;
  }
  // Move to end = most recently used (LRU)
  cache.delete(callsign);
  cache.set(callsign, entry);
  return entry;
}

export default function useCallsignLookup(call) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchInProgress = useRef(false);

  const fetchCall = useCallback(async (callsign) => {
    if (!callsign || fetchInProgress.current) return;
    fetchInProgress.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/callsign/${encodeURIComponent(callsign)}`, {
        headers: callbookAuthHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res) {
        // Backoff — don't treat as error
        setData(null);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setData(null);
        setError(`HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      const result = await res.json();
      setData(result);
      setCachedCall(callsign, result);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
      fetchInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    const baseCall = extractBaseCall(call);
    if (!baseCall) return;

    const cached = getCachedCall(baseCall);
    if (cached) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    fetchCall(baseCall);
  }, [call, fetchCall]);

  return { data, loading, error };
}
