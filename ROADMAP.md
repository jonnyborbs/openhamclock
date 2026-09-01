# OpenHamClock Roadmap

> Amateur Radio Dashboard — A modern web-based HamClock alternative
> Created by K0CJH | Current version: v26.6.0 | License: MIT

---

## Project History

### Origins (v1.x — Jan 2026)

OpenHamClock was built from scratch as a modern, web-based amateur radio dashboard. Inspired by the concept of WB0OEW's HamClock — displaying solar conditions, DX cluster spots, and propagation data — but written entirely from the ground up as a web application. No code was forked or inherited. The goal was a browser-based ham radio dashboard that anyone could run locally or access from anywhere.

### Monolithic Era (v2.x — Jan 2026)

The first web version was a single monolithic HTML file with embedded JavaScript. It worked, but adding features meant editing a massive file with tangled dependencies. This era established the core feature set: world map, DX cluster, solar data, and basic propagation display.

### React Rewrite (v3.0 — v3.12 — Jan–Feb 2026)

A complete rewrite into modular React with Vite and an Express backend. This was the inflection point — the architecture went from a single HTML file to 13 components, 12 hooks, and 3 utility modules. Key milestones:

- **v3.7** — Modular React architecture, Railway and Docker deployment
- **v3.8** — ITURHFProp hybrid propagation predictions, ionosonde corrections
- **v3.9** — Satellite tracking (40+ satellites), DX filtering, map legend
- **v3.10** — Environment-based config (.env), Classic layout, Retro theme
- **v3.11** — PSKReporter integration, 85% bandwidth reduction
- **v3.12** — State persistence, lunar phase, WSPR heatmap, lightning detection

### Scaling & Stability (v15.0 — v15.2 — Feb 2026)

The project hit 2,000+ concurrent users on openhamclock.com, exposing every possible scaling issue:

- **Memory leaks** — Unbounded caches (PSK-MQTT proxy, callsign lookups, propagation heatmap) caused OOM crashes at 4GB after 24 hours. Fixed with entry caps, eviction policies, and memory monitoring.
- **MQTT fork bombs** — Reconnect logic created exponential chains of parallel reconnect loops during broker outages.
- **Request stampedes** — 50 users refreshing simultaneously meant 50 upstream API calls. Built UpstreamManager with request deduplication, stale-while-revalidate, and exponential backoff.
- **PSK-MQTT proxy** — Replaced per-browser MQTT connections with a single server-side connection, cutting SSE traffic in half.
- **Weather 429 cascades** — Moved weather to client-direct Open-Meteo, distributing rate limits across user IPs instead of concentrating on the server.

Also shipped: VOACAP heatmap, rig control, SOTA panel, N0NBH band conditions, user profiles, and server-side settings sync.

### Feature Expansion (v15.4 — v15.5 — Feb 2026)

With stability solved, focus shifted to features and polish:

- **Direct rig control** — Click any spot to tune your radio (Yaesu, Kenwood, Elecraft, Icom via USB serial)
- **Satellite tracker overhaul** — Floating data window, visibility indicators, pinned tracking
- **APRS-IS live tracking** — Full APRS integration with watchlist groups for EmComm
- **Wildfire & storm map layers** — NASA EONET satellite detection
- **13 languages at 100% coverage** — en, de, es, fr, it, ja, ko, ms, nl, pt, sl, ru, ka
- **Ultrawide monitor support** — Sidebars scale proportionally with viewport

### Security Hardening (v15.6 — Mar 2026)

Comprehensive security audit and hardening pass:

- CORS lockdown with explicit origin allowlist
- SSRF elimination for custom DX cluster hosts
- API write key authentication for rotator and QRZ endpoints
- SSE connection limiter, telnet command injection prevention
- DOM XSS fixes, ReDoS fixes, URL encoding
- Dockerfile runs as non-root user

### New Versioning & EmComm (v26.1.1 — Mar 2026)

Adopted year-based versioning: X = year, Y = visual/UI, Z = backend. The jump from v15 to v26 resets the scheme to something meaningful.

