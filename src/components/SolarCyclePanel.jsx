/**
 * SolarCyclePanel — observed sunspot history vs the cycle-25 forecast
 * (dockable panel `solar-cycle`).
 *
 * Data from GET /api/solar-cycle (server-side 24h cache over NOAA SWPC's
 * observed-solar-cycle-indices + solar-cycle-25-ssn-predicted-range feeds):
 * monthly observed SSN (thin line) and smoothed SSN (bold line) since 2015,
 * the SWPC predicted range as a shaded band, and a "you are here" marker on
 * the latest observation. Inline SVG via src/utils/solarCycle.js — no chart
 * library, same idiom as the X-ray chart. Current SSN/SFI readout prefers
 * the live solar-indices feed and falls back to the latest monthly values.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildCycleChart } from '../utils/solarCycle.js';

const REFRESH_MS = 6 * 60 * 60 * 1000; // server caches 24h; 6h client poll is plenty

export const SolarCyclePanel = ({ solarIndices }) => {
  const { t } = useTranslation();
  const [cycle, setCycle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchCycle = async () => {
      try {
        const res = await fetch('/api/solar-cycle');
        if (res?.ok) {
          const data = await res.json();
          if (!cancelled) {
            setCycle(data);
            setError(false);
          }
        } else if (!cancelled) {
          setError(true);
        }
      } catch (err) {
        console.error('Solar cycle fetch error:', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCycle();
    const interval = setInterval(fetchCycle, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const observed = cycle?.observed || [];
  const predicted = cycle?.predicted || [];
  const chart = useMemo(() => buildCycleChart(observed, predicted, { width: 300, height: 130 }), [observed, predicted]);

  const lastObs = [...observed].reverse().find((d) => Number.isFinite(d.ssn)) || null;
  const currentSSN = solarIndices?.data?.ssn?.current ?? lastObs?.ssn ?? null;
  const currentSFI = solarIndices?.data?.sfi?.current ?? lastObs?.sfi ?? null;

  const readout = (label, value) => (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: '16px',
          fontWeight: '700',
          color: 'var(--accent-amber)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {value != null ? Math.round(value) : '—'}
      </div>
    </div>
  );

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          marginBottom: '6px',
          fontSize: '11px',
          color: 'var(--accent-primary)',
          fontWeight: '700',
        }}
      >
        📈 {t('solarCycle.title', { defaultValue: 'SOLAR CYCLE 25' })}
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
        {readout(t('solarCycle.currentSSN', { defaultValue: 'SSN' }), currentSSN)}
        {readout(t('solarCycle.currentSFI', { defaultValue: 'SFI' }), currentSFI)}
        {lastObs && (
          <div style={{ textAlign: 'center', flex: 1.4 }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {t('solarCycle.latestMonth', { defaultValue: 'Latest month' })}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                paddingTop: '3px',
              }}
            >
              {lastObs.t}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '10px', padding: '10px 4px' }}>
            {t('solarCycle.loading', { defaultValue: 'Loading solar cycle data…' })}
          </div>
        ) : chart.empty ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '10px', padding: '10px 4px', lineHeight: 1.5 }}>
            {error
              ? t('solarCycle.error', { defaultValue: 'Solar cycle data unavailable — NOAA SWPC not reachable.' })
              : t('solarCycle.empty', { defaultValue: 'No solar cycle data yet.' })}
          </div>
        ) : (
          <>
            <svg
              width="100%"
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={t('solarCycle.chartAria', {
                defaultValue: 'Monthly sunspot number: observed history and predicted range',
              })}
              style={{ background: 'var(--bg-tertiary)', borderRadius: '6px' }}
            >
              {/* Y grid + labels */}
              {chart.yTicks.map((tk) => (
                <g key={tk.label}>
                  <line
                    x1={chart.padL}
                    y1={tk.y}
                    x2={chart.padL + chart.chartW}
                    y2={tk.y}
                    stroke="var(--border-color, #444)"
                    strokeWidth="0.5"
                    strokeDasharray="3,3"
                    opacity={0.5}
                  />
                  <text
                    x={chart.padL - 3}
                    y={tk.y + 3}
                    fill="var(--text-muted, #888)"
                    fontSize="8"
                    fontFamily="var(--font-mono)"
                    textAnchor="end"
                  >
                    {tk.label}
                  </text>
                </g>
              ))}

              {/* X year labels */}
              {chart.xTicks.map((tk) => (
                <text
                  key={tk.label}
                  x={tk.x}
                  y={chart.height - 2}
                  fill="var(--text-muted, #888)"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                >
                  {tk.label}
                </text>
              ))}

              {/* Predicted range band */}
              {chart.bandPath && <path d={chart.bandPath} fill="var(--accent-cyan, #00bcd4)" opacity={0.15} />}

              {/* Observed monthly SSN (thin) */}
              {chart.ssnPath && (
                <path
                  d={chart.ssnPath}
                  fill="none"
                  stroke="var(--accent-amber, #ffaa00)"
                  strokeWidth="0.8"
                  opacity={0.55}
                />
              )}

              {/* Smoothed SSN (bold) */}
              {chart.smoothedPath && (
                <path d={chart.smoothedPath} fill="none" stroke="var(--accent-amber, #ffaa00)" strokeWidth="1.8" />
              )}

              {/* Peak observed label */}
              {chart.peak && (
                <text
                  x={Math.min(chart.peak.x, chart.padL + chart.chartW - 20)}
                  y={Math.max(chart.peak.y - 4, 8)}
                  fill="var(--text-secondary, #aaa)"
                  fontSize="7"
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                >
                  {t('solarCycle.peakLabel', { defaultValue: 'max {{ssn}}', ssn: Math.round(chart.peak.ssn) })}
                </text>
              )}

              {/* "You are here" marker */}
              {chart.marker && (
                <g>
                  <circle
                    cx={chart.marker.x}
                    cy={chart.marker.y}
                    r="3"
                    fill="var(--accent-green, #00ff88)"
                    stroke="var(--bg-tertiary, #000)"
                    strokeWidth="1"
                  />
                  <text
                    x={Math.min(chart.marker.x, chart.padL + chart.chartW - 34)}
                    y={Math.min(chart.marker.y + 12, chart.padT + chart.chartH - 2)}
                    fill="var(--accent-green, #00ff88)"
                    fontSize="7"
                    fontWeight="700"
                    fontFamily="var(--font-mono)"
                    textAnchor="middle"
                  >
                    {t('solarCycle.youAreHere', { defaultValue: 'you are here' })}
                  </text>
                </g>
              )}
            </svg>

            {/* Legend */}
            <div
              style={{
                display: 'flex',
                gap: '10px',
                justifyContent: 'center',
                flexWrap: 'wrap',
                fontSize: '9px',
                color: 'var(--text-muted)',
                marginTop: '4px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span>
                <span style={{ color: 'var(--accent-amber)' }}>━</span>{' '}
                {t('solarCycle.legendSmoothed', { defaultValue: 'smoothed SSN' })}
              </span>
              <span>
                <span style={{ color: 'var(--accent-amber)', opacity: 0.55 }}>─</span>{' '}
                {t('solarCycle.legendMonthly', { defaultValue: 'monthly' })}
              </span>
              <span>
                <span style={{ color: 'var(--accent-cyan)', opacity: 0.6 }}>▒</span>{' '}
                {t('solarCycle.legendPredicted', { defaultValue: 'predicted range' })}
              </span>
            </div>
          </>
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
        {t('solarCycle.footer', { defaultValue: 'NOAA SWPC · monthly values' })}
        {cycle?.stale ? ' · stale' : ''}
      </div>
    </div>
  );
};

export default SolarCyclePanel;
