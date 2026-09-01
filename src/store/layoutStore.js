/**
 * Layout Store - Manages dockable panel layout state
 * Uses flexlayout-react for panel resizing, docking, and tabs
 */

// Default layout configuration with individual dockable panels
export const DEFAULT_LAYOUT = {
  global: {
    tabEnableFloat: false,
    tabSetMinWidth: 200,
    tabSetMinHeight: 100,
    borderMinSize: 100,
    splitterSize: 6,
    tabEnableClose: true,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetEnableDrop: true,
    tabSetEnableDrag: true,
    tabSetEnableTabStrip: true,
  },
  borders: [],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'row',
        weight: 22,
        children: [
          {
            type: 'tabset',
            weight: 50,
            id: 'left-top-tabset',
            children: [
              { type: 'tab', name: 'DE Location', component: 'de-location', id: 'de-location-tab' },
              { type: 'tab', name: 'DX Target', component: 'dx-location', id: 'dx-location-tab' },
            ],
          },
          {
            type: 'tabset',
            weight: 50,
            id: 'left-bottom-tabset',
            children: [
              { type: 'tab', name: 'Solar', component: 'solar', id: 'solar-tab' },
              { type: 'tab', name: 'Propagation', component: 'propagation', id: 'propagation-tab' },
              { type: 'tab', name: 'Ambient', component: 'ambient', id: 'ambient-tab' },
              { type: 'tab', name: 'Band Health', component: 'band-health', id: 'band-health-tab' },
            ],
          },
        ],
      },
      {
        type: 'tabset',
        weight: 56,
        id: 'center-tabset',
        children: [{ type: 'tab', name: 'World Map', component: 'world-map', id: 'map-tab' }],
      },
      {
        type: 'row',
        weight: 22,
        children: [
          {
            type: 'tabset',
            weight: 60,
            id: 'right-top-tabset',
            children: [
              { type: 'tab', name: 'DX Cluster', component: 'dx-cluster', id: 'dx-cluster-tab' },
              { type: 'tab', name: 'PSK Reporter', component: 'psk-reporter', id: 'psk-reporter-tab' },
            ],
          },
          {
            type: 'tabset',
            weight: 40,
            id: 'right-bottom-tabset',
            children: [
              { type: 'tab', name: 'DXpeditions', component: 'dxpeditions', id: 'dxpeditions-tab' },
              { type: 'tab', name: 'POTA', component: 'pota', id: 'pota-tab' },
              { type: 'tab', name: 'SOTA', component: 'sota', id: 'sota-tab' },
              { type: 'tab', name: 'Contests', component: 'contests', id: 'contests-tab' },
            ],
          },
        ],
      },
    ],
  },
};

// Load layout from localStorage
export const loadLayout = () => {
  try {
    const stored = localStorage.getItem('openhamclock_dockLayout');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate basic structure
      if (parsed.global && parsed.layout) {
        // Migrate: remove old layout border panel (now in sidebar menu)
        if (parsed.borders) {
          // Strip old layout/lock-layout tabs and remove empty borders entirely
          const before = JSON.stringify(parsed.borders);
          for (const border of parsed.borders) {
            border.children = (border.children || []).filter(
              (c) => c.component !== 'layout' && c.component !== 'lock-layout',
            );
          }
          // Remove borders with no children left — prevents empty drop-zone strip
          parsed.borders = parsed.borders.filter((b) => (b.children || []).length > 0);
          if (JSON.stringify(parsed.borders) !== before) saveLayout(parsed);
        }
        if (!parsed.borders) parsed.borders = [];
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load layout from localStorage:', e);
  }
  return DEFAULT_LAYOUT;
};

// Save layout to localStorage
export const saveLayout = (layout) => {
  try {
    localStorage.setItem('openhamclock_dockLayout', JSON.stringify(layout));
    // Lazy import to avoid circular dependency
    import('../utils/config.js').then((m) => m.syncAllSettingsToServer());
  } catch (e) {
    console.error('Failed to save layout:', e);
  }
};

// Reset layout to default
export const resetLayout = () => {
  try {
    localStorage.removeItem('openhamclock_dockLayout');
  } catch (e) {
    console.error('Failed to reset layout:', e);
  }
  return DEFAULT_LAYOUT;
};

// ============================================================
// Named layout presets
// ============================================================
// Multiple saved dockable arrangements the user can switch between (and rotate
// through via scene rotation, addressed as `dockable#<id>`).
//
// Storage model — full backward compatibility with the legacy single-layout key:
//   • openhamclock_dockLayoutPresets = { presets: [{ id, name, model? }], activeId }
//   • The "Default" preset (id 'default') NEVER stores a model here — its model
//     lives in the legacy `openhamclock_dockLayout` key, exactly as before this
//     feature existed. Existing users' layouts keep working (and keep syncing)
//     untouched; older builds reading only the legacy key still see Default.
//   • Custom presets store their model inline in the presets key.
// The presets key is created lazily on the first preset mutation.

export const PRESETS_STORAGE_KEY = 'openhamclock_dockLayoutPresets';
export const DEFAULT_PRESET_ID = 'default';
export const MAX_PRESETS = 10;
export const MAX_PRESET_NAME_LENGTH = 40;
export const PRESETS_CHANGED_EVENT = 'openhamclock:dock-presets-changed';

const sanitizePresetName = (name) =>
  String(name ?? '')
    .trim()
    .slice(0, MAX_PRESET_NAME_LENGTH);

const newPresetId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const defaultPresetRecord = () => ({ id: DEFAULT_PRESET_ID, name: 'Default' });

/**
 * Load the preset state, always well-formed: Default first, activeId valid.
 * Never throws; falls back to a Default-only state.
 */
export const loadPresetState = () => {
  const fallback = { presets: [defaultPresetRecord()], activeId: DEFAULT_PRESET_ID };
  try {
    const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    const raw = Array.isArray(parsed?.presets) ? parsed.presets : [];
    const customs = raw.filter(
      (p) => p && typeof p.id === 'string' && p.id !== DEFAULT_PRESET_ID && typeof p.name === 'string',
    );
    const presets = [defaultPresetRecord(), ...customs.slice(0, MAX_PRESETS - 1)];
    const activeId = presets.some((p) => p.id === parsed?.activeId) ? parsed.activeId : DEFAULT_PRESET_ID;
    return { presets, activeId };
  } catch (e) {
    console.warn('Failed to load layout presets:', e);
    return fallback;
  }
};

const emitPresetsChanged = () => {
  try {
    window.dispatchEvent(new CustomEvent(PRESETS_CHANGED_EVENT));
  } catch {}
};

const savePresetState = (state) => {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(state));
    // Lazy import to avoid circular dependency (same pattern as saveLayout)
    import('../utils/config.js').then((m) => m.syncAllSettingsToServer());
  } catch (e) {
    console.error('Failed to save layout presets:', e);
  }
  emitPresetsChanged();
};

