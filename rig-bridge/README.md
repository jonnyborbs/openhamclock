# 📻 OpenHamClock Rig Bridge

**One download. One click. Your radio is connected.**

The Rig Bridge connects OpenHamClock directly to your radio via USB — no flrig, no rigctld, no complicated setup. Just plug in your radio, run the bridge, pick your COM port, and go.

Built on a **plugin architecture** — each radio integration is a standalone module, making it easy to add new integrations without touching existing code.

## Supported Radios

### Direct USB (Recommended)

| Brand       | Protocol | Tested Models                                       |
| ----------- | -------- | --------------------------------------------------- |
| **Yaesu**   | CAT      | FT-991A, FT-891, FT-710, FT-DX10, FT-DX101, FT-5000 |
| **Kenwood** | Kenwood  | TS-890, TS-590, TS-2000, TS-480                     |
| **Icom**    | CI-V     | IC-7300, IC-7610, IC-9700, IC-705, IC-7851          |

Also works with **Elecraft** radios (K3, K4, KX3, KX2) using the Kenwood plugin.

### SDR Radios via TCI (WebSocket)

TCI (Transceiver Control Interface) is a WebSocket-based protocol used by modern SDR applications. Unlike serial CAT, TCI **pushes** frequency, mode, and PTT changes in real-time — no polling, no serial port conflicts.

| Application   | Radios              | Default TCI Port |
| ------------- | ------------------- | ---------------- |
| **Thetis**    | Hermes Lite 2, ANAN | 40001            |
| **ExpertSDR** | SunSDR2             | 40001            |

### SDR Radios (Native TCP)

| Application  | Radios                         | Default Port |
| ------------ | ------------------------------ | ------------ |
| **SmartSDR** | FlexRadio 6000/8000 series     | 4992         |
| **rtl_tcp**  | RTL-SDR dongles (receive-only) | 1234         |

### Via Control Software (Legacy)

| Software    | Protocol | Default Port |
| ----------- | -------- | ------------ |
| **flrig**   | XML-RPC  | 12345        |
| **rigctld** | TCP      | 4532         |

### For Testing (No Hardware Required)

| Type                | Description                                                          |
| ------------------- | -------------------------------------------------------------------- |
| **Simulated Radio** | Fake radio that drifts through several bands — no serial port needed |

Enable by setting `radio.type = "mock"` in `rig-bridge-config.json` or selecting **Simulated Radio** in the setup UI.

---

## Quick Start

### Option A: Download the Executable (Easiest)

1. Download the right file for your OS from the Releases page
2. Double-click to run
3. Open **http://localhost:5555** in your browser
4. Select your radio type and COM port
5. Click **Save & Connect**

### Option B: Run with Node.js

```bash
cd rig-bridge
npm install
node rig-bridge.js
```

Then open **http://localhost:5555** to configure.

**Options:**

```bash
node rig-bridge.js --port 8080   # Use a different port
node rig-bridge.js --debug       # Enable raw hex/ASCII CAT traffic logging
```

---

## Radio Setup Tips

### Yaesu FT-991A

1. Connect USB-B cable from radio to computer
2. On the radio: **Menu → Operation Setting → CAT Rate → 38400**
3. In Rig Bridge: Select **Yaesu**, pick your COM port, baud **38400**, stop bits **2**, and enable **Hardware Flow (RTS/CTS)**

### Icom IC-7300

1. Connect USB cable from radio to computer
2. On the radio: **Menu → Connectors → CI-V → CI-V USB Baud Rate → 115200**
3. In Rig Bridge: Select **Icom**, pick COM port, baud **115200**, stop bits **1**, address **0x94**

### Kenwood TS-590

1. Connect USB cable from radio to computer
2. In Rig Bridge: Select **Kenwood**, pick COM port, baud **9600**, stop bits **1**

### SDR Radios via TCI

#### 1. Enable TCI in your SDR application

**Thetis (HL2 / ANAN):** Setup → CAT Control → check **Enable TCI Server** (default port 40001)

**ExpertSDR:** Settings → TCI → Enable (default port 40001)

#### 2. Configure rig-bridge

Edit `rig-bridge-config.json`:

```json
{
  "radio": { "type": "tci" },
  "tci": {
    "host": "localhost",
    "port": 40001,
    "trx": 0,
    "vfo": 0
  }
}
```

