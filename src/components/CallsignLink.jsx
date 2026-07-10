/**
 * CallsignLink — clickable callsign that opens a popup with station info.
 *
 * Usage:
 *   const { showPopup } = useCallsignPopup();
 *   <CallsignLink call={spot.call} onPopup={showPopup} />
 *
 * If `onPopup` is not provided, the callsign is rendered as plain text (no click).
 */
import { useRef, useCallback } from 'react';

// ── Extract base callsign from decorated/portable calls ──
// 5Z4/OZ6ABL → OZ6ABL, UA1TAN/M → UA1TAN, W1ABC/6 → W1ABC
// OE1XYZ-12 → OE1XYZ  (MeshCom / APRS SSID suffix stripped before QRZ lookup)
// Picks the segment that looks most like a home callsign.
const MODIFIERS = new Set(['M', 'P', 'QRP', 'MM', 'AM', 'R', 'T', 'B', 'BCN', 'LH', 'A', 'E', 'J', 'AG', 'AE', 'KT']);
export function extractBaseCall(raw) {
  if (!raw) return '';
  // Strip SSID suffix (-12, -99, etc.) used by MeshCom and APRS
  const withoutSsid = raw.replace(/-\d+$/, '');
  if (!withoutSsid.includes('/')) return withoutSsid.toUpperCase();
  const parts = withoutSsid.toUpperCase().split('/');
  const candidates = parts.filter((p) => p && !MODIFIERS.has(p) && !/^\d$/.test(p));
  if (candidates.length === 0) return parts[0] || withoutSsid.toUpperCase();
  if (candidates.length === 1) return candidates[0];
  const pat = /^[A-Z]{1,3}\d{1,4}[A-Z]{1,4}$/;
  const full = candidates.filter((c) => pat.test(c));
  if (full.length === 1) return full[0];
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

// ── The callsign link itself ──
// onPopup(call, anchorEl, location?) — callback for popup mode
// location — { grid: string } or { lat: number, lon: number } (optional)
export default function CallsignLink({
  call,
  color = 'inherit',
  fontWeight = 'inherit',
  fontSize = 'inherit',
  style = {},
  children,
  onPopup,
  location,
}) {
  const spanRef = useRef(null);

  const triggerPopup = useCallback(
    (e) => {
      if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onPopup(call, spanRef.current, location);
      }
    },
    [call, location, onPopup],
  );

  if (!call) return children || null;

  if (onPopup) {
    const handleClick = (e) => {
      e.stopPropagation();
      onPopup(call, spanRef.current, location);
    };

    return (
      <span
        ref={spanRef}
        role="button"
        tabIndex={0}
        aria-label={`Look up ${call}`}
        onClick={handleClick}
        onKeyDown={triggerPopup}
        style={{
          color,
          fontWeight,
          fontSize,
          cursor: 'pointer',
          borderBottom: '1px dotted rgba(255,255,255,0.15)',
          transition: 'color 0.15s',
          ...style,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--accent-cyan)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = color;
        }}
        title={`Look up ${call}`}
      >
        {children || call}
      </span>
    );
  }

  // No popup handler — render as plain text
  return <span style={{ color, fontWeight, fontSize, ...style }}>{children || call}</span>;
}
