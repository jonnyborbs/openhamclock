/**
 * CommandPalette — named dockable layout preset entries (`dockable#<id>`).
 *
 * Verifies the Layout category lists each preset as "Dockable — <name>",
 * skips the preset currently showing, and that running an entry activates
 * the preset (and switches config.layout to 'dockable' when needed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// t() → defaultValue with {{var}} interpolation (no i18n setup needed)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      let s = (opts && opts.defaultValue) || key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          if (k !== 'defaultValue') s = s.split(`{{${k}}}`).join(String(v));
        }
      }
      return s;
    },
  }),
}));

// Keep the test focused: no real panel registry, icons, or help topics.
vi.mock('../panelDefs.js', () => ({ buildPanelDefs: () => ({}) }));
vi.mock('./Icons.jsx', () => ({ PanelIcon: () => null }));
vi.mock('../utils/helpTopics.js', () => ({ HELP_TOPICS: {}, openHelp: vi.fn() }));

const presetStore = vi.hoisted(() => ({
  presets: [{ id: 'default', name: 'Default' }],
  activeId: 'default',
  activatePreset: null,
}));
vi.mock('../store/layoutStore.js', () => ({
  listPresets: () => presetStore.presets,
  getActivePresetId: () => presetStore.activeId,
  activatePreset: (...args) => presetStore.activatePreset(...args),
}));

import { CommandPalette } from './CommandPalette.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no scrollIntoView (the palette keeps the selected row visible)
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

let root;
let container;
let onSaveConfig;
let onClose;

const renderPalette = (config) => {
  act(() => {
    root.render(
      <CommandPalette
        isOpen={true}
        onClose={onClose}
        config={config}
        onSaveConfig={onSaveConfig}
        isLocalInstall={false}
      />,
    );
  });
};

const optionTexts = () => [...container.querySelectorAll('[role="option"]')].map((el) => el.textContent);
const clickOption = (text) => {
  const el = [...container.querySelectorAll('[role="option"]')].find((n) => n.textContent.includes(text));
  expect(el).toBeTruthy();
  act(() => el.click());
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSaveConfig = vi.fn();
  onClose = vi.fn();
  presetStore.activeId = 'default';
  presetStore.presets = [
    { id: 'default', name: 'Default' },
    { id: 'p-night', name: 'Night shift' },
    { id: 'p-field', name: 'Field day' },
  ];
  presetStore.activatePreset = vi.fn(() => true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('CommandPalette layout-preset entries', () => {
  it('lists every preset as "Dockable — <name>" alongside base layouts', () => {
    renderPalette({ layout: 'modern' });
    const texts = optionTexts().join('\n');
    expect(texts).toContain('Switch layout: station.settings.layout.dockable — Default');
    expect(texts).toContain('Switch layout: station.settings.layout.dockable — Night shift');
    expect(texts).toContain('Switch layout: station.settings.layout.dockable — Field day');
  });

  it('hides preset entries entirely when only Default exists', () => {
    presetStore.presets = [{ id: 'default', name: 'Default' }];
    renderPalette({ layout: 'modern' });
    expect(optionTexts().join('\n')).not.toContain('dockable — ');
  });

  it('skips the preset currently showing in the dockable layout', () => {
    presetStore.activeId = 'p-night';
    renderPalette({ layout: 'dockable' });
    const texts = optionTexts().join('\n');
    expect(texts).not.toContain('dockable — Night shift');
    expect(texts).toContain('dockable — Field day');
  });

  it('running an entry activates the preset and switches layout when needed', () => {
    renderPalette({ layout: 'modern' });
    clickOption('dockable — Night shift');
    expect(presetStore.activatePreset).toHaveBeenCalledWith('p-night');
    expect(onSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ layout: 'dockable' }));
  });

  it('does not re-save config.layout when already in the dockable layout', () => {
    presetStore.activeId = 'default';
    renderPalette({ layout: 'dockable' });
    clickOption('dockable — Field day');
    expect(presetStore.activatePreset).toHaveBeenCalledWith('p-field');
    expect(onSaveConfig).not.toHaveBeenCalled();
  });
});