| Field  | Description                      | Default     |
| ------ | -------------------------------- | ----------- |
| `host` | Host running the SDR application | `localhost` |
| `port` | TCI WebSocket port               | `40001`     |
| `trx`  | Transceiver index (0 = primary)  | `0`         |
| `vfo`  | VFO index (0 = VFO-A, 1 = VFO-B) | `0`         |

#### 3. Run rig-bridge

```bash
node rig-bridge.js
```

You should see:

```
[TCI] Connecting to ws://localhost:40001...
[TCI] ✅ Connected to ws://localhost:40001
[TCI] Device: Thetis
[TCI] Server ready
```

The bridge auto-reconnects every 5 s if the connection drops — just restart your SDR app and it will reconnect automatically.

---

## FlexRadio SmartSDR

The SmartSDR plugin connects directly to a FlexRadio 6000 or 8000 series radio via the native SmartSDR TCP API — no rigctld, no SmartSDR CAT, no DAX required. The radio pushes frequency, mode, and slice changes in real-time.

### Setup

Edit `rig-bridge-config.json`:

```json
{
  "radio": { "type": "smartsdr" },
  "smartsdr": {
    "host": "192.168.1.100",
    "port": 4992,
    "sliceIndex": 0
  }
}
```

| Field        | Description                        | Default         |
| ------------ | ---------------------------------- | --------------- |
| `host`       | IP address of the FlexRadio        | `192.168.1.100` |
| `port`       | SmartSDR TCP API port              | `4992`          |
| `sliceIndex` | Slice receiver index (0 = Slice A) | `0`             |

You should see:

```
[SmartSDR] Connecting to 192.168.1.100:4992...
[SmartSDR] ✅ Connected — Slice A on 14.074 MHz
```

The bridge auto-reconnects every 5 s if the connection drops.

**Supported modes:** USB, LSB, CW, AM, SAM, FM, DATA-USB (DIGU), DATA-LSB (DIGL), RTTY, FreeDV

---

## RTL-SDR (rtl_tcp)

The RTL-SDR plugin connects to an `rtl_tcp` server for cheap RTL-SDR dongles. It is **receive-only** — frequency tuning works, but mode changes and PTT are no-ops.

### Setup

1. Start `rtl_tcp` on the machine with the dongle:

```bash
rtl_tcp -a 127.0.0.1 -p 1234
```

2. Edit `rig-bridge-config.json`:

```json
{
  "radio": { "type": "rtl-tcp" },
  "rtltcp": {
    "host": "127.0.0.1",
    "port": 1234,
    "sampleRate": 2400000,
    "gain": "auto"
  }
}
```

| Field        | Description                                     | Default     |
| ------------ | ----------------------------------------------- | ----------- |
| `host`       | Host running `rtl_tcp`                          | `127.0.0.1` |
| `port`       | `rtl_tcp` listen port                           | `1234`      |
| `sampleRate` | IQ sample rate in Hz                            | `2400000`   |
| `gain`       | Tuner gain in tenths of dB, or `"auto"` for AGC | `"auto"`    |

You should see:

```
[RTL-TCP] Connecting to 127.0.0.1:1234...
[RTL-TCP] ✅ Connected — tuner: R820T
[RTL-TCP] Setting sample rate: 2.4 MS/s
[RTL-TCP] Gain: auto (AGC)
```

---

## WSJT-X Relay

The WSJT-X Relay is an **integration plugin** (not a radio plugin) that listens for WSJT-X UDP packets on the local machine and delivers decoded messages to OpenHamClock in real-time. It supports two delivery modes:

| Mode                       | How it works                                                                                | Use case                        |
| -------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| **📶 SSE only** (default)  | Decodes flow over the existing `/stream` SSE connection to the browser — no server involved | Local install, LAN, self-hosted |
| **☁️ Relay to OHC server** | Batches decodes and POSTs them to an OpenHamClock server; browser polls the server          | Cloud relay / remote access     |

Switch between modes in **http://localhost:5555 → Integrations → WSJT-X → Delivery mode**. In SSE-only mode no server credentials are needed.

