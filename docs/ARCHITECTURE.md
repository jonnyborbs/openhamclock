# OpenHamClock Architecture

A guide to navigating the codebase. Start here if you're new.

## High-Level Overview

OpenHamClock is a full-stack JavaScript application:

- **Frontend**: React 18 (Vite build), Leaflet maps (plus a Three.js 3D globe and a canvas azimuthal projection), inline CSS with CSS variables for theming, PWA service worker for offline mode
- **Backend**: Express.js server that proxies 40+ external APIs, manages SSE/WebSocket connections and UDP listeners, and serves static files
- **Deployment**: Docker on Railway (production), `npm run dev` for local development

```text
┌──────────────────────────────────────────────────────┐
│                    Browser (React)                    │
│  App.jsx → Layout → Panels + WorldMap + Plugins      │
│            ↕ fetch/SSE/MQTT                          │
├──────────────────────────────────────────────────────┤
│           server.js + server/routes/ (Express)        │
│  /api/* → proxies to POTA, SOTA, QRZ, NOAA, etc.    │
│  SSE → DX cluster spots, PSK Reporter, RBN          │
│  UDP → WSJT-X (2237), N1MM/DXLog (12060)            │
│  Static → dist/ (built) or public/ (fallback)        │
├──────────────────────────────────────────────────────┤
│              External APIs & Data Sources             │
│  POTA · SOTA · WWFF · QRZ · HamQTH · NOAA · N0NBH  │
│  PSK Reporter MQTT · OHC Cluster · DX Spider · RBN   │
│  CelesTrak/AMSAT/SatNOGS TLEs · Ionosonde · WSPR    │
└──────────────────────────────────────────────────────┘
```

## Directory Structure

```text
openhamclock/
├── index.html              # Vite entry point → builds to dist/index.html
├── server.js               # Express entry point — middleware, static serving, route mounting
├── server/                 # Backend modules
│   ├── config.js               # Env var → runtime config loader (auto-creates .env)
│   ├── health.js               # Subsystem health tracking for /api/health
│   ├── middleware/             # Rate limiting, caching headers, usage tracking
│   ├── routes/                 # One module per API area (dxcluster, satellites, aprs, ...)
│   ├── services/               # Backend services
│   └── utils/                  # Backend utilities (logging, upstream manager, ...)
├── config.js               # Legacy runtime configuration loader
├── package.json            # Dependencies and scripts
├── vite.config.mjs         # Vite build configuration
├── Dockerfile              # Production Docker build (multi-stage, node:22-alpine)
├── docker-compose.yml      # Docker Compose deployment
├── railway.toml/.json      # Railway deployment config
│
├── src/                    # React frontend source
│   ├── main.jsx            # React entry point
│   ├── App.jsx             # Main app — layout selection and wiring
│   ├── DockableApp.jsx     # Dockable layout — panel catalog (panelDefs) + docking
│   │
│   ├── components/         # UI panels and widgets (~60 components)
│   │   ├── WorldMap.jsx        # Leaflet map (the big one)
│   │   ├── AzimuthalMap.jsx    # Azimuthal-equidistant canvas projection
│   │   ├── Globe3D.jsx         # Three.js 3D globe projection
│   │   ├── SettingsPanel.jsx   # Settings modal with tabs
│   │   ├── WhatsNew.jsx        # In-app release notes (the real changelog)
│   │   ├── DXClusterPanel.jsx  # DX spot list
│   │   ├── LogbookPanel.jsx    # Native in-browser logbook (IndexedDB)
│   │   └── ...                 # POTA/SOTA/WWFF/WWBOTA, solar, propagation, APRS, ...
│   │
│   ├── hooks/              # Data fetching and state management (one hook per source)
│   │   └── app/                # App-level hooks (config, map layers, version check)
│   ├── contexts/           # React contexts (RigContext — rig control + tuneTo())
│   ├── layouts/            # Page layouts (ModernLayout, ClassicLayout, EmcommLayout)
│   ├── plugins/            # Map layer plugin system
│   │   ├── layerRegistry.js    # Built-in plugin imports + keyboard shortcut pins
│   │   ├── layers/             # ~28 built-in layers (satellites, VOACAP, RBN, aurora, ...)
│   │   └── local/              # User plugins — auto-discovered, gitignored
│   ├── services/           # Client-side stores (logbookStore — IndexedDB logbook)
│   ├── pwa/                # Service worker registration + update toast
│   ├── store/              # Layout persistence (layoutStore)
│   ├── utils/              # Pure utility functions (callsign, geo, filters, awards, ...)
│   ├── lang/               # i18n translation files (16 languages, flat sorted JSON)
│   ├── styles/             # Theme CSS variables, base styles
│   └── test/               # Shared test setup (vitest + jsdom)
│
├── public/                 # Static assets (copied to dist/ by Vite)
│   ├── sw.js / sw-policy.js    # Service worker (offline mode / PWA)
│   ├── manifest.json           # PWA manifest
│   ├── index-monolithic.html   # Legacy self-contained fallback
│   └── icons/, models/, geo/   # App icons, 3D satellite models, boundary data
│
├── rig-bridge/             # Local rig control bridge (plugin system, 20+ plugins)
├── rig-listener/           # Older standalone USB rig control bridge
├── dxspider-proxy/         # DX Spider telnet proxy microservice
├── ohc-cluster/            # OpenHamClock's own DX cluster node (RBN + spots aggregation)
├── iturhfprop-service/     # ITU-R P.533 propagation prediction microservice
├── wasm-build/             # P.533 → WebAssembly build (client-side propagation)
├── wsjtx-relay/            # WSJT-X UDP → HTTPS relay agent for cloud installs
├── fletcher/               # TLE fetch egress proxy (hosted deployment)
├── watchtower/             # Cloudflare Worker uptime probe
├── electron/               # Electron desktop wrapper (experimental)
├── scripts/                # Setup/update scripts, lang tooling, wasm fetch
│
├── docs/                   # Documentation — see docs/README.md for the index
├── .github/workflows/      # CI (format, lang-check, tests, docker), image builds
│
├── CONTRIBUTING.md         # How to contribute
├── TESTING.md              # Test guide
├── SECURITY.md             # Security policy
└── LICENSE                 # MIT
```

