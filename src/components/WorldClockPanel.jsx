/**
 * WorldClockPanel — a row of user-configured timezone clocks for net
 * schedules and DX skeds. Zones persist (and sync) via
 * localStorage['openhamclock_worldClocks']; 12/24 h follows the app config.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadConfig } from '../utils/config.js';

const STORAGE_KEY = 'openhamclock_worldClocks';
const MAX_CLOCKS = 10;

const DEFAULT_CLOCKS = [
  { label: 'UTC', tz: 'Etc/UTC' },
  { label: 'New York', tz: 'America/New_York' },
  { label: 'London', tz: 'Europe/London' },
  { label: 'Tokyo', tz: 'Asia/Tokyo' },
];

function loadClocks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.every((c) => c && c.tz)) return parsed;
  } catch {}
  return DEFAULT_CLOCKS;
}

function saveClocks(clocks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clocks));
  } catch {}
}

// "America/New_York" → "New York"
const tzCity = (tz) => (tz.split('/').pop() || tz).replace(/_/g, ' ');

function zoneList() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch {}
  return DEFAULT_CLOCKS.map((c) => c.tz);
}

/** Day offset relative to the browser's local date: -1, 0, +1. */
function dayOffset(now, tz) {
  try {
    const here = now.toLocaleDateString('en-CA');
    const there = now.toLocaleDateString('en-CA', { timeZone: tz });
    if (there > here) return 1;
    if (there < here) return -1;
  } catch {}
  return 0;
}

export const WorldClockPanel = () => {
  const [clocks, setClocks] = useState(loadClocks);
  const [now, setNow] = useState(() => new Date());
  const [adding, setAdding] = useState(false);
  const [newTz, setNewTz] = useState('');
  const use12Hour = useMemo(() => !!loadConfig().use12Hour, []);
  const zones = useMemo(zoneList, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const update = (next) => {
    setClocks(next);
    saveClocks(next);
  };

  const addClock = () => {
    if (!newTz || clocks.some((c) => c.tz === newTz) || clocks.length >= MAX_CLOCKS) return;
    update([...clocks, { label: tzCity(newTz), tz: newTz }]);
    setNewTz('');
    setAdding(false);
  };

  const formatTime = (tz) => {
    try {
      return now.toLocaleTimeString(use12Hour ? 'en-US' : 'en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: use12Hour,
      });
    } catch {
      return '--:--:--';
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
        <span>WORLD CLOCKS</span>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          title={adding ? 'Cancel' : 'Add clock'}
          aria-label={adding ? 'Cancel adding clock' : 'Add clock'}
          style={{
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            padding: 0,
          }}
        >
          {adding ? '✕' : '＋'}
        </button>
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
          <select
            value={newTz}
            onChange={(e) => setNewTz(e.target.value)}
            aria-label="Timezone to add"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '4px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '11px',
            }}
          >
            <option value="">Select timezone…</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addClock}
            disabled={!newTz}
            style={{
              padding: '4px 10px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--accent-cyan)',
              borderRadius: '4px',
              color: 'var(--accent-cyan)',
              fontSize: '11px',
              cursor: newTz ? 'pointer' : 'default',
              opacity: newTz ? 1 : 0.4,
            }}
          >
            Add
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)' }}>
        {clocks.map((clock) => {
          const offset = dayOffset(now, clock.tz);
          return (
            <div
              key={clock.tz}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '5px 6px',
                marginBottom: '3px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {clock.label}
                {offset !== 0 && (
                  <span style={{ color: 'var(--accent-amber)', marginLeft: '4px' }}>{offset > 0 ? '+1d' : '−1d'}</span>
                )}
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexShrink: 0 }}>
                <span style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {formatTime(clock.tz)}
                </span>
                <button
                  type="button"
                  onClick={() => update(clocks.filter((c) => c.tz !== clock.tz))}
                  title={`Remove ${clock.label}`}
                  aria-label={`Remove ${clock.label}`}
                  style={{
                    cursor: 'pointer',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '10px',
                    padding: 0,
                    opacity: 0.5,
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
          );
        })}
        {clocks.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '10px', fontSize: '11px' }}>
            No clocks — add one with ＋
          </div>
        )}
      </div>
    </div>
  );
};

export default WorldClockPanel;
