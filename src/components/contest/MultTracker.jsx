/**
 * MultTracker — session multipliers + score estimate for the Contest layout.
 *
 * Scoped to QSOs logged since the session's "Start contest" marker. The
 * active contest definition (utils/contestDefs.js) decides which multiplier
 * dimensions are counted — CQ zones + DXCC for CQ WW, WPX prefixes for WPX,
 * sections for Sweepstakes, and so on — overall and per band. The generic
 * def keeps the original DXCC + zones + states trio. Field Day has no mults:
 * its dims render as non-scoring "worked" counts and the score is plain QSOs.
 *
 * The score is QSOs × mults, clearly labeled as an estimate — real contests
 * apply per-QSO point values this tracker doesn't model.
 */
import { useEffect, useMemo, useState } from 'react';
import { computeContestMults } from '../../utils/contestDefs.js';
import { ctyLookup } from '../../utils/ctyLookup.js';

const BAND_ORDER = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '4m', '2m', '70cm'];
const DIM_COLORS = ['var(--accent-green)', 'var(--accent-amber)', 'var(--accent-purple)', 'var(--accent-cyan)'];

const Big = ({ label, value, accent }) => (
  <div style={{ textAlign: 'center', minWidth: '60px' }}>
    <div
      style={{
        fontSize: '20px',
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        color: accent || 'var(--text-primary)',
        lineHeight: 1.1,
      }}
    >
      {value}
    </div>
    <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
      {label}
    </div>
  </div>
);

export const MultTracker = ({ qsos, session, def, userCallsign }) => {
  // cty.dat may land after the first compute — recompute when it does.
  const [ctyTick, setCtyTick] = useState(0);
  useEffect(() => {
    const onCty = () => setCtyTick((n) => n + 1);
    window.addEventListener('openhamclock-cty-loaded', onCty);
    return () => window.removeEventListener('openhamclock-cty-loaded', onCty);
  }, []);

  const mults = useMemo(
    () =>
      computeContestMults(qsos, {
        startedAt: session?.startedAt,
        def,
        myResolved: ctyLookup(userCallsign),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qsos, session?.startedAt, def, userCallsign, ctyTick],
  );

  const bands = useMemo(() => {
    const known = BAND_ORDER.filter((b) => mults.perBand.has(b));
    const extra = [...mults.perBand.keys()].filter((b) => !BAND_ORDER.includes(b));
    return [...known, ...extra];
  }, [mults]);

  if (!session) {
    return (
      <div className="panel" style={{ padding: '10px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '12px', color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: '8px' }}>
          MULTIPLIERS
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic', padding: '12px 4px' }}>
          Press <b>Start contest</b> in the header to begin a session. Multipliers and the score count QSOs logged after
          that moment — your logbook itself is untouched.
        </div>
      </div>
    );
  }

  return (
    <div
      className="panel"
      style={{ padding: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}
    >
      <div
        style={{
          fontSize: '12px',
          color: 'var(--accent-cyan)',
          fontWeight: 700,
          marginBottom: '8px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>MULTIPLIERS</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 400 }}>
          {def?.name || 'this session'}
        </span>
      </div>

      <div
        style={{ display: 'flex', justifyContent: 'space-around', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}
      >
        <Big label="QSOs" value={mults.qsoCount} />
        {mults.dims.map((dim, i) => (
          <Big
            key={dim.key}
            label={dim.scoring ? dim.label : `${dim.label} (info)`}
            value={dim.values.size}
            accent={DIM_COLORS[i % DIM_COLORS.length]}
          />
        ))}
      </div>

      {/* Score estimate */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Score est.</span>
        <span
          style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}
          title={
            mults.scoring
              ? `${mults.qsoCount} QSOs × ${mults.multTotal} mults`
              : `${mults.qsoCount} QSOs (no multipliers)`
          }
        >
          {mults.score.toLocaleString()}
        </span>
      </div>

      {/* Per-band table */}
      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {bands.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '11px', fontStyle: 'italic', padding: '8px 4px' }}>
            No session QSOs yet — work someone!
          </div>
        ) : (
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontFamily: 'var(--font-mono)' }}
          >
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: '9px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '2px 4px' }}>Band</th>
                <th style={{ textAlign: 'right', padding: '2px 4px' }}>Q</th>
                {mults.dims.map((dim) => (
                  <th key={dim.key} style={{ textAlign: 'right', padding: '2px 4px' }}>
                    {dim.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => {
                const rec = mults.perBand.get(b);
                return (
                  <tr key={b} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '3px 4px', color: 'var(--accent-amber)', fontWeight: 600 }}>{b}</td>
                    <td style={{ padding: '3px 4px', textAlign: 'right', color: 'var(--text-primary)' }}>{rec.qsos}</td>
                    {mults.dims.map((dim, i) => (
                      <td
                        key={dim.key}
                        style={{ padding: '3px 4px', textAlign: 'right', color: DIM_COLORS[i % DIM_COLORS.length] }}
                      >
                        {rec.values.get(dim.key)?.size ?? 0}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.4 }}>
        {mults.scoring
          ? `Score = QSOs × (${mults.dims
              .filter((d) => d.scoring)
              .map((d) => d.label)
              .join(' + ')}) — an estimate; real ${def?.name || 'contest'} scoring applies per-QSO points.`
          : 'This contest has no multipliers — the score estimate is plain QSO count (Field Day scoring uses QSO points and bonuses).'}
      </div>
    </div>
  );
};

export default MultTracker;