> **⚠️ Startup order matters when running on the same machine as OpenHamClock**
>
> Both rig-bridge and a locally-running OpenHamClock instance listen on the same UDP port (default **2237**) for WSJT-X packets. Only one process can hold the port at a time.
>
> **Always start rig-bridge first.** It will bind UDP 2237. If OpenHamClock starts first and claims the port, rig-bridge will log `UDP port already in use` and receive nothing.
>
> If you see that warning in the rig-bridge console log, stop OpenHamClock, restart rig-bridge, then start OpenHamClock again.

### SSE-only mode (local/LAN)

This is the default. Enable the plugin and set your UDP port — that's it. Decodes, status updates and logged QSOs flow directly to any browser connected to `/stream`. No relay key, no session ID, no server URL required.

In WSJT-X: **File → Settings → Reporting → UDP Server → `127.0.0.1:2237`**

When the browser connects to `/stream` it immediately receives a `plugin-init` message containing the list of running plugins and a replay of the last 100 decodes, so the panel is populated instantly without waiting for the next FT8 cycle.

### Relay-to-server mode (cloud)

Enable relay mode when using a cloud-hosted OpenHamClock or any setup where the browser cannot reach rig-bridge directly.

#### Option A — Auto-configure from OpenHamClock (recommended)

1. Open **OpenHamClock** → **Settings** → **Station Settings** → **Rig Control**
2. Make sure Rig Control is enabled and the rig-bridge Host URL/Port are filled in
3. Scroll to the **WSJT-X Relay** sub-section
4. Note your **Session ID** (copy it with the 📋 button)
5. Click **Configure Relay on Rig Bridge** — OpenHamClock fetches the relay key from its own server and pushes credentials + enables relay mode directly to rig-bridge in one step

#### Option B — Configure from the rig-bridge setup UI

1. Open **http://localhost:5555** → **Integrations** tab
2. Enable the WSJT-X checkbox
3. Select **☁️ Relay to OHC server**
4. Enter the OpenHamClock Server URL and click **🔗 Fetch credentials**
5. Copy your **Session ID** from OpenHamClock → Settings → Station → Rig Control → WSJT-X Relay and paste it into the Session ID field
6. Click **Save Integrations**

#### Option C — Manual config

```json
{
  "wsjtxRelay": {
    "enabled": true,
    "relayToServer": true,
    "url": "https://openhamclock.com",
    "key": "your-relay-key",
    "session": "your-session-id",
    "udpPort": 2237,
    "batchInterval": 2000,
    "verbose": false,
    "multicast": false,
    "multicastGroup": "224.0.0.1",
    "multicastInterface": ""
  }
}
```

### Config reference

| Field                | Description                                                     | Default     |
| -------------------- | --------------------------------------------------------------- | ----------- |
| `enabled`            | Activate the plugin on startup                                  | `false`     |
| `relayToServer`      | `true` = also POST batches to OHC server; `false` = SSE-only    | `false`     |
| `url`                | OpenHamClock server URL (relay mode only)                       | —           |
| `key`                | Relay authentication key from your OHC server (relay mode only) | —           |
| `session`            | Browser session ID for per-user isolation (relay mode only)     | —           |
| `udpPort`            | UDP port WSJT-X is sending to                                   | `2237`      |
| `batchInterval`      | How often batches are POSTed to the server in relay mode (ms)   | `2000`      |
| `verbose`            | Log every decoded message to the console                        | `false`     |
| `multicast`          | Join a UDP multicast group to receive WSJT-X packets            | `false`     |
| `multicastGroup`     | Multicast group IP address to join                              | `224.0.0.1` |
| `multicastInterface` | Local NIC IP for multi-homed systems; `""` = OS default         | `""`        |

### Multicast Mode

By default the relay uses **unicast** — WSJT-X sends packets directly to `127.0.0.1` and only this process receives them.

If you want multiple applications on the same machine or LAN to receive WSJT-X packets simultaneously, enable multicast:

1. In WSJT-X: **File → Settings → Reporting → UDP Server** — set the address to `224.0.0.1`
2. In the rig-bridge setup UI, enable **Enable Multicast** and set the group address, or in `rig-bridge-config.json`:

```json
{
  "wsjtxRelay": {
    "multicast": true,
    "multicastGroup": "224.0.0.1",
    "multicastInterface": ""
  }
}
```

Leave `multicastInterface` blank unless you have multiple network adapters and need to specify which one to use (enter its local IP, e.g. `"192.168.1.100"`).

