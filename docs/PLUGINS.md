# OpenHamClock Plugin Development

OpenHamClock has two plugin types, both auto-discovered from the gitignored
`src/plugins/local/` directory so your customizations **survive `git pull`
updates**:

| Type               | Drop files in                    | Exports                 | Shows up in                         |
| ------------------ | -------------------------------- | ----------------------- | ----------------------------------- |
| **Map layer**      | `src/plugins/local/*.js`         | `metadata` + `useLayer` | Settings → Map Layers               |
| **Dockable panel** | `src/plugins/local/panels/*.jsx` | `metadata` + `Panel`    | "+" panel picker, under **Plugins** |

Plugins require a self-hosted install (you need the source tree to drop files
into). After adding a file, restart the dev server (`npm run dev`) or rebuild
(`npm run build`).

- [Map layer plugins](#map-layer-plugins)
- [Panel plugins](#panel-plugins)
- [Validation rules & troubleshooting](#validation-rules--troubleshooting)

---

## Map layer plugins

A layer plugin is a React hook that draws on the Leaflet world map. Files in
`src/plugins/local/` are picked up automatically by
`src/plugins/layerRegistry.js` (via Vite's `import.meta.glob`) — no
registration needed. Built-in layers live in `src/plugins/layers/` and use the
same API.

### Minimal layer

```js
// src/plugins/local/useMyLayer.js
import { useEffect } from 'react';

export const metadata = {
  id: 'my-layer', // unique across ALL layers
  name: 'My Custom Layer',
  description: 'What this layer shows',
  icon: '🔧',
  category: 'custom', // grouping in Settings
  defaultEnabled: false,
  defaultOpacity: 0.8,
  // localOnly: true,        // hide on the hosted site, show on self-hosted
};

export function useLayer({ map, enabled, opacity }) {
  useEffect(() => {
    if (!map || typeof L === 'undefined' || !enabled) return;
    const marker = L.circleMarker([39.0, -94.5], { radius: 8, opacity }).addTo(map);
    marker.bindPopup('<b>Hello from my layer</b>');
    return () => {
      try {
        map.removeLayer(marker);
      } catch {}
    };
  }, [map, enabled, opacity]);
}
```

The hook receives `{ map, enabled, opacity }` and must clean up its Leaflet
layers in the effect cleanup. For data fetching, refresh intervals, custom
controls, vector layers, and a full API reference, see the complete guide:
**[src/plugins/OpenHamClock-Plugin-Guide.md](../src/plugins/OpenHamClock-Plugin-Guide.md)**.
Good built-in examples to crib from: `useEarthquakes.js` (markers from an
API), `useWXRadar.js` (tile overlay), `useQsoApiLayer.js` (polling a local
endpoint and drawing great-circle paths).

---

## Panel plugins

A panel plugin is a React component that appears as a dockable panel in the
main layout — draggable, resizable, and tabbed exactly like the built-in
panels. Discovery mirrors the layer system:
`src/plugins/panelRegistry.js` globs `src/plugins/local/panels/*.jsx`.

### Module shape

Each `.jsx` file must export **both**:

```jsx
export const metadata = {
  id: 'my-panel', // required — 2-40 chars: a-z, 0-9, '-', '_'; unique; may not
  //   shadow a built-in panel id (e.g. 'logbook', 'world-map')
  name: 'My Panel', // required — shown in the panel picker and tab title
  icon: '🧩', // optional emoji, defaults to 🧩
  description: '', // optional
};

export function Panel({ config, t }) {
  return <div>…</div>;
}
```

Your panel appears in the **"+" panel picker** (toolbar of any tabset) under a
**Plugins** heading.

### Props contract (v1 — stable)

Plugin panels receive **exactly two props**. Nothing else is guaranteed, and
new props will only ever be added, not removed:

| Prop     | Type     | Description                                                                                                                           |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `config` | object   | **Read-only** station config: `config.callsign`, `config.location.lat/lon`, `config.timezone`, `config.allUnits`, … Do not mutate it. |
| `t`      | function | The translation function (`t('key')`) used by the rest of the app.                                                                    |

Need more data? Fetch it yourself from the server API (see
[API.md](API.md)) — panels are ordinary React components and may use hooks,
`fetch`, intervals, etc.

Every plugin panel render is wrapped in an ErrorBoundary: if your component
throws, that panel shows an error card, but the rest of the app keeps running.

### Full working example

`src/plugins/local/panels/GreetingPanel.jsx` — a small panel that greets the
operator and polls the solar indices endpoint:

```jsx
import React, { useEffect, useState } from 'react';

export const metadata = {
  id: 'greeting',
  name: 'Greeting',
  icon: '👋',
  description: 'Says hello and shows the current SFI',
};

export function Panel({ config, t }) {
  const [sfi, setSfi] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const resp = await fetch('/api/solar-indices');
        if (!resp.ok) return;
        const data = await resp.json();
        if (alive) setSfi(data?.sfi ?? data?.solarflux ?? null);
      } catch {
        // never crash the panel over a fetch error
      }
    };
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div style={{ padding: '14px', height: '100%', overflowY: 'auto' }}>
      <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: '10px' }}>
        👋 Hello, {config.callsign || 'operator'}!
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
        <div>
          QTH: {config.location?.lat?.toFixed(2)}°, {config.location?.lon?.toFixed(2)}°
        </div>
        <div style={{ marginTop: '6px' }}>
          SFI: <span style={{ color: 'var(--accent-amber)' }}>{sfi ?? '…'}</span>
        </div>
      </div>
    </div>
  );
}
```

Drop it in, restart the dev server, click **+** in any tabset — "Greeting"
appears under **Plugins**.

Style notes: use the app's CSS variables (`var(--accent-cyan)`,
`var(--accent-amber)`, `var(--font-mono)`, `var(--text-secondary)`, …) so your
panel matches the active theme, and give your root element
`height: 100%; overflow-y: auto` so it behaves when docked small.

---

## Validation rules & troubleshooting

Bad plugins are **skipped with a console warning** — they never crash the app.
Open the browser console and look for `[Plugins]` / `[Panel Plugins]` lines:

- `missing metadata or useLayer export` / `missing Panel component export` —
  your file doesn't export the required names (named exports, not default).
- `invalid id` — panel ids must match `[a-z0-9][a-z0-9_-]{1,39}` (case-insensitive).
- `shadows a built-in panel` — pick a different `metadata.id`; you can't
  replace built-ins like `logbook` or `world-map`.
- `duplicate id` — two local plugin files claim the same id; the first wins.
- Nothing at all? The file wasn't picked up — layers must be directly in
  `src/plugins/local/` (`.js`/`.jsx`), panels in `src/plugins/local/panels/`
  (`.jsx`), and you must restart/rebuild after adding files.

Registry internals, if you're curious: `src/plugins/layerRegistry.js` and
`src/plugins/panelRegistry.js` (validation logic unit-tested in
`src/plugins/panelRegistry.test.js`).

If you build something generally useful, consider contributing it as a
built-in — see [CONTRIBUTING.md](../CONTRIBUTING.md).
