/**
 * GroupLogSection — shared multi-operator log session UI inside the Logbook
 * panel (Field Day / multi-station group logging).
 *
 * One operator creates a session and reads the invite code over the air (or
 * the tent); everyone else joins with the code and their callsign. QSOs each
 * member logs locally sync automatically (see services/groupLogSync.js);
 * this section shows the merged log with per-operator attribution, live
 * cross-station dupe flags, and merged ADIF export / import-to-my-log.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGroupLog } from '../hooks/useGroupLog.js';
import { inputStyle, smallBtnStyle } from './QsoForm.jsx';

const ONLINE_WITHIN_MS = 30 * 1000; // members poll every 5s; 30s of silence = offline
const MAX_ROWS = 100;

export const GroupLogSection = ({ userCallsign }) => {
  const { t } = useTranslation();
  const { session, operators, qsos, status, error, create, join, leave, exportAdif, importToLogbook } = useGroupLog();

  const [mode, setMode] = useState('join'); // 'join' | 'create'
  const [sessionName, setSessionName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [call, setCall] = useState(userCallsign || '');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [importSummary, setImportSummary] = useState(null);

  // call|band → count over the merged log, for cross-station dupe flags
  const dupeCounts = useMemo(() => {
    const counts = new Map();
    for (const q of qsos) {
      const key = `${String(q.call || '').toUpperCase()}|${String(q.band || '').toLowerCase()}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [qsos]);

  const runAction = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () => runAction(() => create({ name: sessionName || 'Group log', call: call.trim() }));

  const handleJoin = () => runAction(() => join(inviteCode.trim(), call.trim()));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(session.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — code is on screen anyway */
    }
  };

  const handleExport = () => {
    const blob = new Blob([exportAdif()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ohc-group-${session.code}.adi`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = () =>
    runAction(async () => {
      const summary = await importToLogbook();
      setImportSummary(summary);
      setTimeout(() => setImportSummary(null), 5000);
    });

  const label = { fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase' };
  const box = {
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '8px',
    marginBottom: '8px',
    fontSize: '11px',
  };

  // ── Not in a session: create / join forms ─────────────────────────────────
  if (!session) {
    return (
      <div style={box}>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
          <button type="button" style={smallBtnStyle(mode === 'join')} onClick={() => setMode('join')}>
            {t('groupLog.join', { defaultValue: 'Join' })}
          </button>
          <button type="button" style={smallBtnStyle(mode === 'create')} onClick={() => setMode('create')}>
            {t('groupLog.create', { defaultValue: 'Create' })}
          </button>
          <span style={{ ...label, alignSelf: 'center', textTransform: 'none' }}>
            {t('groupLog.tagline', { defaultValue: 'Shared log for multi-station operations' })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {mode === 'create' ? (
            <div>
              <div style={label}>{t('groupLog.sessionName', { defaultValue: 'Session name' })}</div>
              <input
                style={{ ...inputStyle, width: '150px' }}
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder={t('groupLog.sessionNamePlaceholder', { defaultValue: 'Field Day 2026' })}
              />
            </div>
          ) : (
            <div>
              <div style={label}>{t('groupLog.inviteCode', { defaultValue: 'Invite code' })}</div>
              <input
                style={{ ...inputStyle, width: '110px', textTransform: 'uppercase' }}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="ABCD2345"
                maxLength={8}
              />
            </div>
          )}
          <div>
            <div style={label}>{t('groupLog.yourCall', { defaultValue: 'Your callsign' })}</div>
            <input
              style={{ ...inputStyle, width: '90px', textTransform: 'uppercase' }}
              value={call}
              onChange={(e) => setCall(e.target.value)}
            />
          </div>
          <button
            type="button"
            style={smallBtnStyle(false)}
            disabled={busy || !call.trim() || (mode === 'join' && inviteCode.trim().length < 8)}
            onClick={mode === 'create' ? handleCreate : handleJoin}
          >
            {mode === 'create'
              ? t('groupLog.createStart', { defaultValue: 'Start session' })
              : t('groupLog.joinGo', { defaultValue: 'Join session' })}
          </button>
        </div>
        {actionError && (
          <div role="alert" style={{ color: 'var(--accent-red)', fontSize: '10px', marginTop: '4px' }}>
            {actionError}
          </div>
        )}
      </div>
    );
  }

  // ── Active session ────────────────────────────────────────────────────────
  const now = Date.now();
  return (
    <div style={box}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}
      >
        <span>
          👥 <strong>{session.name}</strong>{' '}
          <button
            type="button"
            onClick={handleCopy}
            title={t('groupLog.copyCode', { defaultValue: 'Copy invite code' })}
            style={{
              ...smallBtnStyle(false),
              fontFamily: 'monospace',
              letterSpacing: '2px',
              fontWeight: 700,
            }}
          >
            {session.code} {copied ? '✓' : '⧉'}
          </button>
        </span>
        <span>
          {status === 'error' ? (
            <span style={{ color: 'var(--accent-red)', fontSize: '10px' }} role="alert">
              {t('groupLog.syncError', { defaultValue: 'Sync error: {{error}}', error })}
            </span>
          ) : (
            <span style={{ color: 'var(--accent-green)', fontSize: '10px' }}>
              {t('groupLog.live', { defaultValue: 'LIVE · {{count}} QSOs', count: qsos.length })}
            </span>
          )}{' '}
          <button type="button" style={smallBtnStyle(false)} onClick={handleExport} disabled={!qsos.length}>
            {t('groupLog.export', { defaultValue: 'Export' })}
          </button>{' '}
          <button
            type="button"
            style={smallBtnStyle(false)}
            onClick={handleImport}
            disabled={busy || !qsos.length}
            title={t('groupLog.importTooltip', { defaultValue: 'Copy the merged group log into your logbook' })}
          >
            {t('groupLog.importToLog', { defaultValue: 'To my log' })}
          </button>{' '}
          <button type="button" style={smallBtnStyle(false)} onClick={() => runAction(leave)} disabled={busy}>
            {t('groupLog.leave', { defaultValue: 'Leave' })}
          </button>
        </span>
      </div>

      {importSummary && (
        <div role="status" style={{ color: 'var(--accent-green)', fontSize: '10px', marginTop: '2px' }}>
          {t('groupLog.importSummary', {
            defaultValue: 'Imported {{imported}}, skipped {{skipped}} dupes',
            imported: importSummary.imported,
            skipped: importSummary.skipped,
          })}
        </div>
      )}

      {/* Operators roster */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0' }}>
        {operators.map((o) => {
          const online = now - (o.lastSeen || 0) < ONLINE_WITHIN_MS;
          return (
            <span
              key={o.call}
              title={
                online
                  ? t('groupLog.online', { defaultValue: 'Online' })
                  : t('groupLog.offline', { defaultValue: 'Offline' })
              }
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '1px 8px',
                fontSize: '10px',
                color: o.call === session.call ? 'var(--accent-cyan)' : 'var(--text-primary)',
              }}
            >
              <span style={{ color: online ? 'var(--accent-green)' : 'var(--text-muted)' }}>●</span> {o.call}{' '}
              <span style={{ color: 'var(--text-muted)' }}>{o.qsoCount}</span>
            </span>
          );
        })}
      </div>

      {/* Merged log (newest first, capped) */}
      {qsos.length > 0 && (
        <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th>{t('groupLog.colTime', { defaultValue: 'UTC' })}</th>
                <th>{t('groupLog.colCall', { defaultValue: 'Call' })}</th>
                <th>{t('groupLog.colBand', { defaultValue: 'Band' })}</th>
                <th>{t('groupLog.colMode', { defaultValue: 'Mode' })}</th>
                <th>{t('groupLog.colOperator', { defaultValue: 'Op' })}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {qsos.slice(0, MAX_ROWS).map((q) => {
                const dupe =
                  (dupeCounts.get(`${String(q.call || '').toUpperCase()}|${String(q.band || '').toLowerCase()}`) || 0) >
                  1;
                return (
                  <tr key={q.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {(q.time_on || '').substring(0, 4).replace(/(\d\d)(\d\d)/, '$1:$2')}
                    </td>
                    <td style={{ fontWeight: 600 }}>{q.call}</td>
                    <td>{q.band}</td>
                    <td>{q.mode}</td>
                    <td style={{ color: q.operator === session.call ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                      {q.operator}
                    </td>
                    <td>
                      {dupe && (
                        <span style={{ color: 'var(--accent-amber, #ffb347)', fontWeight: 700 }}>
                          {t('groupLog.dupe', { defaultValue: 'DUPE' })}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {actionError && (
        <div role="alert" style={{ color: 'var(--accent-red)', fontSize: '10px', marginTop: '4px' }}>
          {actionError}
        </div>
      )}
    </div>
  );
};

export default GroupLogSection;
