/**
 * AwardsPanel — award progress from the native logbook (dockable panel `awards`).
 *
 * Summary cards for DXCC, WAZ, WAS, and VUCC (worked / total + progress bar),
 * each expandable into a detail view: DXCC gets a searchable entity list with
 * worked-band badges, WAZ a 1-40 zone grid, WAS the 50-state grid plus an
 * honest note about where state data comes from, VUCC the grid count with a
 * per-band breakdown. Live-updating: useAwards recomputes on every logbook
 * change and again when cty.dat finishes loading.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAwards } from '../hooks/useAwards.js';
import { bandBreakdown, US_STATES, WAZ_TOTAL } from '../utils/awards.js';

const BAND_ORDER = [
  '630m',
  '160m',
  '80m',
  '60m',
  '40m',
  '30m',
  '20m',
  '17m',
  '15m',
  '12m',
  '11m',
  '10m',
  '8m',
  '6m',
  '4m',
  '2m',
  '70cm',
];

const bandSort = (a, b) => {
  const ia = BAND_ORDER.indexOf(a);
  const ib = BAND_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
};

const ProgressBar = ({ value, max, color }) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      style={{
        height: '5px',
        borderRadius: '3px',
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        marginTop: '4px',
      }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
    </div>
  );
};

const chipStyle = (active, color = 'var(--accent-green)') => ({
  display: 'inline-block',
  padding: '1px 4px',
  margin: '1px',
  borderRadius: '2px',
  fontSize: '9px',
  fontFamily: 'var(--font-mono)',
  color: active ? color : 'var(--text-muted)',
  background: active ? 'rgba(0, 255, 136, 0.12)' : 'rgba(255,255,255,0.04)',
  border: `1px solid ${active ? color : 'var(--border-color)'}`,
  opacity: active ? 1 : 0.55,
});

const AwardCard = ({ title, subtitle, worked, total, color, expanded, onToggle, children }) => (
  <div
    style={{
      border: '1px solid var(--border-color)',
      borderRadius: '4px',
      marginBottom: '6px',
      background: 'rgba(255,255,255,0.02)',
    }}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: 'none',
        border: 'none',
        padding: '7px 8px',
        cursor: 'pointer',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color }}>
          {expanded ? '▾' : '▸'} {title}
        </span>
        <span style={{ fontSize: '11px', fontWeight: 700 }}>
          {worked}
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> / {total}</span>
        </span>
      </div>
      {subtitle && <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>{subtitle}</div>}
      <ProgressBar value={worked} max={total} color={color} />
    </button>
    {expanded && <div style={{ padding: '0 8px 8px', fontSize: '10px' }}>{children}</div>}
  </div>
);

const BandBreakdownRow = ({ workedMap, t }) => {
  const byBand = bandBreakdown(workedMap);
  const bands = Object.keys(byBand).sort(bandSort);
  if (bands.length === 0) return null;
  return (
    <div style={{ marginBottom: '6px', color: 'var(--text-secondary)' }}>
      {t('awardsPanel.perBand', { defaultValue: 'Per band:' })}{' '}
      {bands.map((b) => (
        <span key={b} style={chipStyle(true, 'var(--accent-cyan)')}>
          {b} {byBand[b]}
        </span>
      ))}
    </div>
  );
};

export const AwardsPanel = () => {
  const { t } = useTranslation();
  const { awards, hasData } = useAwards();
  const [expanded, setExpanded] = useState(null); // 'dxcc' | 'waz' | 'was' | 'vucc' | null
  const [dxccSearch, setDxccSearch] = useState('');

  const toggle = (key) => setExpanded((cur) => (cur === key ? null : key));

  const dxccList = useMemo(() => {
    const rows = [...awards.dxcc.worked.entries()].map(([prefix, rec]) => ({
      prefix,
      entity: rec.entity,
      bands: [...rec.bands].sort(bandSort),
      modes: [...rec.modes].sort(),
      count: rec.count,
    }));
    rows.sort((a, b) => a.entity.localeCompare(b.entity));
    const q = dxccSearch.trim().toLowerCase();
    return q ? rows.filter((r) => r.entity.toLowerCase().includes(q) || r.prefix.toLowerCase().includes(q)) : rows;
  }, [awards, dxccSearch]);

  const wazZones = useMemo(() => {
    const out = [];
    for (let z = 1; z <= WAZ_TOTAL; z++) out.push({ zone: z, rec: awards.waz.worked.get(z) || null });
    return out;
  }, [awards]);

  const wasStates = useMemo(
    () => [...US_STATES].sort().map((st) => ({ st, rec: awards.was.worked.get(st) || null })),
    [awards],
  );

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        className="panel-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '6px',
          fontSize: '11px',
        }}
      >
        <span style={{ fontWeight: 700 }}>🏆 {t('awardsPanel.title', { defaultValue: 'AWARDS' })}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>
          {t('awardsPanel.qsoCount', { defaultValue: '{{total}} QSOs', total: awards.totalQsos })}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {!hasData ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '18px 10px', fontSize: '11px' }}>
            <div style={{ marginBottom: '6px' }}>
              {t('awardsPanel.emptyTitle', { defaultValue: 'No QSOs in your logbook yet' })}
            </div>
            <div style={{ fontSize: '10px' }}>
              {t('awardsPanel.emptyHint', {
                defaultValue:
                  'Award tracking is computed from the Logbook panel — log QSOs there or import an ADIF (.adi) file to see DXCC, WAZ, WAS, and VUCC progress.',
              })}
            </div>
          </div>
        ) : (
          <>
            {/* ── DXCC ─────────────────────────────────────────────── */}
            <AwardCard
              title={t('awardsPanel.dxcc', { defaultValue: 'DXCC' })}
              subtitle={t('awardsPanel.dxccSubtitle', { defaultValue: 'Entities worked' })}
              worked={awards.dxcc.worked.size}
              total={awards.dxcc.total}
              color="var(--accent-green)"
              expanded={expanded === 'dxcc'}
              onToggle={() => toggle('dxcc')}
            >
              <BandBreakdownRow workedMap={awards.dxcc.worked} t={t} />
              <input
                type="text"
                value={dxccSearch}
                onChange={(e) => setDxccSearch(e.target.value)}
                placeholder={t('awardsPanel.dxccSearch', { defaultValue: 'Search entities...' })}
                aria-label={t('awardsPanel.dxccSearch', { defaultValue: 'Search entities...' })}
                style={{
                  width: '100%',
                  padding: '3px 6px',
                  marginBottom: '5px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '3px',
                  color: 'var(--text-primary)',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              {dxccList.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>
                  {t('awardsPanel.noMatch', { defaultValue: 'No match' })}
                </div>
              ) : (
                dxccList.map((row) => (
                  <div
                    key={row.prefix}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '2px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}
                    title={`${row.entity} (${row.prefix}) — ${row.count} QSO${row.count === 1 ? '' : 's'}, modes: ${row.modes.join(', ') || '?'}`}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {row.entity} <span style={{ color: 'var(--text-muted)' }}>({row.prefix})</span>
                    </span>
                    <span style={{ flexShrink: 0, textAlign: 'right' }}>
                      {row.bands.map((b) => (
                        <span key={b} style={chipStyle(true)}>
                          {b}
                        </span>
                      ))}
                    </span>
                  </div>
                ))
              )}
              {awards.dxcc.unresolved > 0 && (
                <div style={{ marginTop: '5px', color: 'var(--text-muted)', fontSize: '9px' }}>
                  {t('awardsPanel.dxccUnresolved', {
                    defaultValue: '{{count}} QSOs could not be mapped to a DXCC entity',
                    count: awards.dxcc.unresolved,
                  })}
                </div>
              )}
            </AwardCard>

            {/* ── WAZ ──────────────────────────────────────────────── */}
            <AwardCard
              title={t('awardsPanel.waz', { defaultValue: 'WAZ' })}
              subtitle={t('awardsPanel.wazSubtitle', { defaultValue: 'CQ zones worked' })}
              worked={awards.waz.worked.size}
              total={awards.waz.total}
              color="var(--accent-cyan)"
              expanded={expanded === 'waz'}
              onToggle={() => toggle('waz')}
            >
              <BandBreakdownRow workedMap={awards.waz.worked} t={t} />
              <div>
                {wazZones.map(({ zone, rec }) => (
                  <span
                    key={zone}
                    style={chipStyle(!!rec, 'var(--accent-cyan)')}
                    title={
                      rec
                        ? `Zone ${zone} — ${rec.count} QSO${rec.count === 1 ? '' : 's'} (${[...rec.bands].sort(bandSort).join(', ') || '?'})`
                        : t('awardsPanel.zoneNeeded', { defaultValue: 'Zone {{zone}} — needed', zone })
                    }
                  >
                    {zone}
                  </span>
                ))}
              </div>
            </AwardCard>

            {/* ── WAS ──────────────────────────────────────────────── */}
            <AwardCard
              title={t('awardsPanel.was', { defaultValue: 'WAS' })}
              subtitle={t('awardsPanel.wasSubtitle', { defaultValue: 'US states worked (from ADIF STATE field)' })}
              worked={awards.was.worked.size}
              total={awards.was.total}
              color="#ffaa00"
              expanded={expanded === 'was'}
              onToggle={() => toggle('was')}
            >
              <div style={{ marginBottom: '6px', color: 'var(--text-muted)', fontSize: '9px' }}>
                {t('awardsPanel.wasNote', {
                  defaultValue:
                    'A state cannot be reliably derived from a callsign or grid square, so WAS counts only QSOs that carry an ADIF STATE field (e.g. imports from your logger or LoTW). {{withState}} of {{total}} QSOs have one.',
                  withState: awards.was.qsosWithState,
                  total: awards.totalQsos,
                })}
              </div>
              <BandBreakdownRow workedMap={awards.was.worked} t={t} />
              <div>
                {wasStates.map(({ st, rec }) => (
                  <span
                    key={st}
                    style={chipStyle(!!rec, '#ffaa00')}
                    title={
                      rec
                        ? `${st} — ${rec.count} QSO${rec.count === 1 ? '' : 's'} (${[...rec.bands].sort(bandSort).join(', ') || '?'})`
                        : t('awardsPanel.stateNeeded', { defaultValue: '{{state}} — needed', state: st })
                    }
                  >
                    {st}
                  </span>
                ))}
              </div>
            </AwardCard>

            {/* ── VUCC ─────────────────────────────────────────────── */}
            <AwardCard
              title={t('awardsPanel.vucc', { defaultValue: 'VUCC' })}
              subtitle={t('awardsPanel.vuccSubtitle', { defaultValue: 'Unique 4-character grids' })}
              worked={awards.vucc.worked.size}
              total={awards.vucc.threshold}
              color="#c792ff"
              expanded={expanded === 'vucc'}
              onToggle={() => toggle('vucc')}
            >
              <div style={{ marginBottom: '4px', color: 'var(--text-secondary)' }}>
                {t('awardsPanel.vuccHint', {
                  defaultValue: '{{count}} unique grids logged — 100 is the first VUCC award tier.',
                  count: awards.vucc.worked.size,
                })}
              </div>
              <BandBreakdownRow workedMap={awards.vucc.worked} t={t} />
            </AwardCard>
          </>
        )}
      </div>
    </div>
  );
};

export default AwardsPanel;