> `224.0.0.1` is the WSJT-X conventional multicast group. It is link-local — packets are not routed across subnet boundaries.

---

## Connecting to OpenHamClock

### Scenario 1: Local Install (OHC + Rig Bridge on same machine)

This is the simplest setup — everything runs on your computer.

1. **Start Rig Bridge** (if not already running):
   ```bash
   cd rig-bridge && node rig-bridge.js
   ```
2. **Configure your radio** at http://localhost:5555 — select radio type, COM port, click Save & Connect
3. **Open OpenHamClock** → **Settings** → **Rig Bridge** tab
4. Check **Enable Rig Bridge**
5. Host: `http://localhost` — Port: `5555`
6. Copy the **API Token** from the rig-bridge setup UI and paste it into the token field
7. Check **Click-to-tune** if you want spot clicks to change your radio frequency
8. Click **Save**

That's it — click any DX spot, POTA, SOTA, or RBN spot and your radio tunes automatically.

### Scenario 2: LAN Setup (OHC on one machine, radio on another)

Example: Rig Bridge runs on a Raspberry Pi in the shack, OHC runs on a laptop in the office.

1. **On the Pi** (where the radio is connected):
   - Start rig-bridge with LAN access: `node rig-bridge.js --bind 0.0.0.0`
   - Or set `"bindAddress": "0.0.0.0"` in config
   - Configure your radio at `http://pi-ip:5555`
2. **On the laptop** (where OHC runs):
   - Settings → Rig Bridge → Host: `http://pi-ip` — Port: `5555`
   - Paste the API token from the Pi's setup UI
   - Save

### Scenario 3: Cloud Relay (OHC on openhamclock.com, radio at home)

This lets you control your radio from anywhere via the cloud-hosted OpenHamClock.

**Step 1: Install Rig Bridge at home**

Go to https://openhamclock.com → Settings → Rig Bridge tab → click the download button for your OS (Windows/Mac/Linux). Run the installer — it downloads rig-bridge, installs dependencies, and starts it.

Or install manually:

```bash
git clone --depth 1 https://github.com/accius/openhamclock.git
cd openhamclock/rig-bridge
npm install
node rig-bridge.js
```

**Step 2: Configure your radio**

Open http://localhost:5555 and set up your radio connection (USB, rigctld, flrig, etc.).

**Step 3: Connect the Cloud Relay**

Option A — One-click from OHC:

1. Open https://openhamclock.com → Settings → Rig Bridge tab
2. Enter your local rig-bridge host (`http://localhost`) and port (`5555`)
3. Paste your API token
4. Click **Connect Cloud Relay**

Option B — Manual configuration:

1. In rig-bridge setup UI → Plugins tab → enable **Cloud Relay**
2. Set the OHC Server URL: `https://openhamclock.com`
3. Set the Relay API Key (same as `RIG_BRIDGE_RELAY_KEY` or `WSJTX_RELAY_KEY` on the server)
4. Set a Session ID (any unique string for your browser session)
5. Save and restart rig-bridge

**How it works:**

```
Your shack                              Cloud
────────────                            ─────
Radio (USB) ←→ Rig Bridge ──HTTPS──→ openhamclock.com
  └─ WSJT-X                              └─ Your browser
  └─ Direwolf/TNC                        └─ Click-to-tune
  └─ Rotator                              └─ PTT
                                          └─ WSJT-X decodes
                                          └─ APRS packets
```

Rig Bridge pushes your rig state (frequency, mode, PTT) to the cloud server. When you click a spot or press PTT in the browser, the command is queued on the server and delivered to your local rig-bridge within approximately one network round-trip via long-polling — typically under 100 ms on a good connection. The browser UI updates optimistically before the confirmation arrives, so PTT and frequency feel immediate.

---

## Plugin Manager

Open the rig-bridge setup UI at http://localhost:5555 → **Plugins** tab to enable and configure plugins. No JSON editing required.

### Digital Mode Plugins

| Plugin           | Default Port | Description                                           |
| ---------------- | ------------ | ----------------------------------------------------- |
| **WSJT-X Relay** | 2237         | Forward FT8/FT4 decodes to OHC; bidirectional replies |
| **MSHV**         | 2239         | Multi-stream digital mode software                    |
| **JTDX**         | 2238         | Enhanced FT8/JT65 decoding                            |
| **JS8Call**      | 2242         | JS8 keyboard-to-keyboard messaging                    |

