/**
 * IonosondePanel — live foF2 / MUF(3000) from nearby digisondes
 * (dockable panel `ionosonde`).
 *
 * Data from GET /api/ionosonde (server-side 10-min cache over KC2G's
 * prop API — GIRO digisonde measurements). Stations are sorted by distance
 * from DE; the nearest one gets a "your local ionosphere" summary line with
 * an NVIS usability hint (from foF2) and a highest-open-band hint (from
 * MUF(3000)). These are measurements, not model output — the ground truth
 * the VOACAP panel's predictions try to approximate.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistance } from '../utils/geo.js';
import { sortStationsByDistance, stationAgeMinutes, formatAge, nvisHint, mufBandHint } from '../utils/ionosonde.js';

const REFRESH_MS = 5 * 60 * 1000; // server caches 10 min; 5-min poll picks changes up promptly
const MAX_ROWS = 12;

export const IonosondePanel = ({ deLocation, units = 'imperial' }) => {
  const { t } = useTranslation();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const fetchStations = async () => {
      try {
        const res = await fetch('/api/ionosonde');
        if (res?.ok) {
          const data = await res.json();
          if (!cancelled) {
            setPayload(data);
            setError(false);
          }
        } else if (!cancelled) {
          setError(true);
        }
      } catch (err) {
        console.error('Ionosonde fetch error:', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setNowMs(Date.now());
        }
      }
    };
    fetchStations();
    const interval = setInterval(fetchStations, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const stations = useMemo(
    () => sortStationsByDistance(payload?.stations || [], deLocation).slice(0, MAX_ROWS),
    [payload, deLocation?.lat, deLocation?.lon],
  );
  const nearest = stations[0] || null;

  const nvisText = (key) =>
    ({
      nvis40: t('ionosonde.nvis40', { defaultValue: 'NVIS good on 40m + 80m' }),
      nvis80strong: t('ionosonde.nvis80strong', { defaultValue: 'NVIS solid on 80m, 40m marginal' }),
      nvis80: t('ionosonde.nvis80', { defaultValue: 'NVIS on 80m only' }),
      nvis160: t('ionosonde.nvis160', { defaultValue: 'NVIS marginal — 160m territory' }),
    })[key] || null;

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: '6px', fontSize: '11px', color: 'var(--accent-primary)', fontWeight: '700' }}>
        📡 {t('ionosonde.title', { defaultValue: 'IONOSONDES' })}
        {payload?.stale && (
          <span
            title={t('ionosonde.staleTooltip', { defaultValue: 'Upstream unreachable — showing last good data' })}
            style={{
              marginLeft: '6px',
              fontSize: '9px',
              fontWeight: '600',
              color: 'var(--accent-amber)',
              border: '1px solid var(--accent-amber)',
              borderRadius: '4px',
              padding: '0 4px',
            }}
          >
            {t('ionosonde.stale', { defaultValue: 'stale' })}
          </span>
        )}
      </div>

      {/* "Your local ionosphere" summary — nearest station */}
      {nearest && (
        <div
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '5px 8px',
            marginBottom: '6px',
            fontSize: '10px',
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>
            {t('ionosonde.localSummary', { defaultValue: 'Your local ionosphere' })}
            <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>
              {' '}
              — {nearest.name} · {formatDistance(nearest.distanceKm, units)}
            </span>
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            foF2{' '}
            <span style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)', fontWeight: '700' }}>
              {nearest.fof2.toFixed(1)} MHz
            </span>
            {nvisText(nvisHint(nearest.fof2)) && <span> → {nvisText(nvisHint(nearest.fof2))}</span>}
          </div>
          {nearest.mufd != null && (
            <div style={{ color: 'var(--text-secondary)' }}>
              MUF(3000){' '}
              <span style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontWeight: '700' }}>
                {nearest.mufd.toFixed(1)} MHz
              </span>
              {mufBandHint(nearest.mufd) && (
                <span>
                  {' '}
                  →{' '}
                  {t('ionosonde.mufHint', {
                    defaultValue: 'DX workable up through {{band}}',
                    band: mufBandHint(nearest.mufd),
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '10px', padding: '10px 4px' }}>
            {t('ionosonde.loading', { defaultValue: 'Loading ionosonde data…' })}
          </div>
        ) : stations.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '10px', padding: '10px 4px', lineHeight: 1.5 }}>
            {error
              ? t('ionosonde.error', { defaultValue: 'Ionosonde data unavailable — prop.kc2g.com not reachable.' })
              : t('ionosonde.empty', { defaultValue: 'No live ionosonde measurements right now.' })}
          </div>
        ) : (
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', fontFamily: 'var(--font-mono)' }}
          >
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: '400' }}>
                  {t('ionosonde.colStation', { defaultValue: 'Station' })}
                </th>
                <th style={{ padding: '2px 4px', fontWeight: '400' }}>
                  {t('ionosonde.colDist', { defaultValue: 'Dist' })}
                </th>
                <th style={{ padding: '2px 4px', fontWeight: '400' }}>foF2</th>
                <th style={{ padding: '2px 4px', fontWeight: '400' }}>MUF</th>
                <th style={{ padding: '2px 4px', fontWeight: '400' }}>
                  {t('ionosonde.colAge', { defaultValue: 'Age' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s, i) => {
                const age = stationAgeMinutes(s.time, nowMs);
                return (
                  <tr
                    key={s.code}
                    title={`${s.code} · ${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°${s.cs != null ? ` · CS ${s.cs}` : ''}`}
                    style={{
                      color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: i === 0 ? 'rgba(0,255,255,0.06)' : 'transparent',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <td
                      style={{
                        padding: '2px 4px',
                        maxWidth: '110px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {i === 0 ? '📍 ' : ''}
                      {s.name}
                    </td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {formatDistance(s.distanceKm, units)}
                    </td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', color: 'var(--accent-amber)' }}>
                      {s.fof2.toFixed(1)}
                    </td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', color: 'var(--accent-green)' }}>
                      {s.mufd != null ? s.mufd.toFixed(1) : '—'}
                    </td>
                    <td
                      style={{
                        padding: '2px 4px',
                        textAlign: 'right',
                        color: age != null && age > 60 ? 'var(--accent-amber)' : 'var(--text-muted)',
                      }}
                    >
                      {formatAge(age)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
          paddingTop: '2px',
        }}
      >
        {t('ionosonde.footer', { defaultValue: 'data via prop.kc2g.com (GIRO ionosondes)' })}
      </div>
    </div>
  );
};

export default IonosondePanel;
