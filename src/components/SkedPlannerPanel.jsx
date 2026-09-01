/**
 * SkedPlannerPanel — best times to work the current DX target over the next
 * 48 hours (dockable panel `sked-planner`).
 *
 * Reuses the SAME prediction pipeline as the VOACAP panel: the parent's
 * usePropagation hook (browser WASM P.533 engine, REST/heuristic fallback)
 * already computes 24 hourly reliabilities per band for DE↔DX with the
 * user's mode/power/antenna. This panel never re-predicts — it re-shapes
 * that 24h diurnal cycle into a 48h band × hour grid (tiled twice, labeled
 * honestly), annotates both stations' local time and sunrise/sunset, and
 * highlights the top three contact windows. Mode/power controls write the
 * shared propagation config, so this panel, the VOACAP panel, and the map
 * heatmap always agree.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateSunTimes, calculateDistance, formatDistance } from '../utils/geo.js';
import { saveConfig, loadConfig } from '../utils/config.js';
import {
  SKED_BANDS,
  SKED_HOURS,
  tile48,
  findBestWindows,
  windowLabel,
  parseSunHHMM,
  localHourAt,
} from '../utils/skedPlanner.js';

const MODES = ['SSB', 'CW', 'FT8', 'FT4', 'WSPR', 'JS8', 'RTTY', 'AM'];
const POWERS = [5, 10, 25, 50, 100, 200, 500, 1000, 1500];

// Stoplight reliability scale — same stops as the VOACAP chart's default scheme.
const heatColor = (rel) => {
  if (rel >= 80) return '#00cc00';
  if (rel >= 60) return '#55bb00';
  if (rel >= 40) return '#ffcc00';
  if (rel >= 20) return '#ff6600';
  if (rel >= 10) return '#cc2200';
  return '#441111';
};

const pad2 = (n) => String(n).padStart(2, '0');

export const SkedPlannerPanel = ({
  propagation,
  loading,
  deLocation,
  dxLocation,
  dxCallsign,
  propConfig = {},
  timeZone,
  dxTimezone,
  dxSolarFallback,
  allUnits = { dist: 'imperial' },
}) => {
  const { t } = useTranslation();

  // Track the current UTC hour so the grid rolls forward without a reload.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => clearInterval(iv);
  }, []);
  const startHour = new Date(nowMs).getUTCHours();

  // Mode/power write the SHARED propagation config (same path as the VOACAP
  // panel's inline controls) — saveConfig fires openhamclock-config-change,
  // App updates config.propagation, and usePropagation re-runs the engine.
  const updatePropConfig = useCallback((updates) => {
    const cfg = loadConfig();
    cfg.propagation = { ...cfg.propagation, ...updates };
    saveConfig(cfg);
  }, []);
  const mode = propConfig.mode || 'SSB';
  const power = propConfig.power || 100;

  const hourly = propagation?.hourlyPredictions;
  const tiled = useMemo(() => tile48(hourly, startHour), [hourly, startHour]);
  const bands = SKED_BANDS.filter((b) => tiled[b]);

  const windows = useMemo(() => findBestWindows(tiled), [tiled]);

  // Cell membership in a top window (for the highlight outline). Windows are
  // found in day 1; mark the diurnal repeat in day 2 too.
  const windowCells = useMemo(() => {
    const set = new Set();
    windows.forEach((w) => {
      for (let o = w.startOffset; o <= w.endOffset; o++) {
        set.add(`${w.band}:${o}`);
        if (o + 24 < SKED_HOURS) set.add(`${w.band}:${o + 24}`);
      }
    });
    return set;
  }, [windows]);

  // Sunrise/sunset markers per offset column, for DE and DX. Recomputed per
  // slot day so day-2 markers use tomorrow's (slightly shifted) sun times.
  const sunMarks = useMemo(() => {
    const marks = { de: {}, dx: {} };
    const mark = (who, loc) => {
      if (!loc || !Number.isFinite(loc.lat)) return;
      for (const dayOffset of [0, 1, 2]) {
        const date = new Date(nowMs + dayOffset * 86400_000);
        const st = calculateSunTimes(loc.lat, loc.lon, date);
        for (const [key, glyph] of [
          ['sunrise', '☀'],
          ['sunset', '☾'],
        ]) {
          const frac = parseSunHHMM(st[key]);
          if (frac == null) continue;
          const utcHour = Math.floor(frac);
          // Which offset column does this day's event land in?
          const dayStart = Math.floor((nowMs - startHour * 3600_000) / 86400_000);
          const eventDay = Math.floor(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400_000,
          );
          const offset = (eventDay - dayStart) * 24 + utcHour - startHour;
          if (offset >= 0 && offset < SKED_HOURS && !marks[who][offset]) {
            marks[who][offset] = { glyph, time: st[key] };
          }
        }
      }
    };
    mark('de', deLocation);
    mark('dx', dxLocation);
    return marks;
  }, [nowMs, startHour, deLocation?.lat, deLocation?.lon, dxLocation?.lat, dxLocation?.lon]);

  const distanceKm =
    deLocation && dxLocation ? calculateDistance(deLocation.lat, deLocation.lon, dxLocation.lat, dxLocation.lon) : null;

  const dxTz = dxTimezone ?? dxSolarFallback?.tz ?? null;

  const header = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '4px',
        fontSize: '11px',
        color: 'var(--accent-primary)',
        fontWeight: '700',
        gap: '6px',
        flexWrap: 'wrap',
      }}
    >
      <span>
        🤝 {t('skedPlanner.title', { defaultValue: 'SKED PLANNER' })}
        <span style={{ color: 'var(--accent-amber)', marginLeft: '6px' }}>
          {dxCallsign || t('skedPlanner.dxLabel', { defaultValue: 'DX' })}
        </span>
        {distanceKm != null && (
          <span style={{ color: 'var(--text-muted)', fontWeight: '400', marginLeft: '6px' }}>
            {formatDistance(distanceKm, allUnits.dist)}
          </span>
        )}
      </span>
      <span style={{ display: 'inline-flex', gap: '4px' }}>
        <select
          value={mode}
          onChange={(e) => updatePropConfig({ mode: e.target.value })}
          title={t('skedPlanner.modeTitle', { defaultValue: 'Prediction mode (shared with VOACAP panel)' })}
          style={selStyle}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={POWERS.includes(power) ? power : 100}
          onChange={(e) => updatePropConfig({ power: parseInt(e.target.value, 10) })}
          title={t('skedPlanner.powerTitle', { defaultValue: 'TX power (shared with VOACAP panel)' })}
          style={selStyle}
        >
          {POWERS.map((p) => (
            <option key={p} value={p}>
              {p >= 1000 ? `${p / 1000}kW` : `${p}W`}
            </option>
          ))}
        </select>
      </span>
    </div>
  );

  if (loading || !hourly) {
    return (
      <div className="panel" style={{ padding: '8px', height: '100%', overflowY: 'auto' }}>
        {header}
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
          {t('skedPlanner.loading', { defaultValue: 'Waiting for the propagation engine…' })}
        </div>
      </div>
    );
  }

  // Column annotations every 6 hours: UTC / DE local / DX local.
  const labelCols = Array.from({ length: SKED_HOURS }, (_, i) => i).filter((i) => (startHour + i) % 6 === 0);
  const slotMs = (i) => nowMs - (nowMs % 3600_000) + i * 3600_000;

  const gridTemplate = { display: 'grid', gridTemplateColumns: `30px repeat(${SKED_HOURS}, 1fr)`, gap: '1px' };

  const labelRow = (label, tz, fallbackLon, color) => (
    <div style={{ ...gridTemplate, fontSize: '8px', color: 'var(--text-muted)', marginTop: '1px' }}>
      <div style={{ color, textAlign: 'right', paddingRight: '4px' }}>{label}</div>
      {Array.from({ length: SKED_HOURS }, (_, i) => (
        <div key={i} style={{ textAlign: 'center', overflow: 'visible', whiteSpace: 'nowrap' }}>
          {labelCols.includes(i)
            ? pad2(tz === 'utc' ? (startHour + i) % 24 : localHourAt(slotMs(i), tz, fallbackLon))
            : ''}
        </div>
      ))}
    </div>
  );

  const sunRow = (who, color) => (
    <div style={{ ...gridTemplate, fontSize: '8px', height: '10px', lineHeight: '10px' }}>
      <div style={{ color, textAlign: 'right', paddingRight: '4px' }}>{who === 'de' ? 'DE' : 'DX'}</div>
      {Array.from({ length: SKED_HOURS }, (_, i) => {
        const m = sunMarks[who][i];
        return (
          <div
            key={i}
            title={
              m
                ? `${who.toUpperCase()} ${m.glyph === '☀' ? t('skedPlanner.sunrise', { defaultValue: 'sunrise' }) : t('skedPlanner.sunset', { defaultValue: 'sunset' })} ${m.time}z`
                : undefined
            }
            style={{ textAlign: 'center', color: m?.glyph === '☀' ? 'var(--accent-amber)' : 'var(--accent-purple)' }}
          >
            {m?.glyph || ''}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', overflowY: 'auto' }}>
      {header}

      {/* Top 3 windows */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
        {windows.length === 0 ? (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {t('skedPlanner.noWindows', { defaultValue: 'No usable windows predicted on this path.' })}
          </span>
        ) : (
          windows.map((w, i) => (
            <span
              key={`${w.band}-${w.startOffset}`}
              style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                padding: '1px 6px',
                borderRadius: '3px',
                border: '1px solid var(--accent-green)',
                color: i === 0 ? '#000' : 'var(--accent-green)',
                background: i === 0 ? 'var(--accent-green)' : 'rgba(0,255,136,0.08)',
                fontWeight: i === 0 ? '700' : '400',
              }}
            >
              {i === 0 ? `${t('skedPlanner.best', { defaultValue: 'Best' })}: ` : ''}
              {windowLabel(w, startHour)}
            </span>
          ))
        )}
      </div>

      {/* DX sun markers above the grid, DE below (matches row order: DX far, DE near) */}
      {sunRow('dx', 'var(--accent-green)')}

      {/* Band × 48h reliability grid */}
      <div
        style={{ ...gridTemplate, gridTemplateRows: `repeat(${bands.length}, 11px)`, fontFamily: 'var(--font-mono)' }}
      >
        {bands.map((band) => (
          <React.Fragment key={band}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: '4px',
                color: 'var(--text-muted)',
                fontSize: '10px',
              }}
            >
              {band.replace('m', '')}
            </div>
            {tiled[band].map((slot) => {
              const inWindow = windowCells.has(`${band}:${slot.offset}`);
              return (
                <div
                  key={slot.offset}
                  title={`${band} ${pad2(slot.utcHour)}:00z ${slot.day > 0 ? `(+${slot.day}d) ` : ''}— ${slot.reliability}%`}
                  style={{
                    background: heatColor(slot.reliability),
                    borderRadius: '1px',
                    outline: inWindow ? '1px solid rgba(255,255,255,0.85)' : 'none',
                    outlineOffset: '-1px',
                    borderLeft: slot.utcHour === 0 && slot.offset > 0 ? '1px solid var(--text-muted)' : 'none',
                    opacity: slot.day >= 1 ? 0.82 : 1,
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {sunRow('de', 'var(--accent-cyan)')}
      {labelRow('UTC', 'utc', null, 'var(--text-secondary)')}
      {/* DE local: configured zone, else the browser's own zone (never solar) */}
      {labelRow('DE', timeZone || null, null, 'var(--accent-cyan)')}
      {labelRow('DX', dxTz, dxLocation?.lon, 'var(--accent-green)')}

      {/* Footer: engine + honest 48h tiling note */}
      <div
        style={{
          marginTop: '6px',
          paddingTop: '4px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '9px',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <span>
          {t('skedPlanner.tilingNote', {
            defaultValue: 'Day 2 repeats the 24h monthly-median prediction — diurnal, not a true 48h forecast.',
          })}
        </span>
        <span style={{ whiteSpace: 'nowrap' }}>
          {mode} • {power >= 1000 ? `${(power / 1000).toFixed(1)}kW` : `${power}W`}
          {propagation?.engine ? ` • ${propagation.engine.toUpperCase()}` : ''}
        </span>
      </div>
    </div>
  );
};

const selStyle = {
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  padding: '1px 3px',
  fontSize: '10px',
  fontFamily: 'var(--font-mono)',
};

export default SkedPlannerPanel;
