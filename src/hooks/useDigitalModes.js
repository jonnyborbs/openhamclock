/**
 * useDigitalModes Hook
 * Polls status for all digital mode plugins (MSHV, JTDX, JS8Call)
 * and provides control actions (halt, freetext, reply, highlight).
 *
 * WSJT-X is handled separately by useWSJTX — this hook covers the
 * rig-bridge digital mode plugins that share the digital-mode-base.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

const POLL_INTERVAL = 5000; // 5s status check
const PLUGINS = ['mshv', 'jtdx', 'js8call'];

export function useDigitalModes() {
  const [statuses, setStatuses] = useState(() => {
    const init = {};
    for (const id of PLUGINS) init[id] = { enabled: false, running: false, connected: false };
    return init;
  });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchStatuses = useCallback(async () => {
    const results = {};
    await Promise.all(
      PLUGINS.map(async (id) => {
        try {
          const res = await apiFetch(`/api/${id}/status`);
          if (!res || !res.ok) {
            results[id] = { enabled: false, running: false, connected: false };
            return;
          }
          results[id] = await res.json();
        } catch {
          results[id] = { enabled: false, running: false, connected: false };
        }
      }),
    );
    if (mountedRef.current) {
      setStatuses(results);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatuses();
    const timer = setInterval(fetchStatuses, POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchStatuses]);

  useVisibilityRefresh(fetchStatuses, 5000);

  // Control actions
  const sendCommand = useCallback(async (pluginId, action, body = {}) => {
    try {
      const res = await apiFetch(`/api/${pluginId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res) return { error: 'Rate limited' };
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { error: err.error || `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  }, []);

  const haltTx = useCallback(
    (pluginId, autoTxOnly = false) => sendCommand(pluginId, 'halt', { autoTxOnly }),
    [sendCommand],
  );
  const sendFreeText = useCallback(
    (pluginId, text, send = true) => sendCommand(pluginId, 'freetext', { text, send }),
    [sendCommand],
  );
  const sendReply = useCallback((pluginId, message) => sendCommand(pluginId, 'reply', { message }), [sendCommand]);
  const highlightCall = useCallback(
    (pluginId, callsign, highlight = true) => sendCommand(pluginId, 'highlight', { callsign, highlight }),
    [sendCommand],
  );

  return {
    statuses,
    loading,
    plugins: PLUGINS,
    refresh: fetchStatuses,
    haltTx,
    sendFreeText,
    sendReply,
    highlightCall,
  };
}
