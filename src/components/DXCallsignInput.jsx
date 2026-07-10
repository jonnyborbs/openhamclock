import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useId } from 'react';
import { callbookAuthHeaders } from '../utils/callbookAuth.js';

/**
 * Editable callsign field for the DX target section.
 *
 * On Enter/blur, looks up the typed callsign via /api/callsign/:call and
 * calls onDXChange({ lat, lon, callsign }) on success. Reverts on Escape or
 * when the lookup fails. Read-only when dxLocked is true.
 *
 * Syncs its display value from the external dxCallsign prop so spot-clicks
 * from the DX cluster keep the field in sync.
 */
export function DXCallsignInput({ dxCallsign, onDXChange, dxLocked, style }) {
  const { t } = useTranslation();
  const errorId = useId();
  const [inputValue, setInputValue] = useState(dxCallsign ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef(null);
  const escapingRef = useRef(false);
  const abortRef = useRef(null);

  // Cancel any in-flight fetch on unmount to prevent state updates on dead components
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    setInputValue(dxCallsign ?? '');
  }, [dxCallsign]);

  const commit = async (value) => {
    const trimmed = value.trim().toUpperCase();
    if (!trimmed) {
      setInputValue(dxCallsign ?? '');
      return;
    }
    if (trimmed === (dxCallsign ?? '').toUpperCase()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(false);

    try {
      const res = await fetch(`/api/callsign/${encodeURIComponent(trimmed)}`, {
        headers: callbookAuthHeaders(),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('not found');

      const data = await res.json();

      if (data.lat != null && data.lon != null) {
        onDXChange({ lat: data.lat, lon: data.lon, callsign: trimmed });
      } else {
        throw new Error('no coordinates');
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(true);
      setInputValue(dxCallsign ?? '');
      setTimeout(() => setError(false), 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setInputValue(e.target.value.toUpperCase());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      escapingRef.current = true;
      setInputValue(dxCallsign ?? '');
      inputRef.current?.blur();
    }
  };

  const handleBlur = () => {
    if (inputRef.current) {
      inputRef.current.style.borderBottomColor = 'transparent';
    }
    if (escapingRef.current) {
      escapingRef.current = false;
      return;
    }
    commit(inputValue);
  };

  const handleFocus = () => {
    if (!dxLocked && inputRef.current) {
      inputRef.current.style.borderBottomColor = 'var(--border-color)';
    }
  };

  const errorMsg = t('app.dxLocation.callsignNotFound', 'Callsign not found');

  return (
    <div style={{ flex: 2 }}>
      <input
        ref={inputRef}
        type="text"
        value={loading ? '…' : inputValue}
        readOnly={dxLocked || loading}
        maxLength={20}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        aria-label={t('app.dxLocation.callsignInputAriaLabel', 'DX target callsign')}
        aria-invalid={error}
        aria-describedby={error ? errorId : undefined}
        title={
          dxLocked
            ? t('app.dxLocation.callsignInputTitleLocked', 'Unlock DX position to look up a callsign')
            : t('app.dxLocation.callsignInputTitle', 'Type a callsign and press Enter to set DX target')
        }
        style={{
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${error ? 'var(--color-error, #f44)' : 'transparent'}`,
          outline: 'none',
          cursor: dxLocked ? 'not-allowed' : loading ? 'wait' : 'text',
          padding: 0,
          margin: 0,
          fontFamily: 'var(--font-mono)',
          width: '100%',
          opacity: loading ? 0.5 : 1,
          ...style,
        }}
      />
      {/* Visually hidden live region — announces lookup failures to screen readers */}
      <span
        id={errorId}
        role="alert"
        aria-live="assertive"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
        }}
      >
        {error ? errorMsg : ''}
      </span>
    </div>
  );
}

export default DXCallsignInput;
