/**
 * MeteorShowerPanel Component
 * Annual meteor showers for meteor-scatter (MSK144) operators: showers sorted
 * by proximity to peak, with active/peaking badges, ZHR, days-to-peak, and
 * current radiant elevation from the DE location. Showers with the radiant
 * above the horizon are highlighted — that's when MS propagation works.
 */
import { useState, useEffect } from 'react';
import { getShowerStatus } from '../utils/meteorShowers.js';

const formatDaysToPeak = (shower) => {
  if (shower.peaking) return 'PEAKING NOW';
  const d = shower.daysToPeak;
  if (d < 0) return `peak ${Math.abs(d).toFixed(0)}d ago`;
  if (d < 1) return `peak in ${Math.round(d * 24)}h`;
  return `peak in ${Math.round(d)}d`;
};

export const MeteorShowerPanel = ({ deLat, deLon }) => {
  const [now, setNow] = useState(() => new Date());

  // Radiant elevation changes ~0.25°/min — refresh once a minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const showers = getShowerStatus(now, deLat, deLon);
  const activeCount = showers.filter((s) => s.active).length;
  const hasLocation = Number.isFinite(deLat) && Number.isFinite(deLon);

  return (
    <div
      className="panel"
      style={{
        padding: '8px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
        <span>☄️ METEOR SHOWERS</span>
        {activeCount > 0 && (
          <span
            style={{
              background: 'rgba(74, 222, 128, 0.2)',
              color: '#4ade80',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '9px',
              fontWeight: '700',
              border: '1px solid #4ade80',
            }}
          >
            {activeCount} ACTIVE
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
          {showers.map((shower) => {
            const up = hasLocation && shower.elevation !== null && shower.elevation > 0;
            return (
              <div
                key={shower.code}
                style={{
                  padding: '5px 6px',
                  marginBottom: '3px',
                  borderRadius: '4px',
                  background: shower.peaking
                    ? 'rgba(239, 68, 68, 0.15)'
                    : up && shower.active
                      ? 'rgba(74, 222, 128, 0.1)'
                      : 'rgba(255,255,255,0.03)',
                  border: shower.peaking
                    ? '1px solid rgba(239, 68, 68, 0.4)'
                    : up && shower.active
                      ? '1px solid rgba(74, 222, 128, 0.3)'
                      : '1px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      color: shower.peaking ? '#ef4444' : 'var(--text-primary)',
                      fontWeight: '600',
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={`${shower.name} (${shower.code}) — radiant RA ${shower.ra}° Dec ${shower.dec}°, ${shower.speed} km/s`}
                  >
                    {shower.name}
                  </span>
                  <span
                    style={{
                      background: shower.peaking
                        ? 'rgba(239, 68, 68, 0.3)'
                        : shower.active
                          ? 'rgba(74, 222, 128, 0.2)'
                          : 'var(--bg-tertiary)',
                      color: shower.peaking ? '#ef4444' : shower.active ? '#4ade80' : 'var(--text-muted)',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      fontSize: '8px',
                      fontWeight: '700',
                      flexShrink: 0,
                    }}
                  >
                    {shower.peaking ? 'PEAK' : shower.active ? 'ACTIVE' : 'UPCOMING'}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '3px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>
                    ZHR <span style={{ color: 'var(--accent-amber)', fontWeight: '600' }}>{shower.zhr}</span>
                    {shower.variable ? '±' : ''}
                    <span style={{ marginLeft: '6px' }}>{shower.speed} km/s</span>
                  </span>
                  <span
                    style={{
                      color: shower.peaking ? '#ef4444' : shower.daysToPeak <= 7 ? '#fbbf24' : 'var(--text-muted)',
                      fontWeight: shower.peaking ? '700' : '400',
                    }}
                  >
                    {formatDaysToPeak(shower)}
                  </span>
                </div>
                {hasLocation && shower.elevation !== null && (
                  <div style={{ marginTop: '2px', fontSize: '9px' }}>
                    <span style={{ color: up ? '#4ade80' : 'var(--text-muted)' }}>
                      {up ? '▲' : '▽'} radiant {up ? 'up' : 'down'}: {shower.elevation.toFixed(0)}° el @{' '}
                      {shower.azimuth.toFixed(0)}° az
                    </span>
                    {up && shower.active && (
                      <span style={{ color: '#4ade80', fontWeight: '600', marginLeft: '6px' }}>MS possible</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          textAlign: 'right',
          fontSize: '9px',
          color: 'var(--text-muted)',
        }}
      >
        IMO working list · radiant from DE
      </div>
    </div>
  );
};

export default MeteorShowerPanel;