All digital mode plugins are **bidirectional** — OHC can send replies, halt TX, set free text, and highlight callsigns in the decode window.

Decodes are delivered to the browser over the `/stream` SSE connection in real-time. When a new browser tab connects, the last 100 decodes are replayed immediately via the `plugin-init` message so the panel is populated without waiting for the next FT8/FT4 cycle. No server round-trip is needed in local or LAN mode.

In your digital mode software, set UDP Server to `127.0.0.1` and the port shown above.

### APRS TNC Plugin

Connects to a local Direwolf or hardware TNC via KISS protocol for RF-based APRS — no internet required.

| Setting         | Default     | Description                                             |
| --------------- | ----------- | ------------------------------------------------------- |
| Protocol        | `kiss-tcp`  | `kiss-tcp` for Direwolf, `kiss-serial` for hardware TNC |
| Host            | `127.0.0.1` | Direwolf KISS TCP host                                  |
| Port            | `8001`      | Direwolf KISS TCP port                                  |
| Callsign        | (required)  | Your callsign for TX                                    |
| SSID            | `0`         | APRS SSID                                               |
| Beacon Interval | `600`       | Seconds between position beacons (0 = disabled)         |

**With Direwolf:**

1. Start Direwolf with KISS enabled (default port 8001)
2. Enable the APRS TNC plugin in rig-bridge
3. Set your callsign
4. APRS packets from nearby stations appear in OHC's APRS panel

The APRS TNC runs alongside APRS-IS (internet) for dual-path coverage. When internet goes down, local RF keeps working.

### Rotator Plugin

Controls antenna rotators via Hamlib's `rotctld`.

1. Start rotctld: `rotctld -m 202 -r /dev/ttyUSB1 -t 4533`
2. Enable the Rotator plugin in rig-bridge
3. Set host and port (default: `127.0.0.1:4533`)

### Winlink Plugin

Two features:

