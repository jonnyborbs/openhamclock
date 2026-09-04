/**
 * Star Trek Day 2026 — one-shot event notification.
 *
 * Shows once per browser during September 7-9, 2026 (local dates, same
 * convention as the seasonal easter eggs): a blurb for Star Trek Day —
 * September 8, 2026 is the 60th anniversary of the 1966 premiere — a nudge
 * toward the Trek theme with an Engage button that applies it on the spot,
 * and the Special Event Station N3S operating schedule. Either button
 * (Engage or OK) dismisses it permanently via localStorage.
 *
 * Preview: `?stday` in the URL forces it open regardless of date or
 * dismissal (kept out of the manual, like `?egg=`). The preview never
 * writes the dismissed flag, so checking the popup early doesn't eat the
 * real September showing.
 */
import { useState } from 'react';
import { useTheme } from '../theme/useTheme';

const LS_KEY = 'ohc_startrekday_2026_dismissed';
const LCARS_ORANGE = '#ff9c00';
const LCARS_LAVENDER = '#9999cc';

/** Local-date window: September 7-9, 2026. Exported for tests. */
export function inStarTrekDayWindow(date = new Date()) {
  return date.getFullYear() === 2026 && date.getMonth() === 8 && date.getDate() >= 7 && date.getDate() <= 9;
}

/** Whether the modal should show. Exported for tests. */
export function shouldShowStarTrekDay({ date = new Date(), dismissed = false, forced = false } = {}) {
  if (forced) return true;
  return !dismissed && inStarTrekDayWindow(date);
}

const isForced = () => {
  try {
    return new URLSearchParams(window.location.search).has('stday');
  } catch {
    return false;
  }
};

export default function StarTrekDayModal() {
  const { setTheme } = useTheme();
  const [forced] = useState(isForced);
  const [open, setOpen] = useState(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(LS_KEY) === '1';
    } catch {}
    return shouldShowStarTrekDay({ dismissed, forced: isForced() });
  });

  if (!open) return null;

  const dismiss = () => {
    // A forced preview never writes the flag — checking the popup early
    // shouldn't eat the real September showing.
    if (!forced) {
      try {
        localStorage.setItem(LS_KEY, '1');
      } catch {}
    }
    setOpen(false);
  };

  const engage = () => {
    setTheme('trek');
    dismiss();
  };

  const pill = (text, color) => (
    <span
      style={{
        display: 'inline-block',
        background: color,
        color: '#000',
        borderRadius: '999px',
        padding: '1px 10px',
        fontWeight: 700,
        fontSize: '11px',
        letterSpacing: '0.5px',
      }}
    >
      {text}
    </span>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Star Trek Day"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          maxWidth: '560px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#000',
          border: `2px solid ${LCARS_ORANGE}`,
          borderLeft: `16px solid ${LCARS_ORANGE}`,
          borderRadius: '24px 8px 8px 24px',
          padding: '18px 22px',
          color: '#ffcc99',
          fontFamily: "'Antonio', 'Arial Narrow', 'Helvetica Neue', sans-serif",
        }}
      >
        <div
          style={{
            background: LCARS_ORANGE,
            color: '#000',
            borderRadius: '999px',
            padding: '4px 16px',
            fontWeight: 700,
            fontSize: '16px',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            marginBottom: '14px',
          }}
        >
          🖖 Happy Star Trek Day
        </div>

        <p style={{ fontSize: '14px', lineHeight: 1.5, margin: '0 0 12px' }}>
          On September 8, 1966, Star Trek aired for the very first time — which makes this Star Trek Day the{' '}
          <b style={{ color: LCARS_ORANGE }}>60th anniversary</b>. In celebration, OpenHamClock has a full LCARS
          bridge-console theme. Engage it below, or find it any time in Settings → Display.
        </p>

        <div
          style={{
            border: `1px solid ${LCARS_LAVENDER}`,
            borderRadius: '10px',
            padding: '10px 14px',
            marginBottom: '12px',
            fontSize: '13px',
            lineHeight: 1.55,
          }}
        >
          <div style={{ marginBottom: '6px' }}>{pill('SPECIAL EVENT STATION N3S', LCARS_LAVENDER)}</div>
          <b style={{ color: '#fff' }}>N3S</b> is on the air <b>September 7–9</b>, daily from{' '}
          <b>9 AM–9 PM Eastern (1300–0100 UTC)</b>, with operators scattered across all three days on <b>all modes</b>.
          <br />
          <br />
          Catch project lead <b style={{ color: LCARS_ORANGE }}>K0CJH</b> and contributor{' '}
          <b style={{ color: LCARS_ORANGE }}>N3DD</b> running <b>1,500 watts</b> across the USA from New Jersey:
          <br />• Monday 1–5 PM Eastern (1700–2100 UTC)
          <br />• Tuesday 5–9 PM Eastern (2100–0100 UTC)
          <br />
          <br />
          See the <b>N3S page on QRZ</b> for details and a peek at the QSL card design.
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={engage}
            style={{
              background: LCARS_ORANGE,
              color: '#000',
              border: 'none',
              borderRadius: '999px',
              padding: '6px 18px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
            }}
          >
            Engage Trek Theme
          </button>
          <button
            type="button"
            onClick={dismiss}
            style={{
              background: 'transparent',
              color: LCARS_LAVENDER,
              border: `1px solid ${LCARS_LAVENDER}`,
              borderRadius: '999px',
              padding: '6px 18px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textTransform: 'uppercase',
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
