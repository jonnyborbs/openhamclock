/**
 * Named dockable layout presets — storage model, lazy legacy migration,
 * caps, and rename/delete/activate guards (src/store/layoutStore.js).
 *
 * Backward-compat contract under test: the Default preset's model ALWAYS
 * lives in the legacy `openhamclock_dockLayout` key — the presets key never
 * stores it — so existing users' layouts (and older builds) are untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// saveLayout/savePresetState lazily import config.js to trigger a server
// sync — stub it out so tests don't hit the network.
vi.mock('../utils/config.js', () => ({ syncAllSettingsToServer: vi.fn() }));

import {
  DEFAULT_LAYOUT,
  loadLayout,
  saveLayout,
  loadPresetState,
  listPresets,
  getPresetById,
  getActivePresetId,
  getActiveLayout,
  getLayoutForPreset,
  saveLayoutForPreset,
  resetActiveLayout,
  createPreset,
  renamePreset,
  deletePreset,
  activatePreset,
  DEFAULT_PRESET_ID,
  MAX_PRESETS,
  MAX_PRESET_NAME_LENGTH,
  PRESETS_STORAGE_KEY,
  PRESETS_CHANGED_EVENT,
} from './layoutStore.js';

const LEGACY_KEY = 'openhamclock_dockLayout';

// A minimal-but-valid flexlayout model json (loadLayout requires global+layout)
const fakeModel = (marker) => ({
  global: { marker },
  borders: [],
  layout: { type: 'row', weight: 100, children: [] },
});

beforeEach(() => {
  localStorage.clear();
});

describe('preset state / legacy migration', () => {
  it('starts as a Default-only state when the presets key is absent', () => {
    const state = loadPresetState();
    expect(state.activeId).toBe(DEFAULT_PRESET_ID);
    expect(state.presets).toEqual([{ id: DEFAULT_PRESET_ID, name: 'Default' }]);
  });

  it('Default resolves through the legacy key, before and after presets exist', () => {
    saveLayout(fakeModel('legacy'));
    expect(getActiveLayout().global.marker).toBe('legacy');

    createPreset('Contest view', fakeModel('contest'));
    activatePreset(DEFAULT_PRESET_ID);
    expect(getActiveLayout().global.marker).toBe('legacy');
    // The presets key never carries Default's model — that stays in the legacy key
    const stored = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY));
    expect(stored.presets.find((p) => p.id === DEFAULT_PRESET_ID)?.model).toBeUndefined();
  });

  it('falls back to a sane state on corrupt presets JSON', () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, '{nope');
    const state = loadPresetState();
    expect(state.activeId).toBe(DEFAULT_PRESET_ID);
    expect(state.presets).toHaveLength(1);
  });

  it('drops an activeId that no longer exists', () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify({ presets: [], activeId: 'ghost' }));
    expect(getActivePresetId()).toBe(DEFAULT_PRESET_ID);
  });
});

describe('createPreset', () => {
  it('duplicates a model under a name and activates the copy', () => {
    const p = createPreset('  Night shift  ', fakeModel('night'));
    expect(p).toBeTruthy();
    expect(p.name).toBe('Night shift'); // trimmed
    expect(getActivePresetId()).toBe(p.id);
    expect(getActiveLayout().global.marker).toBe('night');
    expect(listPresets().map((x) => x.name)).toEqual(['Default', 'Night shift']);
  });

  it('caps the name length', () => {
    const p = createPreset('x'.repeat(MAX_PRESET_NAME_LENGTH + 20), fakeModel('m'));
    expect(p.name).toHaveLength(MAX_PRESET_NAME_LENGTH);
  });

  it('rejects empty names and enforces the preset cap', () => {
    expect(createPreset('   ', fakeModel('m'))).toBeNull();
    for (let i = 0; i < MAX_PRESETS - 1; i++) expect(createPreset(`P${i}`, fakeModel(`m${i}`))).toBeTruthy();
    expect(listPresets()).toHaveLength(MAX_PRESETS);
    expect(createPreset('One too many', fakeModel('overflow'))).toBeNull();
    expect(listPresets()).toHaveLength(MAX_PRESETS);
  });
});

describe('renamePreset / deletePreset guards', () => {
  it('never renames or deletes Default', () => {
    expect(renamePreset(DEFAULT_PRESET_ID, 'Not default')).toBe(false);
    expect(deletePreset(DEFAULT_PRESET_ID)).toBe(false);
    expect(listPresets()[0]).toEqual({ id: DEFAULT_PRESET_ID, name: 'Default' });
  });

  it('renames a custom preset (trimmed), rejects unknown ids and empty names', () => {
    const p = createPreset('Old name', fakeModel('m'));
    expect(renamePreset(p.id, '  New name ')).toBe(true);
    expect(getPresetById(p.id).name).toBe('New name');
    expect(renamePreset('ghost', 'X')).toBe(false);
    expect(renamePreset(p.id, '   ')).toBe(false);
    expect(getPresetById(p.id).name).toBe('New name');
  });

  it('deleting the active preset falls back to Default', () => {
    const p = createPreset('Doomed', fakeModel('m'));
    expect(getActivePresetId()).toBe(p.id);
    expect(deletePreset(p.id)).toBe(true);
    expect(getActivePresetId()).toBe(DEFAULT_PRESET_ID);
    expect(getPresetById(p.id)).toBeNull();
  });

  it('deleting an inactive preset keeps the active one', () => {
    const a = createPreset('A', fakeModel('a'));
    const b = createPreset('B', fakeModel('b'));
    expect(deletePreset(a.id)).toBe(true);
    expect(getActivePresetId()).toBe(b.id);
  });
});

describe('activation and per-preset saves', () => {
  it('activatePreset switches the resolved layout and rejects unknown ids', () => {
    saveLayout(fakeModel('legacy'));
    const p = createPreset('Alt', fakeModel('alt'));
    expect(activatePreset(DEFAULT_PRESET_ID)).toBe(true);
    expect(getActiveLayout().global.marker).toBe('legacy');
    expect(activatePreset(p.id)).toBe(true);
    expect(getActiveLayout().global.marker).toBe('alt');
    expect(activatePreset('ghost')).toBe(false);
    expect(getActivePresetId()).toBe(p.id);
  });

  it('saveLayoutForPreset routes Default to the legacy key and customs to the presets key', () => {
    const p = createPreset('Alt', fakeModel('alt'));
    saveLayoutForPreset(DEFAULT_PRESET_ID, fakeModel('legacy-v2'));
    expect(JSON.parse(localStorage.getItem(LEGACY_KEY)).global.marker).toBe('legacy-v2');
    saveLayoutForPreset(p.id, fakeModel('alt-v2'));
    expect(getLayoutForPreset(p.id).global.marker).toBe('alt-v2');
    expect(loadLayout().global.marker).toBe('legacy-v2'); // legacy key untouched by custom save
  });

  it('resetActiveLayout resets only the active preset', () => {
    saveLayout(fakeModel('legacy'));
    const p = createPreset('Alt', fakeModel('alt'));
    expect(resetActiveLayout()).toEqual(DEFAULT_LAYOUT);
    expect(getLayoutForPreset(p.id)).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout().global.marker).toBe('legacy'); // Default untouched
  });

  it('fires the presets-changed event on mutations', () => {
    const seen = vi.fn();
    window.addEventListener(PRESETS_CHANGED_EVENT, seen);
    const p = createPreset('Evented', fakeModel('m'));
    activatePreset(DEFAULT_PRESET_ID);
    renamePreset(p.id, 'Evented 2');
    deletePreset(p.id);
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(4);
    window.removeEventListener(PRESETS_CHANGED_EVENT, seen);
  });
});