- **EmComm layout** — Dedicated emergency communications dashboard with range rings, NWS alerts, FEMA declarations, shelters, filtered APRS stations, net operations, and point-to-point messaging
- **APRS resource tokens** — Structured emergency data in beacon comments with visual resource cards and aggregation dashboard
- **Classic layout redesign** — Refreshed while keeping the WB0OEW spirit
- **Active users map layer** — See other operators in real time
- **Audio alerts** — Configurable tones per feed (POTA, SOTA, DX Cluster, etc.)
- **SDR integration** — FlexRadio SmartSDR and RTL-SDR support via rig-bridge
- **DX favorites** — Save up to 10 DX target grid squares for quick switching

### Monthly Releases & Real Physics (v26.3 — v26.6 — May–Sep 2026)

The project settled into a monthly release cadence (first Tuesday), and each drop carried a headline. v26.3 brought VOACAP-grade propagation: the actual ITU-R P.533 model compiled to WebAssembly and run in the browser, later corrected to model each digital mode at its real decode threshold (FT8 at −19 dB, not SSB-plus-a-fudge) and fixed at the root for the infamous "vertical line through China" midpoint bug. v26.4 added a live aircraft tracking layer (adsb.lol), a worldwide ATC sectors overlay, and the first big accessibility push — W3C tablist patterns, aria-live announcements, and a non-map text view for screen-reader users, extended in round two the following cycle. v26.5 stood up **OHC Cluster**, our own DX cluster node feeding the hosted site (ending dependence on public DXSpider nodes), alongside N3FJP integration, real-time Kp, and Prometheus metrics. Throughout, the satellite pipeline was hardened end to end — multi-source TLE failover (CelesTrak → AMSAT → SatNOGS), a proper state machine with tests, and the "fletcher" relay for blocked egress IPs. v26.6 capped the era with a **3D globe projection**: a WebGL Earth with true great-circle arcs, shader-computed day/night terminator, and satellites at real orbital altitude — efficient enough to run on a Raspberry Pi.

---

## Current State (v26.6.0)

### What's Working Well

- **30+ dashboard modules** — DX Cluster, PSK Reporter, WSJT-X, POTA, SOTA, WWFF, WWBOTA, satellites, APRS, contests, DXpeditions, propagation, solar indices, weather, band activity, MeshCom, and more
- **3 map projections** — Flat, Azimuthal, and the new 3D globe with great-circle arcs and satellites at orbital altitude
- **6 layouts** — Modern, Classic, Tablet, Compact, Dockable, EmComm
- **5 themes** — Dark, Light, Legacy, Retro, Custom
- **Real propagation physics** — ITU-R P.533 (VOACAP-grade) predictions via in-browser WASM, mode-aware decode thresholds for FT8/FT4/WSPR/JT65/CW, with REST and heuristic fallbacks
- **OHC Cluster** — Our own DX cluster node serving the hosted site: RBN plus human spots (POTA, SOTA, WWFF, Parks n Peaks, DX Summit), mode-balanced so SSB/CW survive the FT8 flood
- **Rig control** — Click-to-tune across all spot panels, unified rig-bridge with 22 plugins, cloud relay for remote operation, proper Yaesu band-select on band changes
- **EmComm platform** — Full emergency communications dashboard with APRS station tracking (internet + local RF), net operations, point-to-point APRS messaging, resource token aggregation, NWS alerts, FEMA shelters/disasters, Winlink gateway layer, and telemetry parsing
- **Accessibility** — W3C tablist keyboard navigation, aria-live event announcements, and a non-map "Map Data" text view for screen-reader users
- **Multi-platform** — Browser, Electron desktop, Raspberry Pi kiosk, Docker/GHCR, Railway, FreeBSD
- **16 languages** — ca, de, en, es, fr, it, ja, ka, ko, ms, nl, pt, ru, sl, th, zh
- **Real-time data** — PSK Reporter via server-side MQTT proxy, WSJT-X via UDP, APRS-IS, DX cluster telnet
- **Observability** — Authenticated Prometheus /metrics endpoint, /api/health subsystem snapshot, external watchtower probes for the hosted site

