/**
 * useLogbook — React binding for the native logbook store.
 *
 * Subscribes to the shared logbookStore (IndexedDB-backed) and exposes the
 * QSO list plus CRUD, ADIF import/export, and simple stats. All instances
 * share the store's single cache, so a QSO logged from any panel shows up
 * everywhere immediately.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as logbookStore from '../services/logbookStore.js';
import { buildAdif, parseAdif } from '../utils/adif.js';

export const useLogbook = () => {
  const [qsos, setQsos] = useState(logbookStore.getAll());

  useEffect(() => logbookStore.subscribe(setQsos), []);

  const add = useCallback((fields) => logbookStore.add(fields), []);
  const update = useCallback((id, fields) => logbookStore.update(id, fields), []);
  const remove = useCallback((id) => logbookStore.remove(id), []);

  /**
   * Import ADIF text. Dedups against the existing log
   * (call + date + time-to-the-minute + band).
   * @returns {Promise<{ imported: number, skipped: number }>}
   */
  const importAdif = useCallback(async (text) => {
    const { qsos: parsed } = parseAdif(text);
    return logbookStore.addMany(parsed);
  }, []);

  /** Build ADI text for the whole log (newest data straight from the store). */
  const exportAdif = useCallback(({ myCall } = {}) => buildAdif(logbookStore.getAll(), { myCall }), []);

  const stats = useMemo(() => {
    const byBand = {};
    const byMode = {};
    for (const q of qsos) {
      if (q.band) byBand[q.band] = (byBand[q.band] || 0) + 1;
      if (q.mode) byMode[q.mode] = (byMode[q.mode] || 0) + 1;
    }
    return { total: qsos.length, byBand, byMode };
  }, [qsos]);

  return { qsos, add, update, remove, importAdif, exportAdif, stats };
};

export default useLogbook;
