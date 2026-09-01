/**
 * Minimal shared toast — non-blocking, self-dismissing notice.
 *
 * There is no app-wide React toast system; the existing toasts (PWA update in
 * pwa/registerServiceWorker.js, version reload in hooks/app/useVersionCheck.js)
 * are plain-DOM one-offs. This util centralizes that pattern for reuse from
 * both React and non-React code (e.g. RigContext's tune privilege warning).
 *
 * One toast at a time: a new call replaces the current one.
 */

const TOAST_ID = 'ohc-toast';
const STYLE_ID = 'ohc-toast-styles';

const VARIANTS = {
  info: { border: 'rgba(56, 189, 248, 0.55)', glow: 'rgba(56, 189, 248, 0.15)', icon: 'ℹ️' },
  warning: { border: 'rgba(245, 158, 11, 0.65)', glow: 'rgba(245, 158, 11, 0.18)', icon: '⚠️' },
};

let dismissTimer = null;

const ensureStyles = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes ohc-toast-in {
      from { transform: translateX(-50%) translateY(30px); opacity: 0; }
      to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    #${TOAST_ID}.ohc-toast-out {
      transition: opacity 0.3s ease, transform 0.3s ease;
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
  `;
  document.head.appendChild(style);
};

export const dismissToast = () => {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  const existing = document.getElementById(TOAST_ID);
  if (!existing) return;
  existing.classList.add('ohc-toast-out');
  setTimeout(() => existing.remove(), 320);
};

/**
 * Show a transient toast at the bottom center of the screen.
 * @param {string} message - Plain-text message (rendered via textContent — safe)
 * @param {Object} [opts]
 * @param {'info'|'warning'} [opts.variant='info']
 * @param {number} [opts.duration=6000] - Auto-dismiss after ms
 * @param {string} [opts.title] - Optional bold first line
 * @param {string} [opts.icon] - Emoji override
 */
export const showToast = (message, { variant = 'info', duration = 6000, title = '', icon = '' } = {}) => {
  if (typeof document === 'undefined' || !message) return;
  const v = VARIANTS[variant] || VARIANTS.info;
  ensureStyles();

  // Replace any existing toast (and cancel its pending dismiss)
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  document.getElementById(TOAST_ID)?.remove();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const iconSpan = document.createElement('span');
  iconSpan.style.fontSize = '20px';
  iconSpan.textContent = icon || v.icon;

  const textWrap = document.createElement('div');
  if (title) {
    const titleDiv = document.createElement('div');
    Object.assign(titleDiv.style, { fontWeight: '700', fontSize: '13px' });
    titleDiv.textContent = title;
    textWrap.appendChild(titleDiv);
  }
  const msgDiv = document.createElement('div');
  Object.assign(msgDiv.style, {
    fontSize: title ? '11px' : '12px',
    opacity: title ? '0.85' : '1',
    marginTop: title ? '2px' : '0',
  });
  msgDiv.textContent = message;
  textWrap.appendChild(msgDiv);

  const inner = document.createElement('div');
  Object.assign(inner.style, { display: 'flex', alignItems: 'center', gap: '10px' });
  inner.appendChild(iconSpan);
  inner.appendChild(textWrap);
  toast.appendChild(inner);

  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'min(92vw, 480px)',
    background: 'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(10,15,25,0.95))',
    border: `1px solid ${v.border}`,
    borderRadius: '12px',
    padding: '12px 20px',
    color: '#e2e8f0',
    fontFamily: 'var(--font-mono, monospace)',
    zIndex: '999999',
    boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 20px ${v.glow}`,
    animation: 'ohc-toast-in 0.35s ease-out',
    cursor: 'pointer',
  });

  toast.addEventListener('click', dismissToast);
  document.body.appendChild(toast);

  dismissTimer = setTimeout(dismissToast, duration);
};
