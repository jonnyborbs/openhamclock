/**
 * useTimezone — cache timezone by grid, format local time with Intl.
 *
 * Fetches the timezone for a grid square from the geo-time API.
 * Caches the result in-memory (24h TTL, max 500 entries) so repeated
 * lookups are instant.
 *
 * Returns { localTime } where localTime is a formatted HH:MM string,
 * or null if no grid or fetch failed.
 *
 * Usage:
 *   const { localTime } = useTimezone('FN20');
 *   // localTime is null on first mount, updates after API resolves
 */
import { useState, useEffect } from 'react';

// ── Timezone cache (module-level, survives remounts) ──────────────────
// LRU eviction: Map keeps insertion/access order; first key = least recently used.
const tzCache = new Map(); // grid → { timezone, timestamp }
const TZ_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const TZ_CACHE_MAX = 500; // max entries

function getCachedTz(grid) {
  const entry = tzCache.get(grid);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TZ_CACHE_TTL) {
    tzCache.delete(grid);
    return null;
  }
  // Move to end = most recently used (LRU)
  tzCache.delete(grid);
  tzCache.set(grid, entry);
  return entry.timezone;
}

function setCachedTz(grid, timezone) {
  if (tzCache.size >= TZ_CACHE_MAX) {
    // Evict least recently used (first entry in Map order)
    const lruKey = tzCache.keys().next().value;
    if (lruKey) tzCache.delete(lruKey);
  }
  tzCache.set(grid, { timezone, timestamp: Date.now() });
}

function formatLocalTime(timezone) {
  if (!timezone) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(new Date());
}

export default function useTimezone(grid) {
  const [localTime, setLocalTime] = useState(null);

  useEffect(() => {
    if (!grid) {
      setLocalTime(null);
      return;
    }

    // Check cache first
    const cached = getCachedTz(grid);
    if (cached) {
      setLocalTime(formatLocalTime(cached));
      return;
    }

    // Cache miss — fetch timezone from API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch(`/api/geo-time?grid=${encodeURIComponent(grid)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((result) => {
        if (result.timezone) {
          setCachedTz(grid, result.timezone);
          setLocalTime(formatLocalTime(result.timezone));
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      controller.abort();
    };
  }, [grid]);

  return { localTime };
}
