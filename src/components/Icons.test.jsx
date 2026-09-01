/**
 * Guard test: the chrome line-icon registry must cover every built-in
 * panel id and every settings tab. If a new panel is added to
 * panelDefs.js without a PANEL_ICONS entry, this fails instead of the
 * picker silently falling back to the emoji string (that fallback is
 * reserved for plugin panels — the documented contract).
 *
 * Deliberately snapshot-free: we assert each id resolves to a component
 * (function), not what the SVG looks like — the geometry is approved
 * design data, not test surface.
 */
import { describe, it, expect } from 'vitest';
import { buildPanelDefs } from '../panelDefs.js';
import { PANEL_ICONS, SETTINGS_TAB_ICONS, PanelIcon } from './Icons.jsx';

// Must match SettingsPanel's SETTINGS_TABS / SidebarMenu's MENU_ITEMS ids.
const SETTINGS_TAB_IDS = [
  'station',
  'integrations',
  'display',
  'layers',
  'satellites',
  'profiles',
  'community',
  'alerts',
  'rig-bridge',
  'help',
];

describe('PANEL_ICONS registry completeness', () => {
  it('covers every built-in id from buildPanelDefs (plugins excluded — they keep emoji)', () => {
    const defs = buildPanelDefs({ isLocalInstall: true });
    for (const [id, def] of Object.entries(defs)) {
      if (def.group === 'Plugins') continue; // emoji fallback is the plugin contract
      expect(typeof PANEL_ICONS[id], `PANEL_ICONS['${id}'] missing for panel "${def.name}"`).toBe('function');
    }
  });

  it('covers conditional panels even when their env gate is off', () => {
    // `ambient` needs VITE_AMBIENT_* env keys and `rotator` needs a local
    // install, so buildPanelDefs may omit them here — the registry still
    // must know them.
    expect(typeof PANEL_ICONS.ambient).toBe('function');
    expect(typeof PANEL_ICONS.rotator).toBe('function');
  });
});

describe('SETTINGS_TAB_ICONS registry completeness', () => {
  it('covers every settings tab id', () => {
    for (const id of SETTINGS_TAB_IDS) {
      expect(typeof SETTINGS_TAB_ICONS[id], `SETTINGS_TAB_ICONS['${id}'] missing`).toBe('function');
    }
  });
});

describe('PanelIcon fallback', () => {
  it('is a component (renders registry icon or the emoji string for unknown ids)', () => {
    expect(typeof PanelIcon).toBe('function');
  });
});
