/**
 * Contest Layout — single-screen, high-density dashboard for contest
 * operating (config.layout === 'contest'). No map: the screen belongs to the
 * quick-log strip (dupe check + instant logging), the rate meter, the
 * session multiplier tracker, and a full-height DX cluster pane whose
 * worked/dupe/NEW badges drive search-and-pounce.
 *
 * Session model: `openhamclock_contestSession` = { startedAt, name?,
 * contestId?, sentExchange? }. The contest picker in the header selects a
 * contestDefs.js definition — it decides the quick-log strip's exchange
 * columns, the ADIF contest mapping, and which multipliers are tracked.
 * Start/Stop lives in the header; all contest panes scope to QSOs logged
 * after startedAt. Stopping only clears the marker — the QSOs stay in the
 * shared native logbook.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DXClusterPanel, PSKReporterPanel } from '../components';
import RateMeter from '../components/contest/RateMeter.jsx';
import ContestLogStrip from '../components/contest/ContestLogStrip.jsx';
import MultTracker from '../components/contest/MultTracker.jsx';
import GroupLogSection from '../components/GroupLogSection.jsx';
import { useLogbook } from '../hooks/useLogbook.js';
import { useRig } from '../contexts/RigContext.jsx';
import {
  loadContestSession,
  startContestSession,
  updateContestSession,
  clearContestSession,
  sessionQsos,
} from '../utils/contestSession.js';
import { qsoTimestampMs } from '../utils/contestRate.js';
import {
  CONTEST_DEFS,
  DEFAULT_CONTEST_ID,
  getContestDef,
  nextSentSerial,
  formatRcvdExchange,
} from '../utils/contestDefs.js';

const headerBtnStyle = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontWeight: 600,
  padding: '4px 12px',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
};

const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export default function ContestLayout(props) {
  const {
    config,
    deGrid,
    utcTime,
    setShowSettings,
    dxClusterData,
    dxFilters,
    setDxFilters,
    setShowDXFilters,
    hoveredSpot,
    setHoveredSpot,
    mapLayers,
    toggleDXPaths,
    togglePSKReporter,
    togglePSKPaths,
    toggleWSJTX,
    pskReporter,
    pskFilters,
    setShowPSKFilters,
    handleDXChange,
    wsjtx,
  } = props;

  const { tuneTo } = useRig();
  const { qsos } = useLogbook();

  // UTC seconds ticker (same pattern as EmcommLayout)
  const [seconds, setSeconds] = useState(() => String(new Date().getUTCSeconds()).padStart(2, '0'));
  useEffect(() => {
    const timer = setInterval(() => setSeconds(String(new Date().getUTCSeconds()).padStart(2, '0')), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Contest session ──────────────────────────────────────────────────────
  const [session, setSession] = useState(() => loadContestSession());
  const [nameDraft, setNameDraft] = useState('');
  // Group logging (Field Day multi-station) — open automatically when a
  // group session is being resumed, same heuristic as the Logbook panel.
  const [showGroup, setShowGroup] = useState(() => {
    try {
      return !!localStorage.getItem('openhamclock_groupLog');
    } catch {
      return false;
    }
  });
  // Contest choice before a session starts (a running session stores its own).
  const [contestDraftId, setContestDraftId] = useState(() => loadContestSession()?.contestId || DEFAULT_CONTEST_ID);
  // Sent-side exchange collected before Start (persists into the session).
  const [sentDraft, setSentDraft] = useState({});
  const stripApi = useRef(null); // { populate(call) } — click-to-populate hook

  const contestId = session?.contestId || contestDraftId;
  const contestDef = getContestDef(contestId);
  const sentExchange = session ? session.sentExchange || {} : sentDraft;

  const handleContestChange = (newId) => {
    if (session) {
      if (
        !confirm(
          'Switch contest mid-session? The exchange columns change and multipliers are recomputed under the new rules. Logged QSOs are not modified.',
        )
      )
        return;
      setSession(updateContestSession({ contestId: newId }));
    }
    setContestDraftId(newId);
  };

  const handleSentExchangeSave = (map) => {
    if (session) setSession(updateContestSession({ sentExchange: map }));
    else setSentDraft(map);
  };

  // Re-render every 30 s while a session runs so the header elapsed time
  // (computed from Date.now() at render) stays fresh.
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setElapsedTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [session]);

  const handleStart = () => {
    setSession(startContestSession(nameDraft, Date.now(), { contestId: contestDraftId, sentExchange: sentDraft }));
    setNameDraft('');
  };

  const handleStop = () => {
    if (!confirm('Stop the contest session? Your QSOs stay in the logbook — only the session marker is cleared.'))
      return;
    clearContestSession();
    setSession(null);
  };

  // Session-scoped QSOs, newest first — feeds the recent-QSOs list.
  const recentSessionQsos = useMemo(() => {
    const scoped = session ? sessionQsos(qsos, session.startedAt) : [];
    return scoped.sort((a, b) => (qsoTimestampMs(b) ?? 0) - (qsoTimestampMs(a) ?? 0)).slice(0, 20);
  }, [qsos, session]);

  // Sent serial for the next QSO — recomputed from the log, survives reloads.
  const serialNext = useMemo(() => nextSentSerial(qsos, session?.startedAt), [qsos, session?.startedAt]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '44px auto 1fr',
        background: 'var(--bg-primary)',
        fontFamily: 'var(--font-mono)',
        overflow: 'hidden',
        color: 'var(--text-primary)',
        gap: '6px',
        padding: '0 6px 6px',
        boxSizing: 'border-box',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '0 10px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          margin: '0 -6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <span
            style={{ color: 'var(--accent-amber)', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
            onClick={() => setShowSettings(true)}
            title="Open settings"
          >
            {config.callsign || 'N0CALL'}
          </span>
          {deGrid && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{deGrid}</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: 'var(--accent-amber)', fontWeight: 700, fontSize: '15px', letterSpacing: '2px' }}>
            CONTEST
          </span>
          <select
            value={contestId}
            onChange={(e) => handleContestChange(e.target.value)}
            aria-label="Contest"
            title="Contest — decides the exchange fields and multiplier rules"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              padding: '4px 6px',
              maxWidth: '180px',
            }}
          >
            {CONTEST_DEFS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {session ? (
            <>
              <span style={{ color: 'var(--accent-green)', fontSize: '11px', fontWeight: 600 }}>
                ● {session.name || 'Session'} · {fmtElapsed(Date.now() - session.startedAt)}
              </span>
              <button onClick={handleStop} style={{ ...headerBtnStyle, color: 'var(--accent-red)' }}>
                Stop
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value.slice(0, 40))}
                placeholder="Contest name (optional)"
                aria-label="Contest session name"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  padding: '4px 8px',
                  width: '160px',
                  fontFamily: 'var(--font-mono)',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleStart();
                }}
              />
              <button onClick={handleStart} style={{ ...headerBtnStyle, color: 'var(--accent-green)' }}>
                Start contest
              </button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setShowGroup((v) => !v)}
            title="Group logging — share one live log across several stations (Field Day)"
            aria-pressed={showGroup}
            style={{ ...headerBtnStyle, color: showGroup ? 'var(--accent-cyan)' : 'var(--text-muted)' }}
          >
            👥 Group
          </button>
          <div style={{ fontSize: '14px' }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {utcTime}:{seconds}
            </span>
            <span style={{ color: 'var(--text-muted)', marginLeft: '6px', fontSize: '11px' }}>UTC</span>
          </div>
        </div>
      </div>

      {/* QUICK LOG STRIP — the centerpiece, always one keystroke away */}
      <ContestLogStrip
        userCallsign={config.callsign}
        myGrid={deGrid}
        def={contestDef}
        sentExchange={sentExchange}
        onSentExchangeSave={handleSentExchangeSave}
        nextSerial={serialNext}
        apiRef={stripApi}
      />

      {/* GROUP LOG — create/join a shared multi-station session (Field Day) */}
      {showGroup && <GroupLogSection userCallsign={config.callsign} />}

      {/* MAIN GRID */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 360px)',
          gap: '6px',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* LEFT: rate + mults + session log */}
        <div
          style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) minmax(0, 40%)', gap: '6px', minHeight: 0 }}
        >
          <RateMeter qsos={qsos} />
          <MultTracker qsos={qsos} session={session} def={contestDef} userCallsign={config.callsign} />

          {/* Recent session QSOs */}
          <div className="panel" style={{ padding: '10px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ fontSize: '12px', color: 'var(--accent-green)', fontWeight: 700, marginBottom: '6px' }}>
              SESSION LOG{' '}
              <span style={{ color: 'var(--text-muted)', fontSize: '9px', fontWeight: 400 }}>
                {session ? 'latest first' : 'no active session'}
              </span>
            </div>
            <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, fontSize: '11px' }}>
              {recentSessionQsos.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px 2px' }}>
                  {session
                    ? 'Nothing logged yet — enter a call above and press Enter.'
                    : 'Start a session to track it here.'}
                </div>
              ) : (
                recentSessionQsos.map((q) => (
                  <div
                    key={q.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      padding: '2px 2px',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{q.call}</span>
                    <span
                      style={{
                        color: 'var(--accent-cyan)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title="Received exchange"
                    >
                      {formatRcvdExchange(q)}
                    </span>
                    <span style={{ color: 'var(--accent-amber)' }}>
                      {q.band || ''} {q.mode || ''}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {String(q.time_on || '').slice(0, 2)}:{String(q.time_on || '').slice(2, 4)}z
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: cluster (spot-and-pounce) + PSK/WSJT-X activity */}
        <div style={{ display: 'grid', gridTemplateRows: 'minmax(0, 60%) minmax(0, 40%)', gap: '6px', minHeight: 0 }}>
          <DXClusterPanel
            data={dxClusterData.spots}
            loading={dxClusterData.loading}
            error={dxClusterData.error}
            totalSpots={dxClusterData.totalSpots}
            filters={dxFilters}
            onFilterChange={setDxFilters}
            onOpenFilters={() => setShowDXFilters(true)}
            onHoverSpot={setHoveredSpot}
            onSpotClick={tuneTo}
            onSpotSelect={(spot) => stripApi.current?.populate?.(spot?.call)}
            hoveredSpot={hoveredSpot}
            showOnMap={mapLayers.showDXPaths}
            onToggleMap={toggleDXPaths}
            userCallsign={config.callsign}
            deLat={config.location?.lat}
            deLon={config.location?.lon}
          />
          <PSKReporterPanel
            callsign={config.callsign}
            showMutualReception={config.showMutualReception !== false}
            pskReporter={pskReporter}
            showOnMap={mapLayers.showPSKReporter}
            onToggleMap={togglePSKReporter}
            showPaths={mapLayers.showPSKPaths}
            onTogglePaths={togglePSKPaths}
            filters={pskFilters}
            onOpenFilters={() => setShowPSKFilters(true)}
            onShowOnMap={(r) => {
              if (r.lat != null && r.lon != null) handleDXChange({ lat: r.lat, lon: r.lon });
            }}
            wsjtxDecodes={wsjtx.decodes}
            wsjtxClients={wsjtx.clients}
            wsjtxQsos={wsjtx.qsos}
            wsjtxWspr={wsjtx.wspr}
            wsjtxStats={wsjtx.stats}
            wsjtxLoading={wsjtx.loading}
            wsjtxEnabled={wsjtx.enabled}
            wsjtxPort={wsjtx.port}
            wsjtxRelayEnabled={wsjtx.relayEnabled}
            wsjtxRelayConnected={wsjtx.relayConnected}
            wsjtxSessionId={wsjtx.sessionId}
            showWSJTXOnMap={mapLayers.showWSJTX}
            onToggleWSJTXMap={toggleWSJTX}
            wsjtxRelayMulticast={config.wsjtxRelayMulticast}
          />
        </div>
      </div>
    </div>
  );
}