- **Gateway Discovery** — shows nearby Winlink RMS gateways on the map (requires API key from winlink.org)
- **Pat Client** — integrates with [Pat](https://getpat.io/) for composing and sending Winlink messages over RF

### Cloud Relay Plugin

Bridges a locally-running rig-bridge to a cloud-hosted OpenHamClock instance so cloud users get the same rig control as local users — click-to-tune, PTT, WSJT-X decodes, APRS packets.

See [Scenario 3](#scenario-3-cloud-relay-ohc-on-openhamclockcom-radio-at-home) for setup instructions.

**How latency is minimised:**

| Path                  | Mechanism                                              | Typical latency |
| --------------------- | ------------------------------------------------------ | --------------- |
| Rig state → browser   | Event-driven push + SSE fan-out                        | < 100 ms        |
| Browser command → rig | Long-poll (server wakes rig-bridge on command arrival) | ~RTT (< 100 ms) |

The rig-bridge holds a persistent long-poll connection to the server. The moment you click PTT or a DX spot, the server wakes that connection and delivers the command — no fixed poll tick to wait for.

**Config reference:**

| Field          | Description                                     | Default |
| -------------- | ----------------------------------------------- | ------- |
| `enabled`      | Activate the relay on startup                   | `false` |
| `url`          | Cloud OHC server URL                            | —       |
| `apiKey`       | Relay authentication key (from your OHC server) | —       |
| `session`      | Browser session ID for per-user isolation       | —       |
| `pushInterval` | Fallback push interval for batched data (ms)    | `2000`  |
| `relayRig`     | Relay rig state (freq, mode, PTT)               | `true`  |
| `relayWsjtx`   | Relay WSJT-X decodes                            | `true`  |
| `relayAprs`    | Relay APRS packets from local TNC               | `false` |
| `verbose`      | Log all relay activity to the console           | `false` |

---

## Config Location

Rig Bridge stores its configuration outside the installation directory so updates never overwrite your settings:

| OS              | Config Path                                     |
| --------------- | ----------------------------------------------- |
| **macOS/Linux** | `~/.config/openhamclock/rig-bridge-config.json` |
| **Windows**     | `%APPDATA%\openhamclock\rig-bridge-config.json` |

On first run, if no config exists at the external path, rig-bridge creates one from the example template. If you're upgrading from an older version that stored config in the `rig-bridge/` directory, it's automatically migrated.

---

## Building Executables

To create standalone executables (no Node.js required):

```bash
npm install
npm run build:win        # Windows .exe
npm run build:mac        # macOS (Intel)
npm run build:mac-arm    # macOS (Apple Silicon)
npm run build:linux      # Linux x64
npm run build:linux-arm  # Linux ARM (Raspberry Pi)
npm run build:all        # All platforms
```

Executables are output to the `dist/` folder.

---

## Troubleshooting

| Problem                                  | Solution                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No COM ports found                       | Install USB driver (Silicon Labs CP210x for Yaesu, FTDI for some Kenwood)                                                                                   |
| Port opens but no data                   | Check baud rate matches radio's CAT Rate setting                                                                                                            |
| Icom not responding                      | Verify CI-V address matches your radio model                                                                                                                |
| CORS errors in browser                   | The bridge allows all origins by default                                                                                                                    |
| Port already in use                      | Close flrig/rigctld if running — you don't need them anymore                                                                                                |
| PTT not responsive                       | Enable **Hardware Flow (RTS/CTS)** (especially for FT-991A/FT-710)                                                                                          |
| macOS Comms Failure                      | The bridge automatically applies a `stty` fix for CP210x drivers.                                                                                           |
| TCI: Connection refused                  | Enable TCI in your SDR app (Thetis → Setup → CAT Control → Enable TCI Server)                                                                               |
| TCI: No frequency updates                | Check `trx` / `vfo` index in config match the active transceiver in your SDR app                                                                            |
| TCI: Remote SDR                          | Set `tci.host` to the IP of the machine running the SDR application                                                                                         |
| SmartSDR: Connection refused             | Confirm the radio is powered on and reachable; default API port is 4992                                                                                     |
| SmartSDR: No slice updates               | Check `sliceIndex` matches the active slice in SmartSDR                                                                                                     |
| RTL-SDR: Connection refused              | Start `rtl_tcp` first: `rtl_tcp -a 127.0.0.1 -p 1234`; check no other app holds the dongle                                                                  |
| RTL-SDR: Frequency won't tune            | Verify the frequency is within your dongle's supported range (typically 24 MHz–1.7 GHz for R820T)                                                           |
| Multicast: no packets                    | Verify `multicastGroup` matches what WSJT-X sends to; check OS firewall allows multicast UDP; set `multicastInterface` to the correct NIC IP if multi-homed |
| Cloud Relay: auth failed (401/403)       | Check that `apiKey` in rig-bridge matches `RIG_BRIDGE_RELAY_KEY` on the OHC server                                                                          |
| Cloud Relay: state not updating          | Verify `url` points to the correct OHC server and that the server is reachable from your home network                                                       |
| Cloud Relay: PTT/tune lag                | Ensure rig-bridge version ≥ 2.0 — older versions used a 250 ms poll instead of long-poll                                                                    |
| Cloud Relay: connection drops frequently | Some proxies close idle HTTP connections after 30–60 s; rig-bridge reconnects automatically                                                                 |

---

## API Reference

Fully backward compatible with the original rig-daemon API:

| Method | Endpoint      | Description                                            |
| ------ | ------------- | ------------------------------------------------------ |
| GET    | `/status`     | Current freq, mode, PTT, connected status              |
| GET    | `/stream`     | SSE stream of real-time updates + plugin decode events |
| POST   | `/freq`       | Set frequency: `{ "freq": 14074000 }`                  |
| POST   | `/mode`       | Set mode: `{ "mode": "USB" }`                          |
| POST   | `/ptt`        | Set PTT: `{ "ptt": true }`                             |
| GET    | `/api/ports`  | List available serial ports                            |
| GET    | `/api/config` | Get current configuration                              |
| POST   | `/api/config` | Update configuration & reconnect                       |
| POST   | `/api/test`   | Test a serial port connection                          |
| GET    | `/api/status` | Lightweight health check: `{ sseClients, uptime }`     |

---

## Project Structure

```
rig-bridge/
├── rig-bridge.js          # Entry point — thin orchestrator
│
├── core/
│   ├── config.js          # Config load/save, defaults, CLI args
│   ├── state.js           # Shared rig state + SSE broadcast + change listeners
│   ├── server.js          # Express HTTP server + all API routes
│   ├── plugin-registry.js # Plugin lifecycle manager + dispatcher
│   └── serial-utils.js    # Shared serial port helpers
│
├── lib/
│   ├── message-log.js     # Persistent message log (WSJT-X, JS8Call, etc.)
│   ├── kiss-protocol.js   # KISS frame encode/decode for APRS TNC
│   ├── wsjtx-protocol.js  # WSJT-X UDP binary protocol parser/encoder
│   └── aprs-parser.js     # APRS packet decoder (position, weather, objects, etc.)
│
└── plugins/
    ├── usb/
    │   ├── index.js            # USB serial lifecycle (open, reconnect, poll)
    │   ├── protocol-yaesu.js   # Yaesu CAT ASCII protocol
    │   ├── protocol-kenwood.js # Kenwood ASCII protocol
    │   └── protocol-icom.js    # Icom CI-V binary protocol
    ├── tci.js             # TCI/SDR WebSocket plugin (Thetis, ExpertSDR, etc.)
    ├── smartsdr.js        # FlexRadio SmartSDR native TCP API plugin
    ├── rtl-tcp.js         # RTL-SDR via rtl_tcp binary protocol (receive-only)
    ├── rigctld.js         # rigctld TCP plugin
    ├── flrig.js           # flrig XML-RPC plugin
    ├── mock.js            # Simulated radio for testing (no hardware needed)
    ├── wsjtx-relay.js     # WSJT-X UDP listener → OpenHamClock relay
    ├── mshv.js            # MSHV UDP listener (multi-stream digital modes)
    ├── jtdx.js            # JTDX UDP listener (FT8/JT65 enhanced decoding)
    ├── js8call.js         # JS8Call UDP listener (JS8 keyboard messaging)
    ├── aprs-tnc.js        # APRS KISS TNC plugin (Direwolf / hardware TNC)
    ├── rotator.js         # Antenna rotator via rotctld (Hamlib)
    ├── winlink-gateway.js # Winlink RMS gateway discovery + Pat client
    └── cloud-relay.js     # Cloud relay — bridges local rig-bridge to cloud OHC
```

---

## Writing a Plugin

Each plugin exports an object with the following shape:

```js
module.exports = {
  id: 'my-plugin', // Unique identifier (matches config.radio.type)
  name: 'My Plugin', // Human-readable name
  category: 'rig', // 'rig' | 'integration' | 'rotator' | 'logger' | 'other'
  configKey: 'radio', // Which config section this plugin reads

  create(config, services) {
    // Available services:
    //   updateState(prop, value) — update shared rig state and broadcast via SSE
    //   state                   — read-only view of current rig state
    //   onStateChange(fn)       — subscribe to any rig state change (immediate callback)
    //   removeStateChangeListener(fn) — unsubscribe
    //   pluginBus               — EventEmitter for inter-plugin events
    //                             emits: 'decode'  (WSJT-X/MSHV/JTDX/JS8Call decodes)
    //                                    'status'  (plugin connection status changes)
    //                                    'qso'     (logged QSO records)
    //                                    'aprs'    (parsed APRS packets from TNC)
    //   messageLog              — persistent log for decoded messages
    const { updateState, state, onStateChange, removeStateChangeListener, pluginBus } = services;

    return {
      connect() {
        /* open connection */
      },
      disconnect() {
        /* close connection */
      },

      // Rig category — implement these for radio control:
      setFreq(hz) {
        /* tune to frequency in Hz */
      },
      setMode(mode) {
        /* set mode string e.g. 'USB' */
      },
      setPTT(on) {
        /* key/unkey transmitter */
      },

      // Optional — register extra HTTP routes:
      // registerRoutes(app) { app.get('/my-plugin/...', handler) }
    };
  },
};
```

**Categories:**

- `rig` — radio control; the bridge dispatches `/freq`, `/mode`, `/ptt` to the active rig plugin
- `integration` — background service plugins (e.g. WSJT-X relay); started via `registry.connectIntegrations()`
- `rotator`, `logger`, `other` — use `registerRoutes(app)` to expose their own endpoints

To register a plugin at startup, call `registry.register(descriptor)` in `rig-bridge.js` before `registry.connectActive()`.
