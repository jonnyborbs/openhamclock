/**
 * useGroupLog — React binding for the shared multi-operator log session.
 *
 * Subscribes to groupLogSync (single module-level session shared by every
 * consumer) and exposes the session state, merged QSO list, and the
 * create / join / leave / export / import actions.
 */
import { useCallback, useEffect, useState } from 'react';
import * as groupLogSync from '../services/groupLogSync.js';

export const useGroupLog = () => {
  const [snapshot, setSnapshot] = useState(groupLogSync.getSnapshot());

  useEffect(() => {
    groupLogSync.init(); // resume a persisted session on first mount
    return groupLogSync.subscribe(setSnapshot);
  }, []);

  const create = useCallback((opts) => groupLogSync.createSession(opts), []);
  const join = useCallback((code, call, operatorName) => groupLogSync.joinSession(code, call, operatorName), []);
  const leave = useCallback(() => groupLogSync.leaveSession(), []);
  const exportAdif = useCallback(() => groupLogSync.exportGroupAdif(), []);
  const importToLogbook = useCallback(() => groupLogSync.importGroupToLogbook(), []);
  const findDupes = useCallback((call, band, mode) => groupLogSync.findGroupDupes(call, band, mode), []);

  return { ...snapshot, create, join, leave, exportAdif, importToLogbook, findDupes };
};

export default useGroupLog;
