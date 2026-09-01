# Local Plugins

Drop custom map layer plugins in this directory. They are **automatically loaded** by OpenHamClock and will **survive updates** (`git pull` won't touch them).

Custom **dockable panels** go in the `panels/` subdirectory (`.jsx` files exporting `metadata` + `Panel`) — see [docs/PLUGINS.md](../../../docs/PLUGINS.md) for the panel plugin guide and a full working example.

## Quick Start

1. Create a file here, e.g. `useMyLayer.js`
2. Export `metadata` and `useLayer` (same pattern as built-in plugins)
3. Restart the dev server or rebuild — your layer appears in Settings

## Template

```js
import i18n from '../../i18n';

export const metadata = {
  id: 'my-layer',
  name: 'My Custom Layer',
  description: 'A custom map layer',
  icon: '🔧',
  category: 'custom',
  defaultEnabled: false,
  defaultOpacity: 0.8,
};

export function useLayer({ map, enabled, opacity }) {
  // Your layer logic here — see OpenHamClock-Plugin-Guide.md for full docs
}
```

## Rules

- Files must export both `metadata` (with at least `id`, `name`) and `useLayer`
- File names should start with `use` by convention (e.g. `useMyLayer.js`)
- The `id` in metadata must be unique across all plugins
- `.js` and `.jsx` files are auto-discovered — no registration needed
- This directory is gitignored so your plugins persist across updates