/** Lightweight list for pickers: [{ id, name }] (Default always first). */
export const listPresets = () => loadPresetState().presets.map(({ id, name }) => ({ id, name }));

export const getPresetById = (id) => loadPresetState().presets.find((p) => p.id === id) || null;

export const getActivePresetId = () => loadPresetState().activeId;

/** Resolve the layout JSON for a preset id (Default → legacy key). */
export const getLayoutForPreset = (id) => {
  if (!id || id === DEFAULT_PRESET_ID) return loadLayout();
  const preset = getPresetById(id);
  if (preset?.model?.global && preset.model.layout) return preset.model;
  return loadLayout(); // unknown/corrupt preset — fall back to Default's model
};

/** Layout JSON for whichever preset is currently active. */
export const getActiveLayout = () => getLayoutForPreset(getActivePresetId());

/** Persist a layout model under a specific preset id (Default → legacy key). */
export const saveLayoutForPreset = (id, layout) => {
  if (!id || id === DEFAULT_PRESET_ID) {
    saveLayout(layout);
    return;
  }
  const state = loadPresetState();
  const preset = state.presets.find((p) => p.id === id);
  if (!preset) return; // preset was deleted (e.g. on another tab) — drop silently
  preset.model = layout;
  savePresetState(state);
};

/** Reset the active preset's arrangement to the stock default layout. */
export const resetActiveLayout = () => {
  const activeId = getActivePresetId();
  if (activeId === DEFAULT_PRESET_ID) return resetLayout();
  saveLayoutForPreset(activeId, DEFAULT_LAYOUT);
  return DEFAULT_LAYOUT;
};

/**
 * Create a preset from a layout model (typically a duplicate of the current
 * arrangement) and activate it. Returns the new preset record, or null when
 * the name is empty or the cap is reached.
 */
export const createPreset = (name, layoutModel) => {
  const clean = sanitizePresetName(name);
  if (!clean) return null;
  const state = loadPresetState();
  if (state.presets.length >= MAX_PRESETS) return null;
  const preset = { id: newPresetId(), name: clean, model: layoutModel };
  state.presets.push(preset);
  state.activeId = preset.id;
  savePresetState(state);
  return preset;
};

/** Rename a preset. Default cannot be renamed. Returns success. */
export const renamePreset = (id, name) => {
  const clean = sanitizePresetName(name);
  if (!clean || id === DEFAULT_PRESET_ID) return false;
  const state = loadPresetState();
  const preset = state.presets.find((p) => p.id === id);
  if (!preset) return false;
  preset.name = clean;
  savePresetState(state);
  return true;
};

/** Delete a preset. Default cannot be deleted; deleting the active preset falls back to Default. */
export const deletePreset = (id) => {
  if (id === DEFAULT_PRESET_ID) return false;
  const state = loadPresetState();
  const idx = state.presets.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  state.presets.splice(idx, 1);
  if (state.activeId === id) state.activeId = DEFAULT_PRESET_ID;
  savePresetState(state);
  return true;
};

/** Make a preset the active one (its model becomes the live dock layout). Returns success. */
export const activatePreset = (id) => {
  const state = loadPresetState();
  if (!state.presets.some((p) => p.id === id)) return false;
  if (state.activeId === id) return true;
  state.activeId = id;
  savePresetState(state);
  return true;
};
