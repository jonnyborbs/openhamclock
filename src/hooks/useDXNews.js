/**
 * useDXNews — shared fetch for the merged multi-source DX news feed.
 *
 * One code path over GET /api/dxnews (dxnews.com + dx-world.net + NG3K,
 * merged/deduped/capped server-side) for every consumer: the scrolling
 * DXNewsTicker and the DX News reader panel. Refreshes every 30 minutes —
 * the server caches upstream, so per-consumer fetching stays cheap.
 *
 * Item shape (see server/utils/dxNewsMerge.js):
 *   { id, title, description, url, publishDate, callsign, source, sourceUrl }
 */
import { useEffect, useState } from 'react';

const REFRESH_MS = 30 * 60 * 1000;

export const useDXNews = (enabled = true) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const fetchNews = async () => {
      try {
        const res = await fetch('/api/dxnews');
        if (res?.ok) {
          const data = await res.json();
          if (!cancelled) setItems(Array.isArray(data?.items) ? data.items : []);
        }
      } catch (err) {
        console.error('DX News fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchNews();
    const interval = setInterval(fetchNews, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return { items, loading };
};

export default useDXNews;
