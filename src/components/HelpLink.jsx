/**
 * HelpLink — small themed "?" button that opens Settings → Help
 * scrolled to the manual section for a given help topic.
 *
 * Topics are keys into HELP_TOPICS (src/utils/helpTopics.js); clicking
 * dispatches the `openhamclock:open-help` event that App.jsx and
 * SettingsPanel listen for.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { openHelp } from '../utils/helpTopics.js';
import { LiHelp } from './Icons.jsx';

/**
 * @param {string} topic - key into HELP_TOPICS (falls back to basics)
 * @param {string} [label] - human name for the aria-label ("Help: <label>")
 * @param {string} [className] - e.g. flexlayout__tab_toolbar_button to
 *   blend into a flexlayout tabset toolbar (skips the default chrome)
 * @param {object} [style] - extra styles merged over the default
 */
export const HelpLink = ({ topic, label, className, style }) => {
  const { t } = useTranslation();
  const aria = t('help.link.label', { topic: label || topic, defaultValue: `Help: ${label || topic}` });

  const defaultStyle = className
    ? { fontFamily: 'var(--font-mono)', fontWeight: 700 }
    : {
        width: '18px',
        height: '18px',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: 'transparent',
        border: '1px solid var(--border-color)',
        borderRadius: '50%',
        color: 'var(--text-muted)',
        fontSize: '11px',
        fontWeight: 700,
        lineHeight: 1,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
      };

  return (
    <button
      type="button"
      className={className}
      aria-label={aria}
      title={aria}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openHelp(topic);
      }}
      onMouseEnter={(e) => {
        if (!className) {
          e.currentTarget.style.color = 'var(--accent-cyan)';
          e.currentTarget.style.borderColor = 'var(--accent-cyan)';
        }
      }}
      onMouseLeave={(e) => {
        if (!className) {
          e.currentTarget.style.color = 'var(--text-muted)';
          e.currentTarget.style.borderColor = 'var(--border-color)';
        }
      }}
      style={{ ...defaultStyle, ...style }}
    >
      {/* Tabset toolbar buttons use the line-icon glyph; the small bordered
          circle elsewhere keeps its typographic "?" (it already draws its
          own ring — nesting i-help's circle would double it up). */}
      {className ? <LiHelp size={20} style={{ display: 'block' }} /> : '?'}
    </button>
  );
};

export default HelpLink;
