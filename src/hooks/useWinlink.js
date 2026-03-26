/**
 * useWinlink Hook
 * Polls Winlink plugin status and provides gateway discovery,
 * inbox/outbox retrieval, compose, and connect actions.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useVisibilityRefresh } from './useVisibilityRefresh';
import { apiFetch } from '../utils/apiFetch';

const STATUS_INTERVAL = 10000; // 10s status check
const MAIL_INTERVAL = 30000; // 30s mail refresh

export function useWinlink() {
  const [status, setStatus] = useState({ enabled: false, running: false });
  const [inbox, setInbox] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mailLoading, setMailLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/winlink/status');
      if (!res || !res.ok) return;
      const data = await res.json();
      if (mountedRef.current) {
        setStatus(data);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const fetchMail = useCallback(async () => {
    if (mountedRef.current) setMailLoading(true);
    try {
      const [inRes, outRes] = await Promise.all([apiFetch('/winlink/inbox'), apiFetch('/winlink/outbox')]);
      if (inRes?.ok) {
        const data = await inRes.json();
        if (mountedRef.current) setInbox(Array.isArray(data) ? data : []);
      }
      if (outRes?.ok) {
        const data = await outRes.json();
        if (mountedRef.current) setOutbox(Array.isArray(data) ? data : []);
      }
    } catch {}
    if (mountedRef.current) setMailLoading(false);
  }, []);

  const searchGateways = useCallback(async (grid, range, mode) => {
    try {
      const params = new URLSearchParams();
      if (grid) params.set('grid', grid);
      if (range) params.set('range', range);
      if (mode) params.set('mode', mode);
      const res = await apiFetch(`/winlink/gateways?${params}`);
      if (!res?.ok) return [];
      const data = await res.json();
      const list = data.gateways || [];
      if (mountedRef.current) setGateways(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const compose = useCallback(
    async ({ to, cc, subject, body }) => {
      try {
        const res = await apiFetch('/winlink/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, cc, subject, body }),
        });
        if (!res) return { error: 'Rate limited' };
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: err.error || `HTTP ${res.status}` };
        }
        await fetchMail();
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    },
    [fetchMail],
  );

  const connectGateway = useCallback(async (gateway, transport) => {
    try {
      const res = await apiFetch('/winlink/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gateway, transport }),
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

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();
    const statusTimer = setInterval(fetchStatus, STATUS_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(statusTimer);
    };
  }, [fetchStatus]);

  // Fetch mail when Pat becomes reachable
  useEffect(() => {
    if (!status.patEnabled || !status.patReachable) return;
    fetchMail();
    const timer = setInterval(fetchMail, MAIL_INTERVAL);
    return () => clearInterval(timer);
  }, [status.patEnabled, status.patReachable, fetchMail]);

  useVisibilityRefresh(fetchStatus, 5000);

  return {
    status,
    inbox,
    outbox,
    gateways,
    loading,
    mailLoading,
    refresh: fetchStatus,
    refreshMail: fetchMail,
    searchGateways,
    compose,
    connectGateway,
  };
}