### Open Issues

| #     | Type          | Description                                                                           |
| ----- | ------------- | ------------------------------------------------------------------------------------- |
| #1165 | Hardening     | Satellite pipeline release-day resilience — fletcher probe depth, cold-start, backoff |
| #1152 | Feature       | More space for DX Cluster spots                                                       |
| #1135 | Ops           | api/health statistics over run container card                                         |
| #1112 | Accessibility | Color contrast fails WCAG AA in Light and Retro themes                                |
| #1095 | Bug           | RBN should query spot/cluster caches before querying QRZ for location                 |
| #1015 | Feature       | Open API for QSO Map layer                                                            |
| #997  | Accessibility | Audit and improve experience for blind / screen-reader users                          |
| #882  | Feature       | Rig-Bridge mode overrides                                                             |

---

## What's Coming

### Shipped on Staging Toward the Next Release

Already built and merged to Staging, headed for the next monthly release:

- **Native logbook** — IndexedDB storage, ADIF import/export, log-from-spot
- **PWA / offline mode** — Service worker, versioned caches, update prompts
- **3D globe map overlays** — Grid, zones, D-RAP, and aurora rendered on the globe
- **Three new map layers** — Maidenhead grid, D-RAP absorption, CQ/ITU zones
- **Space Weather Alerts panel** — With audio alert feed
- **Meteor Showers panel**
- **APRS telemetry dashboard** — Plus RF-heard shelter reports merged into EmComm
- **IBP listening-log timeline** — Beacon reception history
- **Worked-before / dupe badges** — On DX cluster and activation spots
- **Band plan overlay** — On the Rig Control frequency display
- **Click-to-listen web SDRs** — Auto-picked nearest live KiwiSDR, tuned to the spot, from spot rows and callsign popups
- **Aircraft track prediction** — Configurable lead-time slider
- **Configurable satellite track duration** — 15–120 min
- **Azimuthal rendering fixes** — Curved zone/grid/ATC lines, square-level grid
- **Contributor list refresh** — 14 missing contributors added to the Community page

### In Progress Right Now

- **Award tracking** — DXCC / WAZ / WAS / VUCC progress from the logbook, with needed-spot highlighting
- **Worked-grids map layer** — Your confirmed grids painted on the map
- **Browser notifications** — For the existing alert feeds
- **Documentation overhaul** — Full user manual plus quickstart

### On the Horizon

- **Log sync** — LoTW confirmation download, push to Cloudlog/Wavelog/QRZ Logbook
- **Contest mode** — Dedicated layout with rate meters, multiplier tracking, and dupe sheet
- **True Web Push notifications** — Alerts with the browser closed (requires a VAPID push server)
- **Band-opening detection** — Alert when spot/PSK activity shows a band opening toward your target
- **Sked planner** — Mutual VOACAP windows for you and a chosen DX target
- **Ionosonde panel** — Live GIRO foF2/MUF readings from nearby stations
- **Stats dashboard** — QSO heatmaps, distance records, activity trends from the logbook
- **Open REST API** — Documented endpoints for third parties, including a QSO map layer (#1015)
- **Panel plugin system** — Community-contributed data panels (map-layer plugins already exist)
- **Kiosk scene rotation** — Cycle through layouts/views on a timer for shack displays
- **EmComm event log export** — CSV/PDF export for After Action Reviews
- **Winlink live-pathways layer** — Gateway layer shipped in v26.3; live traffic view is blocked on upstream stream credentials (the Winlink team granted a key for the listing APIs, live stream still pending)
- **Winlink Express CSV ingest** — Message-log import for EOC dashboards
- **Mobile experience** — The PWA now covers much of the original "mobile app" goal; remaining work is mobile-first layout polish rather than a separate native app

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions. All PRs target the `Staging` branch.

- **Issues**: <https://github.com/accius/openhamclock/issues>
- **Discussions**: GitHub Issues or the Community tab in Settings
- **Security**: See [SECURITY.md](SECURITY.md) for vulnerability reporting

---

_Last updated: 2026-08-28_ <!-- markdownlint-disable-line MD036 -->
