/**
 * POTAActivatorPanel — self-spotting for park activators. Fill in park,
 * frequency, and mode; the panel verifies the park reference against the
 * POTA API and posts the spot through the server proxy. POTA's own
 * response is shown verbatim, success or failure.
 */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';

const FORM_KEY = 'ohc_pota_activator'; // { reference, frequency, mode }
const MODES = ['SSB', 'CW', 'FT8', 'FT4', 'FM', 'DIGI'];
const COOLDOWN_S = 30;

const loadForm = () => {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { reference: '', frequency: '', mode: 'SSB' };
};

const inputStyle = {
  width: '100%',
  padding: '5px 6px',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  boxSizing: 'border-box',
};

export const POTAActivatorPanel = ({ config }) => {
  const callsign = (config?.callsign || '').toUpperCase();
  const hasCallsign = callsign && callsign !== 'N0CALL';

  const [form, setForm] = useState(loadForm);
  const [comments, setComments] = useState('');
  const [park, setPark] = useState(null); // { name, location } | { error }
  const [result, setResult] = useState(null); // { ok, message }
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const parkLookupRef = useRef(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown > 0]);

  const update = (patch) => {
    const next = { ...form, ...patch };
    setForm(next);
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(next));
    } catch {}
  };

  const lookupPark = async (reference) => {
    const ref = reference.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}-[0-9]{4,5}$/.test(ref)) {
      setPark(null);
      return;
    }
    const seq = ++parkLookupRef.current;
    try {
      const response = await apiFetch(`/api/pota/park/${encodeURIComponent(ref)}`);
      if (seq !== parkLookupRef.current) return; // stale lookup
      if (response?.ok) setPark(await response.json());
      else setPark({ error: response?.status === 404 ? 'Park not found' : 'Lookup failed' });
    } catch {
      if (seq === parkLookupRef.current) setPark({ error: 'Lookup failed' });
    }
  };

  const canSpot =
    hasCallsign &&
    /^[A-Z0-9]{1,4}-[0-9]{4,5}$/.test(form.reference.trim().toUpperCase()) &&
    Number(form.frequency) >= 1800 &&
    !busy &&
    cooldown === 0;

  const postSpot = async () => {
    if (!canSpot) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await apiFetch('/api/pota/spot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activator: callsign,
          spotter: callsign,
          reference: form.reference.trim().toUpperCase(),
          frequency: Number(form.frequency),
          mode: form.mode,
          comments,
        }),
      });
      const payload = response ? await response.json() : { error: 'Request blocked (rate limit)' };
      if (response?.ok && payload.ok) {
        setResult({ ok: true, message: 'Spot posted to POTA' });
        setCooldown(COOLDOWN_S);
      } else {
        setResult({ ok: false, message: payload.error || payload.message || `Failed (${response?.status})` });
      }
    } catch (err) {
      setResult({ ok: false, message: 'Network error posting spot' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
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
        <span>POTA ACTIVATOR</span>
        <span style={{ color: '#44cc44', fontWeight: 400, fontSize: '9px' }}>{hasCallsign ? callsign : ''}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', fontSize: '10px' }}>
        {!hasCallsign ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            Set your callsign in Settings → Station to self-spot
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div>
              <label style={{ color: 'var(--text-muted)', fontSize: '9px', display: 'block', marginBottom: '2px' }}>
                PARK REFERENCE
              </label>
              <input
                type="text"
                value={form.reference}
                placeholder="US-1211"
                onChange={(e) => {
                  update({ reference: e.target.value.toUpperCase() });
                  setPark(null);
                }}
                onBlur={(e) => lookupPark(e.target.value)}
                style={inputStyle}
              />
              {park && !park.error && (
                <div style={{ color: '#4ade80', fontSize: '9px', marginTop: '2px' }}>
                  ✓ {park.name}
                  {park.location && <span style={{ color: 'var(--text-muted)' }}> · {park.location}</span>}
                </div>
              )}
              {park?.error && <div style={{ color: '#ef4444', fontSize: '9px', marginTop: '2px' }}>{park.error}</div>}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: 'var(--text-muted)', fontSize: '9px', display: 'block', marginBottom: '2px' }}>
                  FREQ (kHz)
                </label>
                <input
                  type="number"
                  value={form.frequency}
                  placeholder="14285"
                  onChange={(e) => update({ frequency: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ color: 'var(--text-muted)', fontSize: '9px', display: 'block', marginBottom: '2px' }}>
                  MODE
                </label>
                <select
                  value={form.mode}
                  onChange={(e) => update({ mode: e.target.value })}
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ color: 'var(--text-muted)', fontSize: '9px', display: 'block', marginBottom: '2px' }}>
                COMMENTS (optional)
              </label>
              <input
                type="text"
                value={comments}
                maxLength={120}
                placeholder="QRT in 30 min…"
                onChange={(e) => setComments(e.target.value)}
                style={inputStyle}
              />
            </div>

            <button
              type="button"
              onClick={postSpot}
              disabled={!canSpot}
              style={{
                padding: '8px',
                background: canSpot ? 'rgba(68, 204, 68, 0.15)' : 'var(--bg-tertiary)',
                border: `1px solid ${canSpot ? '#44cc44' : 'var(--border-color)'}`,
                borderRadius: '4px',
                color: canSpot ? '#44cc44' : 'var(--text-muted)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: canSpot ? 'pointer' : 'default',
              }}
            >
              {busy ? 'SPOTTING…' : cooldown > 0 ? `SPOTTED — ${cooldown}s` : '▲ SPOT ME'}
            </button>

            {result && (
              <div
                style={{
                  padding: '5px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  background: result.ok ? 'rgba(74, 222, 128, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  border: `1px solid ${result.ok ? '#4ade80' : '#ef4444'}`,
                  color: result.ok ? '#4ade80' : '#ef4444',
                  overflowWrap: 'break-word',
                }}
              >
                {result.message}
              </div>
            )}

            <div style={{ color: 'var(--text-muted)', fontSize: '9px' }}>
              Spots post to pota.app under your callsign. Re-spot after QSY or every ~30 min to stay on the active list.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default POTAActivatorPanel;
