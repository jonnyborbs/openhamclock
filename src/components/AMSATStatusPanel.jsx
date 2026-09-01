/**
 * AMSATStatusPanel — the AMSAT satellite status board: which birds are
 * being heard, per community reports submitted at amsat.org. Pairs with
 * the Satellite Passes panel: passes tell you when, this tells you
 * whether the transponder is worth pointing at.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';

const POLL_MS = 30 * 60 * 1000;

const STATUS_STYLE = {
  Heard: { color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)' },
  'Crew Active': { color: 'var(--accent-cyan)', bg: 'rgba(34, 211, 238, 0.15)' },
  'Telemetry Only': { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)' },
  'Not Heard': { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
};

function relTime(iso, now) {
  if (!iso) return '—';
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const AMSATStatusPanel = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const fetchRef = useRef(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await apiFetch('/api/amsat/status');
        if (response?.ok) setData(await response.json());
      } catch (err) {
        console.error('AMSAT status error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
    fetchRef.current = fetchStatus;
    const poll = setInterval(fetchStatus, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);
  useVisibilityRefresh(() => fetchRef.current?.(), 60000);

  const heard = data?.satellites?.filter((s) => s.status === 'Heard' || s.status === 'Crew Active').length || 0;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        <span>AMSAT STATUS</span>
        {data && (
          <span
            style={{
              background: 'rgba(74, 222, 128, 0.2)',
              color: '#4ade80',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '9px',
              fontWeight: 700,
              border: '1px solid #4ade80',
            }}
          >
            {heard} active
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !data?.satellites?.length ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            AMSAT status unavailable
          </div>
        ) : (
          data.satellites.map((sat) => {
            const style = STATUS_STYLE[sat.status] || { color: 'var(--text-muted)', bg: 'transparent' };
            return (
              <div
                key={sat.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 6px',
                  marginBottom: '3px',
                  borderRadius: '4px',
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <span
                  style={{
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    flex: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {sat.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '9px', flexShrink: 0 }}>
                  {relTime(sat.statusTime, now)}
                </span>
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: style.bg,
                    color: style.color,
                    border: `1px solid ${style.color}`,
                    fontSize: '9px',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {sat.status.toUpperCase()}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
        }}
      >
        Community reports · amsat.org
      </div>
    </div>
  );
};

export default AMSATStatusPanel;
