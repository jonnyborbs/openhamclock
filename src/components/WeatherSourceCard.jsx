/**
 * WeatherSourceCard — Settings card for the DE/DX weather data source
 * (discussion #474).
 *
 * Open-Meteo is the keyless default; OpenWeatherMap is available for users
 * who already hold an OWM key (e.g. for the clouds layer). Keys live in this
 * browser's localStorage only — never on the server, never in backups or
 * share codes (same policy as callbook credentials). Changes fire
 * WEATHER_SOURCE_CHANGE_EVENT so open weather panels re-fetch immediately.
 */
import { useState } from 'react';
import {
  WEATHER_SOURCE_KEY,
  OWM_APIKEY_KEY,
  WEATHER_SOURCE_CHANGE_EVENT,
  getWeatherSource,
} from '../hooks/useWeather.js';

const readLs = (key) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeLs = (key, val) => {
  try {
    if (val) localStorage.setItem(key, val);
    else localStorage.removeItem(key);
  } catch {}
};

const announce = () => window.dispatchEvent(new CustomEvent(WEATHER_SOURCE_CHANGE_EVENT));

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  fontSize: '12px',
  fontFamily: 'var(--font-mono)',
  boxSizing: 'border-box',
};

export const WeatherSourceCard = () => {
  const [source, setSource] = useState(getWeatherSource);
  const [owmKey, setOwmKey] = useState(() => readLs(OWM_APIKEY_KEY));

  const pickSource = (s) => {
    setSource(s);
    writeLs(WEATHER_SOURCE_KEY, s === 'openweathermap' ? s : '');
    announce();
  };

  return (
    <div
      style={{
        padding: '12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        marginBottom: '12px',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--accent-amber)', marginBottom: '8px' }}>
        🌡️ Weather Source
      </div>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
        {[
          { id: 'openmeteo', label: 'Open-Meteo', tip: 'Free, no key needed (default)' },
          { id: 'openweathermap', label: 'OpenWeatherMap', tip: 'Uses your own OWM API key' },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pickSource(s.id)}
            aria-pressed={source === s.id}
            title={s.tip}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: source === s.id ? 'var(--accent-amber)' : 'var(--bg-primary)',
              border: `1px solid ${source === s.id ? 'var(--accent-amber)' : 'var(--border-color)'}`,
              borderRadius: '4px',
              color: source === s.id ? '#000' : 'var(--text-secondary)',
              fontSize: '11px',
              fontWeight: source === s.id ? 700 : 400,
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {source === 'openweathermap' ? (
        <>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
            Current conditions + 3-hourly forecast from{' '}
            <a
              href="https://openweathermap.org/api"
              target="_blank"
              rel="noopener"
              style={{ color: 'var(--accent-blue)' }}
            >
              openweathermap.org
            </a>{' '}
            with your own (free-tier) API key. The key stays in this browser only. Without a key, panels fall back to
            Open-Meteo. Note: OWM's free tier has no UV index.
          </div>
          <input
            type="text"
            placeholder="OpenWeatherMap API key (required for this source)"
            value={owmKey}
            onChange={(e) => {
              const val = e.target.value.trim();
              setOwmKey(val);
              writeLs(OWM_APIKEY_KEY, val);
              announce();
            }}
            aria-label="OpenWeatherMap API key"
            style={inputStyle}
          />
        </>
      ) : (
        <>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
            Weather data from Open-Meteo's free API. For higher rate limits or commercial use, enter your API key from{' '}
            <a
              href="https://open-meteo.com/en/pricing"
              target="_blank"
              rel="noopener"
              style={{ color: 'var(--accent-blue)' }}
            >
              open-meteo.com
            </a>
            . Leave blank for the free tier.
          </div>
          <input
            type="text"
            placeholder="Free tier (no key needed)"
            defaultValue={readLs('ohc_openmeteo_apikey')}
            onChange={(e) => {
              writeLs('ohc_openmeteo_apikey', e.target.value.trim());
            }}
            aria-label="Open-Meteo API key"
            style={inputStyle}
          />
        </>
      )}
    </div>
  );
};

export default WeatherSourceCard;
