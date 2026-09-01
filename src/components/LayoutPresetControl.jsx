/**
 * LayoutPresetControl — compact named-layout-preset picker for the dockable
 * layout. Lives in the sidebar's dockable controls section, next to the
 * layout lock and reset buttons (the same place the old "Layout" border tab
 * migrated to).
 *
 * Presets are managed by src/store/layoutStore.js. Switching/rename/delete go
 * straight to the store; "Duplicate current…" is dispatched as a window event
 * because only DockableApp holds the live (possibly unsaved) flexlayout model.
 * The store fires PRESETS_CHANGED_EVENT after every mutation, which both this
 * control and DockableApp listen to.
 *
 * Uses window.prompt/confirm, matching the app's existing idiom for the
 * dockable layout (see the reset-layout confirm in DockableApp).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listPresets,
  getActivePresetId,
  activatePreset,
  renamePreset,
  deletePreset,
  DEFAULT_PRESET_ID,
  MAX_PRESETS,
  PRESETS_CHANGED_EVENT,
} from '../store/layoutStore.js';

const readState = () => ({ presets: listPresets(), activeId: getActivePresetId() });

const smallBtnStyle = (disabled) => ({
  flex: '1 1 auto',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
  padding: '3px 0',
  fontSize: '11px',
  fontFamily: 'var(--font-mono)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
});

export default function LayoutPresetControl({ isExpanded = false, isVisible = true }) {
  const { t } = useTranslation();
  const [{ presets, activeId }, setState] = useState(readState);

  useEffect(() => {
    const refresh = () => setState(readState());
    window.addEventListener(PRESETS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PRESETS_CHANGED_EVENT, refresh);
  }, []);

  const active = presets.find((p) => p.id === activeId) || presets[0];
  const isDefault = active?.id === DEFAULT_PRESET_ID;

  const handleDuplicate = useCallback(() => {
    if (presets.length >= MAX_PRESETS) {
      window.alert(
        t('dockPresets.limit', { defaultValue: 'Preset limit reached ({{max}}). Delete one first.', max: MAX_PRESETS }),
      );
      return;
    }
    const name = window.prompt(
      t('dockPresets.duplicatePrompt', { defaultValue: 'Name for the new layout preset:' }),
      t('dockPresets.duplicateDefaultName', { defaultValue: '{{name}} copy', name: active?.name || 'Layout' }),
    );
    if (!name || !name.trim()) return;
    window.dispatchEvent(new CustomEvent('openhamclock:dock-preset-duplicate', { detail: { name: name.trim() } }));
  }, [presets.length, active, t]);

  const handleRename = useCallback(() => {
    if (isDefault) return;
    const name = window.prompt(
      t('dockPresets.renamePrompt', { defaultValue: 'New name for "{{name}}":', name: active?.name }),
      active?.name || '',
    );
    if (!name || !name.trim()) return;
    renamePreset(active.id, name.trim());
  }, [isDefault, active, t]);

  const handleDelete = useCallback(() => {
    if (isDefault) return;
    if (
      window.confirm(
        t('dockPresets.deleteConfirm', { defaultValue: 'Delete layout preset "{{name}}"?', name: active?.name }),
      )
    ) {
      deletePreset(active.id);
    }
  }, [isDefault, active, t]);

  // Collapsed sidebar: a single icon button that cycles through presets.
  if (!isExpanded) {
    const cycle = () => {
      if (presets.length < 2) return;
      const idx = presets.findIndex((p) => p.id === activeId);
      activatePreset(presets[(idx + 1) % presets.length].id);
    };
    const title =
      presets.length > 1
        ? t('dockPresets.cycleTitle', { defaultValue: 'Layout preset: {{name}} — click for next', name: active?.name })
        : t('dockPresets.currentTitle', { defaultValue: 'Layout preset: {{name}}', name: active?.name });
    return (
      <button
        type="button"
        onClick={cycle}
        title={title}
        aria-label={title}
        tabIndex={isVisible ? 0 : -1}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDefault ? 'var(--bg-tertiary)' : 'rgba(0, 255, 204, 0.1)',
          border: `1px solid ${isDefault ? 'var(--border-color)' : 'var(--accent-cyan)'}`,
          borderRadius: '4px',
          color: isDefault ? 'var(--text-secondary)' : 'var(--accent-cyan)',
          padding: '5px 0',
          cursor: presets.length > 1 ? 'pointer' : 'default',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 9v12" />
        </svg>
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <select
        value={activeId}
        onChange={(e) => activatePreset(e.target.value)}
        aria-label={t('dockPresets.select', { defaultValue: 'Layout preset' })}
        title={t('dockPresets.select', { defaultValue: 'Layout preset' })}
        tabIndex={isVisible ? 0 : -1}
        style={{
          width: '100%',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: 'var(--text-primary)',
          padding: '4px 6px',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          cursor: 'pointer',
        }}
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: '4px' }}>
        <button
          type="button"
          onClick={handleDuplicate}
          title={t('dockPresets.duplicate', { defaultValue: 'Duplicate current layout as a new preset' })}
          aria-label={t('dockPresets.duplicate', { defaultValue: 'Duplicate current layout as a new preset' })}
          tabIndex={isVisible ? 0 : -1}
          style={smallBtnStyle(false)}
        >
          ⧉
        </button>
        <button
          type="button"
          onClick={handleRename}
          disabled={isDefault}
          title={
            isDefault
              ? t('dockPresets.renameDefault', { defaultValue: 'The Default preset cannot be renamed' })
              : t('dockPresets.rename', { defaultValue: 'Rename preset' })
          }
          aria-label={t('dockPresets.rename', { defaultValue: 'Rename preset' })}
          tabIndex={isVisible ? 0 : -1}
          style={smallBtnStyle(isDefault)}
        >
          ✎
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDefault}
          title={
            isDefault
              ? t('dockPresets.deleteDefault', { defaultValue: 'The Default preset cannot be deleted' })
              : t('dockPresets.delete', { defaultValue: 'Delete preset' })
          }
          aria-label={t('dockPresets.delete', { defaultValue: 'Delete preset' })}
          tabIndex={isVisible ? 0 : -1}
          style={smallBtnStyle(isDefault)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
