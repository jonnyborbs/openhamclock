/**
 * Panel Plugin Registry
 *
 * Mirrors layerRegistry's local auto-discovery, but for dockable panels.
 * Drop `.jsx` files into src/plugins/local/panels/ (gitignored — they survive
 * git updates) exporting:
 *
 *   export const metadata = { id: 'my-panel', name: 'My Panel', icon: '🧩' };
 *   export function Panel({ config, t }) { return <div>…</div>; }
 *
 * Props contract (v1, stable): plugin panels receive exactly
 *   - config  read-only station config (callsign, location, units, …)
 *   - t       the translation function
 * Nothing else is guaranteed. See docs/PLUGINS.md for the full guide.
 *
 * Bad plugins log a warning and are skipped — they must never crash the app.
 * DockableApp additionally wraps each plugin panel render in an ErrorBoundary.
 */

// Panel ids must be url/localStorage-safe and can't collide with built-ins.
const PANEL_ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

/**
 * Validate + collect panel plugin modules.
 * Pure function so it can be unit-tested without import.meta.glob.
 *
 * @param {Record<string, object>} modules - path -> module (as from import.meta.glob eager)
 * @param {Set<string>|string[]} [builtinIds] - built-in panel ids that plugins may not shadow
 * @returns {Array<{id: string, name: string, icon: string, description: string, Panel: Function}>}
 */
export function discoverPanels(modules, builtinIds = new Set()) {
  const reserved = builtinIds instanceof Set ? builtinIds : new Set(builtinIds);
  const seen = new Set();
  const panels = [];

  for (const [path, mod] of Object.entries(modules || {})) {
    const meta = mod?.metadata;
    const Panel = mod?.Panel;

    if (!meta || typeof meta !== 'object') {
      console.warn(`[Panel Plugins] Skipping ${path} — missing metadata export`);
      continue;
    }
    if (typeof Panel !== 'function') {
      console.warn(`[Panel Plugins] Skipping ${path} — missing Panel component export`);
      continue;
    }
    const id = typeof meta.id === 'string' ? meta.id.trim() : '';
    if (!PANEL_ID_RE.test(id)) {
      console.warn(
        `[Panel Plugins] Skipping ${path} — invalid id ${JSON.stringify(meta.id)} (2-40 chars: a-z, 0-9, -, _)`,
      );
      continue;
    }
    if (reserved.has(id)) {
      console.warn(`[Panel Plugins] Skipping ${path} — id "${id}" shadows a built-in panel`);
      continue;
    }
    if (seen.has(id)) {
      console.warn(`[Panel Plugins] Skipping ${path} — duplicate id "${id}"`);
      continue;
    }
    if (!meta.name || typeof meta.name !== 'string') {
      console.warn(`[Panel Plugins] Skipping ${path} — metadata.name is required`);
      continue;
    }

    seen.add(id);
    panels.push({
      id,
      name: meta.name,
      icon: typeof meta.icon === 'string' && meta.icon ? meta.icon : '🧩',
      description: typeof meta.description === 'string' ? meta.description : '',
      Panel,
    });
  }

  return panels;
}

// Auto-discover local panel plugins (gitignored — survive updates).
// The glob resolves at build time; an empty/missing directory yields {}.
const localPanelModules = import.meta.glob('./local/panels/*.jsx', { eager: true });

// Memoized — plugin list never changes at runtime.
let cachedPanels = null;

/**
 * All discovered panel plugins, validated against the given built-in ids.
 * The first caller's builtinIds win (DockableApp calls this once with the
 * full built-in panelDefs key set).
 */
export function getPanelPlugins(builtinIds = new Set()) {
  if (cachedPanels) return cachedPanels;
  cachedPanels = discoverPanels(localPanelModules, builtinIds);
  if (cachedPanels.length > 0) {
    console.info(
      `[Panel Plugins] Loaded ${cachedPanels.length} panel plugin(s):`,
      cachedPanels.map((p) => p.id).join(', '),
    );
  }
  return cachedPanels;
}

export function getPanelPluginById(panelId) {
  return (cachedPanels || []).find((p) => p.id === panelId) || null;
}
