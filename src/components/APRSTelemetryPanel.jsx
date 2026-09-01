/**
 * APRSTelemetryPanel Component
 * Sensor dashboard for APRS telemetry: per-station cards with the latest
 * analog channel values (labels/units from PARM/UNIT messages), inline SVG
 * trend sparklines from server-kept history, and digital status bits.
 *
 * Renders in two variants:
 * - 'dock' (default): standalone dockable panel using theme CSS variables.
 * - 'emcomm': embedded card list matching the EmComm layout's dark palette
 *   (the EmComm sidebar provides its own PanelSection header).
 */
import { useAPRSTelemetry } from '../hooks/useAPRSTelemetry.js';
import { buildChannels, buildBits, formatTelemetryValue, sparklinePoints } from '../utils/aprsTelemetry.js';

const PALETTES = {
  dock: {
    card: 'var(--bg-tertiary)',
    border: 'var(--border-color)',
    title: 'var(--text-primary)',
    label: 'var(--text-secondary)',
    muted: 'var(--text-muted)',
    accent: 'var(--accent-cyan)',
    spark: '#22d3ee',
    bitOn: '#22c55e',
    bitOff: '#555',
    rf: '#4ade80',
  },
  emcomm: {
    card: '#0d1117',
    border: '#2a3040',
    title: '#ddd',
    label: '#aaa',
    muted: '#888',
    accent: '#22d3ee',
    spark: '#22d3ee',
    bitOn: '#22c55e',
    bitOff: '#333',
    rf: '#22c55e',
  },
};

function formatAge(timestamp) {
  if (!timestamp) return '?';
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Inline SVG sparkline — no chart library, scales to its container. */
function Sparkline({ series, color }) {
  const points = sparklinePoints(series, 100, 28, 2);
  if (!points) return null;
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      style={{ width: '100%', height: '20px', display: 'block' }}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StationCard({ entry, colors }) {
  const channels = buildChannels(entry);
  const bits = buildBits(entry);
  return (
    <div
      style={{
        background: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: '6px',
        padding: '8px',
        marginBottom: '6px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: colors.accent, fontWeight: 700, fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
            {entry.call}
          </span>
          {entry.source === 'local-tnc' && (
            <span
              title="Heard over RF via local TNC"
              style={{
                fontSize: '9px',
                padding: '1px 4px',
                borderRadius: '2px',
                background: 'rgba(74,222,128,0.15)',
                border: `1px solid ${colors.rf}66`,
                color: colors.rf,
                fontWeight: 700,
              }}
            >
              RF
            </span>
          )}
        </div>
        <span style={{ color: colors.muted, fontSize: '10px' }}>
          #{entry.seq} · {formatAge(entry.timestamp)}
        </span>
      </div>

      {channels.map((ch, i) => (
        <div
          key={`${ch.label}-${i}`}
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr auto',
            gap: '8px',
            alignItems: 'center',
            padding: '2px 0',
            fontSize: '11px',
          }}
        >
          <span
            style={{
              color: colors.label,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={ch.label}
          >
            {ch.label}
          </span>
          <span style={{ minWidth: 0 }}>
            <Sparkline series={ch.series} color={colors.spark} />
          </span>
          <span
            style={{
              color: colors.title,
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              whiteSpace: 'nowrap',
            }}
          >
            {formatTelemetryValue(ch.value)}
            {ch.unit && <span style={{ color: colors.muted, fontWeight: 400, marginLeft: '3px' }}>{ch.unit}</span>}
          </span>
        </div>
      ))}

      {bits.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '5px' }}>
          {bits.map((b, i) => (
            <span
              key={`${b.label}-${i}`}
              title={`${b.label}: ${b.on ? 'ON' : 'OFF'}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9px', color: colors.muted }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  display: 'inline-block',
                  background: b.on ? colors.bitOn : colors.bitOff,
                }}
              />
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TelemetryEmptyState({ colors }) {
  return (
    <div style={{ padding: '14px 10px', color: colors.muted, fontSize: '11px', lineHeight: 1.5 }}>
      <div style={{ color: colors.label, fontWeight: 600, marginBottom: '4px' }}>No telemetry stations heard yet</div>
      APRS stations can broadcast sensor readings — battery voltage, temperature, wind, door switches, repeater status —
      as telemetry frames. Any station heard sending telemetry (via APRS-IS or a local RF TNC) appears here
      automatically with its latest values and trends.
    </div>
  );
}

const APRSTelemetryPanel = ({ telemetry: telemetryProp, variant = 'dock', loading: loadingProp }) => {
  // Self-fetch when no data is supplied (dockable panel usage); the hook only
  // polls while this panel is mounted.
  const own = useAPRSTelemetry({ enabled: telemetryProp === undefined });
  const telemetry = telemetryProp !== undefined ? telemetryProp : own.telemetry;
  const loading = loadingProp !== undefined ? loadingProp : telemetryProp !== undefined ? false : own.loading;
  const colors = PALETTES[variant] || PALETTES.dock;

  const body = loading ? (
    <div style={{ padding: '14px 10px', color: colors.muted, fontSize: '11px' }}>Loading telemetry…</div>
  ) : telemetry.length === 0 ? (
    <TelemetryEmptyState colors={colors} />
  ) : (
    telemetry.map((entry) => <StationCard key={entry.call} entry={entry} colors={colors} />)
  );

  if (variant === 'emcomm') {
    // EmComm sidebar provides its own PanelSection chrome
    return <div style={{ padding: '2px 4px' }}>{body}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: '12px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px' }}>📊</span>
          <span style={{ fontWeight: 700, color: colors.title }}>APRS Telemetry</span>
        </div>
        <span style={{ color: colors.muted, fontSize: '11px' }}>
          {telemetry.length} station{telemetry.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '6px' }}>{body}</div>
    </div>
  );
};

export default APRSTelemetryPanel;
