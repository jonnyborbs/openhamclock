/**
 * WSPRMySpotsPanel — where your WSPR transmissions were received in the
 * last 24 h, via the wspr.live archive (proxied through /api/wspr/mine).
 * Antenna-test companion to the RBN panel: WSPR shows milliwatt-level
 * propagation the skimmers never see.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { useVisibilityRefresh } from '../hooks/useVisibilityRefresh';

const POLL_MS = 10 * 60 * 1000;

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export const WSPRMySpotsPanel = ({ config }) => {
  const callsign = (config?.callsign || '').toUpperCase();
  const hasCallsign = callsign && callsign !== 'N0CALL';
  const useMiles = (config?.allUnits?.dist ?? 'metric') === 'imperial';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(null);

  useEffect(() => {
    if (!hasCallsign) {
      setLoading(false);
      return undefined;
    }
    const fetchSpots = async () => {
      try {
        const response = await apiFetch(`/api/wspr/mine?callsign=${encodeURIComponent(callsign)}`);
        if (response?.ok) setData(await response.json());
      } catch (err) {
        console.error('WSPR my-spots error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSpots();
    fetchRef.current = fetchSpots;
    const id = setInterval(fetchSpots, POLL_MS);
    return () => clearInterval(id);
  }, [callsign, hasCallsign]);
  useVisibilityRefresh(() => fetchRef.current?.(), 60000);

  const dist = (km) => (useMiles ? `${Math.round(km * 0.621371)} mi` : `${km} km`);
  const stats = data?.stats;

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
        <span>WSPR — MY SPOTS</span>
        {data?.count > 0 && (
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
            {data.count} rx · 24h
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {!hasCallsign ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            Set your callsign in Settings → Station to see your WSPR receptions
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : !data || data.count === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No receptions of {callsign} in the last 24 h.
            <div style={{ marginTop: '4px', fontSize: '10px' }}>Beacon on WSPR and check back.</div>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 6px',
                marginBottom: '4px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.03)',
                color: 'var(--text-secondary)',
              }}
            >
              <span>
                {stats.uniqueReceivers} receiver{stats.uniqueReceivers === 1 ? '' : 's'}
              </span>
              <span>
                best DX <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{dist(stats.maxKm)}</span>
                {stats.bestRx && <span style={{ color: 'var(--text-muted)' }}> ({stats.bestRx})</span>}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
              {Object.entries(stats.bands).map(([band, count]) => (
                <span
                  key={band}
                  style={{
                    padding: '1px 6px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                    fontSize: '9px',
                  }}
                >
                  {band} <span style={{ color: 'var(--accent-cyan)' }}>{count}</span>
                </span>
              ))}
            </div>

            {data.spots.slice(0, 60).map((s, i) => (
              <div
                key={`${s.rx}-${s.time}-${i}`}
                style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', padding: '2px 4px' }}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtTime(s.time)}</span>
                <span
                  style={{
                    color: 'var(--text-primary)',
                    flex: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.rx} <span style={{ color: 'var(--text-muted)' }}>{s.loc}</span>
                </span>
                <span style={{ flexShrink: 0 }}>
                  <span style={{ color: 'var(--accent-purple)' }}>{s.band}</span>
                  <span style={{ color: s.snr >= -10 ? '#4ade80' : 'var(--text-secondary)' }}> {s.snr} dB</span>
                  <span style={{ color: 'var(--text-muted)' }}> · {dist(s.km)}</span>
                </span>
              </div>
            ))}
          </>
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
        Data: wspr.live
      </div>
    </div>
  );
};

export default WSPRMySpotsPanel;
