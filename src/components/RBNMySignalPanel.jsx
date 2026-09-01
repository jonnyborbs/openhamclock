/**
 * RBNMySignalPanel — "how's my signal": live Reverse Beacon Network
 * skimmer reports of YOUR callsign, grouped by band. Call CQ on CW/RTTY/
 * FT-modes and watch who hears you, where, and how loud. Uses the
 * existing /api/rbn/spots endpoint in dx mode (spots of this callsign).
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

const POLL_MS = 30 * 1000;
const WINDOW_MINUTES = 30;

const snrColor = (snr) => (snr >= 30 ? '#4ade80' : snr >= 15 ? '#fbbf24' : 'var(--text-secondary)');

const ageMin = (timestampMs, now) => Math.max(0, Math.round((now - timestampMs) / 60000));

export const RBNMySignalPanel = ({ config }) => {
  const callsign = (config?.callsign || '').toUpperCase();
  const hasCallsign = callsign && callsign !== 'N0CALL';

  const [spots, setSpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const fetchRef = useRef(null);

  useEffect(() => {
    if (!hasCallsign) {
      setLoading(false);
      return undefined;
    }
    const fetchSpots = async () => {
      try {
        const response = await apiFetch(
          `/api/rbn/spots?callsign=${encodeURIComponent(callsign)}&mode=dx&minutes=${WINDOW_MINUTES}`,
        );
        if (response?.ok) {
          const payload = await response.json();
          setSpots(payload.spots || []);
        }
      } catch (err) {
        console.error('RBN my-signal error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSpots();
    fetchRef.current = fetchSpots;
    const poll = setInterval(fetchSpots, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [callsign, hasCallsign]);

  // Group by band, newest first inside each band; strongest band first
  const byBand = new Map();
  for (const s of spots) {
    if (!byBand.has(s.band)) byBand.set(s.band, []);
    byBand.get(s.band).push(s);
  }
  const bands = [...byBand.entries()]
    .map(([band, list]) => ({
      band,
      list: list.sort((a, b) => b.timestampMs - a.timestampMs),
      best: Math.max(...list.map((s) => s.snr)),
    }))
    .sort((a, b) => b.best - a.best);

  const skimmers = new Set(spots.map((s) => s.callsign)).size;

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
        <span>MY SIGNAL (RBN)</span>
        {spots.length > 0 && (
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
            {skimmers} skimmer{skimmers === 1 ? '' : 's'} · {bands.length} band{bands.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
        {!hasCallsign ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            Set your callsign in Settings → Station to see who hears you
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px' }}>
            <div className="loading-spinner" />
          </div>
        ) : spots.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No skimmer reports of {callsign} in the last {WINDOW_MINUTES} min.
            <div style={{ marginTop: '4px', fontSize: '10px' }}>Call CQ on CW, RTTY, or FT modes and check back.</div>
          </div>
        ) : (
          bands.map(({ band, list }) => (
            <div key={band} style={{ marginBottom: '6px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--accent-cyan)',
                  fontWeight: 700,
                  padding: '2px 0',
                  borderBottom: '1px solid var(--border-color)',
                  marginBottom: '2px',
                }}
              >
                <span>{band}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {list.length} report{list.length === 1 ? '' : 's'}
                </span>
              </div>
              {list.slice(0, 8).map((s, i) => (
                <div
                  key={`${s.callsign}-${s.timestampMs}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '6px',
                    padding: '2px 4px',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {s.callsign}
                    {s.skimmerCountry && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>{s.skimmerCountry}</span>
                    )}
                  </span>
                  <span style={{ flexShrink: 0 }}>
                    <span style={{ color: snrColor(s.snr), fontWeight: 600 }}>{s.snr} dB</span>
                    {s.wpm != null && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' '}
                        · {s.wpm} {s.speedUnit || 'WPM'}
                      </span>
                    )}
                    <span style={{ color: 'var(--text-muted)' }}> · {ageMin(s.timestampMs, now)}m</span>
                  </span>
                </div>
              ))}
            </div>
          ))
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
        Reverse Beacon Network
      </div>
    </div>
  );
};

export default RBNMySignalPanel;
