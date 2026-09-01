/**
 * LogStatsPanel — logbook analytics (dockable panel `log-stats`).
 *
 * Subscribes to the shared logbookStore (same live-update pattern as the
 * Awards panel), so stats recompute the moment a QSO is logged, edited, or
 * imported anywhere. All math lives in src/utils/logStats.js (pure,
 * tested): headline tiles (total QSOs, unique calls, unique 4-char grids,
 * best DX distance via the geo utils), a GitHub-contribution-style
 * QSOs-per-day heatmap for the trailing 12 months (inline SVG, weekday
 * rows), and per-band / per-mode bar breakdowns.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAll as getLogbookQsos, subscribe as subscribeLogbook } from '../services/logbookStore.js';
import { computeLogStats } from '../utils/logStats.js';
import { formatDistance } from '../utils/geo.js';

const CELL = 7; // heatmap cell size (SVG units)
const GAP = 2;

/** Heatmap cell opacity: 0 → faint slot, then 4 intensity steps. */
const cellOpacity = (count, maxCount) => {
  if (!count) return 0;
  const q = count / Math.max(1, maxCount);
  if (q <= 0.25) return 0.3;
  if (q <= 0.5) return 0.55;
  if (q <= 0.75) return 0.8;
  return 1;
};

const tileStyle = {
  flex: '1 1 70px',
  minWidth: '70px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '5px 6px',
  textAlign: 'center',
};