## Key Patterns

### Data Flow: Hook → Component → Layout

Every data panel follows the same pattern:

```text
useXxxSpots.js (hook)     →  XxxPanel.jsx (component)  →  Layout / DockableApp
  ├── fetch /api/xxx         ├── renders data list          ├── arranges panels
  ├── polling interval       ├── handles click events       └── passes props
  └── returns { data }       └── calls tuneTo() on click
```

### Adding a New Panel

1. Create hook: `src/hooks/useMyFeature.js` — fetch data, return `{ data, loading }`
2. Create component: `src/components/MyFeaturePanel.jsx` — render the data
3. Add an API route module under `server/routes/` if you need to proxy an external API (mount it in `server.js`)
4. Register it in `DockableApp.jsx`'s `panelDefs` (and other layouts where it applies)
5. Update `docs/MANUAL.md` — every user-facing panel gets a section in the manual

### Adding a Map Layer Plugin

1. Create `src/plugins/layers/useMyLayer.js` following the plugin interface:

   ```js
   export const metadata = { id: 'my-layer', name: 'My Layer', ... };
   export const useLayer = ({ map, enabled, config }) => { ... };
   ```

2. Import it in `src/plugins/layerRegistry.js` and add it to the plugin array (personal plugins dropped in `src/plugins/local/` are auto-discovered instead — no registration, and they survive git updates)
3. See `src/plugins/OpenHamClock-Plugin-Guide.md` for the full API

### Theming

Five themes: `dark`, `light`, `legacy`, `retro`, `custom`. All colors use CSS custom properties:

```css
var(--bg-primary)      /* Main background */
var(--accent-amber)    /* Primary accent (gold) */
var(--accent-green)    /* Success / active */
var(--accent-cyan)     /* Links / interactive */
var(--text-primary)    /* Main text */
var(--text-muted)      /* Secondary text */
```

Never hardcode colors — always use `var(--xxx)` so every theme works.

### Server-Side API Proxy Pattern

All external API calls go through the backend to avoid CORS issues and add caching:

```js
// 1. Define cache
let myCache = { data: null, timestamp: 0 };
const MY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// 2. Create route
app.get('/api/myfeature', async (req, res) => {
  const now = Date.now();
  if (myCache.data && now - myCache.timestamp < MY_CACHE_TTL) {
    return res.json(myCache.data);
  }
  const response = await fetch('https://external-api.com/data');
  const data = await response.json();
  myCache = { data, timestamp: now };
  res.json(data);
});
```

## Monolithic Fallback

`public/index-monolithic.html` is a legacy self-contained copy of the frontend in a single HTML file, kept for environments where `npm run build` isn't available. When editing features, **always update the React source in `src/`** — that's what production runs.

## Performance Notes

- **2,000+ concurrent SSE connections** at peak on the hosted site
- The backend is a single Node.js process handling everything
- Memory-sensitive: all caches have explicit size caps and TTLs
- Upstream calls go through a shared UpstreamManager with request deduplication, stale-while-revalidate, and exponential backoff
