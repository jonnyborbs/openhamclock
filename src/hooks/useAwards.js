/**
 * useAwards Hook
 *
 * Award progress (DXCC / WAZ / WAS / VUCC) computed from the native logbook,
 * shared across all consumers through one module-level store — the Awards
 * panel and every spot panel see the same object, recomputed once per log
 * change instead of once per panel.
 *
 * Zero-config: with an empty logbook the awards object is empty and
 * getSpotStatus returns null for every call, so nothing renders.
 *
 * Recompute triggers:
 *   - logbookStore subscription (push — a QSO logged anywhere updates awards
 *     immediately)
 *   - the `openhamclock-cty-loaded` event (entity resolution only works once
 *     cty.dat arrives, so the first compute may see zero resolvable calls)
 */
import { useCallback, useEffect, useState } from 'react';
import { computeAwards, spotAwardStatus } from '../utils/awards.js';
import { getAll as getLogbookQsos, subscribe as subscribeLogbook } from '../services/logbookStore.js';

const store = {
  awards: computeAwards([]),
  subscribers: new Set(),
  unsubscribeLogbook: null,
  ctyListener: null,
};

const rebuild = () => {
  store.awards = computeAwards(getLogbookQsos());
  store.subscribers.forEach((cb) => cb(store.awards));
};

const subscribe = (cb) => {
  store.subscribers.add(cb);
  if (!store.unsubscribeLogbook) {
    store.unsubscribeLogbook = subscribeLogbook(() => rebuild());
    store.ctyListener = () => rebuild();
    window.addEventListener('openhamclock-cty-loaded', store.ctyListener);
  }
  cb(store.awards);
  return () => {
    store.subscribers.delete(cb);
    if (store.subscribers.size === 0 && store.unsubscribeLogbook) {
      store.unsubscribeLogbook();
      store.unsubscribeLogbook = null;
      window.removeEventListener('openhamclock-cty-loaded', store.ctyListener);
      store.ctyListener = null;
    }
  };
};

export const useAwards = () => {
  const [awards, setAwards] = useState(store.awards);

  useEffect(() => subscribe(setAwards), []);

  /**
   * getSpotStatus(call, freq?) → 'new' | 'new-band' | null
   * 'new' = ATNO (entity not in the log), 'new-band' = entity worked but not
   * on this band. freq may be MHz, kHz, or Hz.
   */
  const getSpotStatus = useCallback((call, freq) => spotAwardStatus(awards, call, freq), [awards]);

  return { awards, hasData: awards.totalQsos > 0, getSpotStatus };
};

export default useAwards;