const StatTile = ({ label, value, sub }) => (
  <div style={tileStyle}>
    <div
      style={{
        fontSize: '15px',
        fontWeight: '700',
        color: 'var(--accent-cyan)',
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {value}
    </div>
    <div style={{ fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}
    </div>
    {sub && (
      <div style={{ fontSize: '9px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{sub}</div>
    )}
  </div>
);

const BarBreakdown = ({ title, rows, color }) => {
  const max = rows.length ? rows[0].count : 0;
  return (
    <div style={{ flex: '1 1 120px', minWidth: '110px' }}>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: '700', marginBottom: '3px' }}>{title}</div>
      {rows.slice(0, 8).map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
          <span
            style={{
              width: '34px',
              flexShrink: 0,
              fontSize: '9px',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.key}
          </span>
          <div style={{ flex: 1, height: '7px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
            <div
              style={{
                width: `${max ? Math.max(3, (r.count / max) * 100) : 0}%`,
                height: '100%',
                background: color,
                borderRadius: '2px',
                opacity: 0.85,
              }}
            />
          </div>
          <span
            style={{
              width: '30px',
              flexShrink: 0,
              fontSize: '9px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {r.count}
          </span>
        </div>
      ))}
    </div>
  );
};

const Heatmap = ({ heatmap, t }) => {
  const { weeks, maxCount, monthLabels } = heatmap;
  const width = weeks.length * (CELL + GAP) + 22;
  const height = 7 * (CELL + GAP) + 12;
  // Weekday labels on Mon/Wed/Fri rows, like GitHub
  const dayRows = [
    { dow: 1, label: 'M' },
    { dow: 3, label: 'W' },
    { dow: 5, label: 'F' },
  ];
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t('logStats.heatmapAria', { defaultValue: 'QSOs per day, trailing 12 months' })}
    >
      {monthLabels.map((m, i) => (
        <text
          key={`${m.label}-${i}`}
          x={22 + m.weekIndex * (CELL + GAP)}
          y={8}
          fill="var(--text-muted, #888)"
          fontSize="7"
          fontFamily="var(--font-mono)"
        >
          {m.label}
        </text>
      ))}
      {dayRows.map((d) => (
        <text
          key={d.dow}
          x={18}
          y={12 + 6 + d.dow * (CELL + GAP)}
          fill="var(--text-muted, #888)"
          fontSize="7"
          fontFamily="var(--font-mono)"
          textAnchor="end"
        >
          {d.label}
        </text>
      ))}
      {weeks.map((week, wi) =>
        week.map((cell, dow) =>
          cell ? (
            <rect
              key={cell.date}
              x={22 + wi * (CELL + GAP)}
              y={12 + dow * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={1.5}
              fill={cell.count ? 'var(--accent-green, #00ff88)' : 'var(--text-muted, #888)'}
              fillOpacity={cell.count ? cellOpacity(cell.count, maxCount) : 0.12}
            >
              <title>
                {cell.date}: {cell.count}
              </title>
            </rect>
          ) : null,
        ),
      )}
    </svg>
  );
};

export const LogStatsPanel = ({ deLocation, units }) => {
  const { t } = useTranslation();
  const [qsos, setQsos] = useState(getLogbookQsos());

  // subscribe() also kicks off store init, and delivers the current cache
  // synchronously — same pattern as useLogbook/useAwards.
  useEffect(() => subscribeLogbook(setQsos), []);

  const stats = useMemo(() => computeLogStats(qsos, deLocation), [qsos, deLocation]);

  if (stats.total === 0) {
    return (
      <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '6px', fontSize: '11px', color: 'var(--accent-primary)', fontWeight: '700' }}>
          📊 {t('logStats.title', { defaultValue: 'LOG STATS' })}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '10px', padding: '10px 4px', lineHeight: 1.6 }}>
          {t('logStats.empty', {
            defaultValue:
              'No QSOs yet. Log contacts in the Logbook panel or import an ADIF file there — stats appear here instantly as the log grows.',
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: '6px', fontSize: '11px', color: 'var(--accent-primary)', fontWeight: '700' }}>
        📊 {t('logStats.title', { defaultValue: 'LOG STATS' })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Headline tiles */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <StatTile label={t('logStats.totalQsos', { defaultValue: 'QSOs' })} value={stats.total.toLocaleString()} />
          <StatTile
            label={t('logStats.uniqueCalls', { defaultValue: 'Calls' })}
            value={stats.uniqueCalls.toLocaleString()}
          />
          <StatTile
            label={t('logStats.uniqueGrids', { defaultValue: 'Grids' })}
            value={stats.uniqueGrids.toLocaleString()}
          />
          {stats.bestDx && (
            <StatTile
              label={t('logStats.bestDx', { defaultValue: 'Best DX' })}
              value={formatDistance(stats.bestDx.km, units)}
              sub={stats.bestDx.call}
            />
          )}
          {stats.busiestDay && (
            <StatTile
              label={t('logStats.busiestDay', { defaultValue: 'Busiest day' })}
              value={stats.busiestDay.count}
              sub={stats.busiestDay.date}
            />
          )}
        </div>

        {/* Heatmap */}
        <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: '700', marginBottom: '2px' }}>
          {t('logStats.heatmapTitle', { defaultValue: 'QSOs PER DAY — TRAILING 12 MONTHS' })}
        </div>
        <Heatmap heatmap={stats.heatmap} t={t} />

        {/* Band / mode breakdowns */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
          <BarBreakdown
            title={t('logStats.byBand', { defaultValue: 'BY BAND' })}
            rows={stats.bands}
            color="var(--accent-amber, #ffaa00)"
          />
          <BarBreakdown
            title={t('logStats.byMode', { defaultValue: 'BY MODE' })}
            rows={stats.modes}
            color="var(--accent-cyan, #00bcd4)"
          />
        </div>
      </div>

      <div
        style={{
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '9px',
          color: 'var(--text-muted)',
          paddingTop: '2px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span>
          {stats.firstQsoDate && t('logStats.firstQso', { defaultValue: 'first {{date}}', date: stats.firstQsoDate })}
        </span>
        <span>
          {stats.latestQsoDate &&
            t('logStats.latestQso', { defaultValue: 'latest {{date}}', date: stats.latestQsoDate })}
        </span>
      </div>
    </div>
  );
};

export default LogStatsPanel;
