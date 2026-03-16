/**
 * Meshtastic Routes
 * Three connection modes:
 *   1. "direct"  — Browser connects to device on LAN (no server involvement)
 *   2. "mqtt"    — Server subscribes to Meshtastic MQTT broker for remote access
 *   3. "proxy"   — Server proxies to device HTTP API on the local network
 *
 * Config persists to data/meshtastic-config.json or via .env.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const fetch = require('node-fetch');
const mqttLib = require('mqtt');

module.exports = function meshtasticRoutes(app, ctx) {
  const { logDebug, logInfo, logWarn, logErrorOnce, writeLimiter, ROOT_DIR } = ctx;

  // ── Constants ──
  const CONFIG_FILE = path.join(ROOT_DIR, 'data', 'meshtastic-config.json');
  const MIN_POLL_MS = 5000;
  const MAX_POLL_MS = 5 * 60 * 1000;

  // ── SSRF protection for proxy mode ──
  function validateDeviceHost(raw) {
    if (!raw || typeof raw !== 'string') return { ok: false, error: 'Host is required' };
    let trimmed = raw.trim();
    while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, error: 'Host must be a valid URL (e.g. http://meshtastic.local)' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Host must use http or https' };
    }
    if (parsed.hostname === '169.254.169.254' || parsed.hostname === 'metadata.google.internal') {
      return { ok: false, error: 'Cloud metadata endpoints are not allowed' };
    }
    if (net.isIP(parsed.hostname)) {
      const parts = parsed.hostname.split('.').map(Number);
      if (parts.length === 4) {
        const [o1, o2] = parts;
        const isPrivate = o1 === 127 || o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168);
        if (!isPrivate) {
          return { ok: false, error: 'Only private/local network IPs are allowed for Meshtastic devices' };
        }
      } else if (parsed.hostname !== '::1') {
        return { ok: false, error: 'Only IPv4 private addresses or ::1 are allowed' };
      }
    }
    return { ok: true, host: parsed.origin };
  }

  function clampPollMs(value) {
    const p = parseInt(value, 10);
    if (!Number.isFinite(p)) return 10000;
    return Math.min(Math.max(MIN_POLL_MS, p), MAX_POLL_MS);
  }

  // ── Config persistence ──
  function loadConfig() {
    if (process.env.MESHTASTIC_ENABLED === 'true') {
      const envHost = process.env.MESHTASTIC_HOST || 'http://meshtastic.local';
      const validated = validateDeviceHost(envHost);
      return {
        mode: process.env.MESHTASTIC_MODE || 'proxy',
        enabled: true,
        host: validated.ok ? validated.host : envHost.replace(/\/+$/, ''),
        mqttBroker: process.env.MESHTASTIC_MQTT_BROKER || '',
        mqttTopic: process.env.MESHTASTIC_MQTT_TOPIC || 'msh/US/#',
        mqttUsername: process.env.MESHTASTIC_MQTT_USERNAME || '',
        mqttPassword: process.env.MESHTASTIC_MQTT_PASSWORD || '',
        pollMs: clampPollMs(process.env.MESHTASTIC_POLL_MS || '10000'),
        source: 'env',
      };
    }
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        if (data.enabled) {
          if (data.mode === 'proxy' && data.host) {
            const validated = validateDeviceHost(data.host);
            if (!validated.ok) {
              logWarn(`[Meshtastic] Saved host rejected: ${validated.error}`);
              return { mode: 'proxy', enabled: false, host: '', pollMs: 10000, source: 'none' };
            }
            data.host = validated.host;
          }
          return { ...data, pollMs: clampPollMs(data.pollMs), source: 'saved' };
        }
        return { ...data, source: 'saved' };
      }
    } catch (e) {
      logWarn(`[Meshtastic] Failed to load config: ${e.message}`);
    }
    return { mode: '', enabled: false, host: '', mqttBroker: '', mqttTopic: 'msh/US/#', pollMs: 10000, source: 'none' };
  }

  function saveConfig(cfg) {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
      return true;
    } catch (e) {
      logWarn(`[Meshtastic] Failed to save config: ${e.message}`);
      return false;
    }
  }

  let config = loadConfig();

  // ── Shared state ──
  const state = {
    connected: false,
    lastSeen: 0,
    lastError: null,
    myNodeNum: null,
    nodes: new Map(),
    messages: [],
    maxMessages: 200,
    deviceInfo: null,
  };

  let pollTimer = null;
  let infoTimer = null;
  let mqttClient = null;

  // ── Node/message parsing (shared by proxy and MQTT) ──
  function parseNodeInfo(packet) {
    if (!packet?.user && !packet?.position) return null;
    const num = packet.num || packet.nodeNum;
    if (!num) return null;
    const existing = state.nodes.get(num) || {};
    const node = {
      ...existing,
      num,
      id: packet.user?.id || existing.id || `!${num.toString(16)}`,
      longName: packet.user?.longName || existing.longName || '',
      shortName: packet.user?.shortName || existing.shortName || '',
      hwModel: packet.user?.hwModel || existing.hwModel || '',
      lat:
        packet.position?.latitudeI != null
          ? packet.position.latitudeI / 1e7
          : (packet.position?.latitude ?? existing.lat ?? null),
      lon:
        packet.position?.longitudeI != null
          ? packet.position.longitudeI / 1e7
          : (packet.position?.longitude ?? existing.lon ?? null),
      alt: packet.position?.altitude ?? existing.alt ?? null,
      batteryLevel: packet.deviceMetrics?.batteryLevel ?? existing.batteryLevel ?? null,
      voltage: packet.deviceMetrics?.voltage ?? existing.voltage ?? null,
      snr: packet.snr ?? existing.snr ?? null,
      lastHeard: packet.lastHeard
        ? packet.lastHeard * 1000
        : packet.timestamp
          ? packet.timestamp * 1000
          : existing.lastHeard || Date.now(),
      hopsAway: packet.hopsAway ?? existing.hopsAway ?? null,
    };
    state.nodes.set(num, node);
    return node;
  }

  function addMessage(msg) {
    if (msg.id && state.messages.some((m) => m.id === msg.id)) return;
    state.messages.push(msg);
    if (state.messages.length > state.maxMessages) state.messages = state.messages.slice(-state.maxMessages);
  }

  // ── Proxy mode: fetch from device HTTP API ──
  async function proxyFetchNodes() {
    try {
      const res = await fetch(`${config.host}/api/v1/nodes`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const nodeList = data.nodes || data;
      if (Array.isArray(nodeList)) nodeList.forEach((n) => parseNodeInfo(n));
      else if (typeof nodeList === 'object') Object.values(nodeList).forEach((n) => parseNodeInfo(n));
      state.connected = true;
      state.lastSeen = Date.now();
      state.lastError = null;
    } catch (e) {
      if (state.connected) logErrorOnce('Meshtastic', `Node fetch failed: ${e.message}`);
      state.connected = false;
      state.lastError = e.message;
    }
  }

  async function proxyFetchMessages() {
    try {
      const res = await fetch(`${config.host}/api/v1/messages`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgList = data.messages || data;
      if (Array.isArray(msgList)) {
        msgList.forEach((m) => {
          const fromNode = state.nodes.get(m.from);
          addMessage({
            id: m.id || m.packetId || `${m.from}-${m.rxTime || Date.now()}`,
            from: m.from,
            to: m.to,
            text: m.text || m.payload || '',
            timestamp: m.rxTime ? m.rxTime * 1000 : Date.now(),
            channel: m.channel ?? 0,
            fromName: fromNode?.longName || fromNode?.shortName || `!${(m.from || 0).toString(16)}`,
          });
        });
      }
    } catch {}
  }

  async function proxyFetchDeviceInfo() {
    try {
      const res = await fetch(`${config.host}/api/v1/config`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const data = await res.json();
      state.deviceInfo = {
        firmwareVersion: data.firmwareVersion || data.version || null,
        hwModel: data.hwModel || null,
        region: data.lora?.region || data.region || null,
        modemPreset: data.lora?.modemPreset || null,
        shortName: data.owner?.shortName || null,
        longName: data.owner?.longName || null,
      };
    } catch {}
  }

  // ── MQTT mode: subscribe to Meshtastic MQTT broker ──
  function mqttConnect() {
    mqttDisconnect();
    if (!config.mqttBroker) return;

    const broker = config.mqttBroker;
    const topic = config.mqttTopic || 'msh/#';
    const clientId = `ohc_mesh_${Math.random().toString(16).substr(2, 8)}`;

    logInfo(`[Meshtastic MQTT] Connecting to ${broker} topic ${topic}`);

    const opts = {
      clientId,
      clean: true,
      connectTimeout: 15000,
      reconnectPeriod: 30000,
      keepalive: 60,
    };
    if (config.mqttUsername) {
      opts.username = config.mqttUsername;
      opts.password = config.mqttPassword || '';
    }

    const client = mqttLib.connect(broker, opts);
    mqttClient = client;

    client.on('connect', () => {
      state.connected = true;
      state.lastError = null;
      logInfo(`[Meshtastic MQTT] Connected to ${broker}`);
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) logWarn(`[Meshtastic MQTT] Subscribe error: ${err.message}`);
        else logInfo(`[Meshtastic MQTT] Subscribed to ${topic}`);
      });
    });

    client.on('message', (_topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        state.lastSeen = Date.now();

        // Meshtastic MQTT JSON format varies — handle common shapes
        if (data.type === 'nodeinfo' || data.payload?.user || data.payload?.position) {
          parseNodeInfo(data.payload || data);
        } else if (data.type === 'text' || data.payload?.text) {
          const p = data.payload || data;
          const fromNode = state.nodes.get(p.from);
          addMessage({
            id: data.id || `mqtt-${p.from}-${Date.now()}`,
            from: p.from,
            to: p.to,
            text: p.text || '',
            timestamp: p.timestamp ? p.timestamp * 1000 : Date.now(),
            channel: p.channel ?? 0,
            fromName: fromNode?.longName || fromNode?.shortName || `!${(p.from || 0).toString(16)}`,
          });
        } else if (data.type === 'position' && data.payload) {
          // Position-only update
          const num = data.from || data.payload.from;
          if (num) {
            parseNodeInfo({ num, position: data.payload });
          }
        }
      } catch {
        // Binary protobuf — can't parse without meshtastic protobuf definitions
        // JSON mode is required for MQTT integration
      }
    });

    client.on('error', (err) => {
      logErrorOnce('Meshtastic MQTT', err.message);
      state.lastError = err.message;
    });

    client.on('close', () => {
      state.connected = false;
    });
  }

  function mqttDisconnect() {
    if (mqttClient) {
      try {
        mqttClient.removeAllListeners();
        mqttClient.on('error', () => {});
        mqttClient.end(true);
      } catch {}
      mqttClient = null;
    }
  }

  // ── Polling lifecycle ──
  function startPolling() {
    stopPolling();
    if (!config.enabled) return;

    if (config.mode === 'mqtt') {
      mqttConnect();
      return;
    }

    if (config.mode === 'direct') {
      // Direct mode is client-side only — server just stores config
      logInfo('[Meshtastic] Direct (browser) mode — no server polling');
      return;
    }

    // Proxy mode
    if (!config.host) return;
    const interval = clampPollMs(config.pollMs);
    logInfo(`[Meshtastic] Proxy mode — polling ${config.host} every ${interval}ms`);

    setTimeout(async () => {
      await proxyFetchDeviceInfo();
      await proxyFetchNodes();
      await proxyFetchMessages();
    }, 1000);

    pollTimer = setInterval(async () => {
      await proxyFetchNodes();
      await proxyFetchMessages();
    }, interval);

    infoTimer = setInterval(proxyFetchDeviceInfo, 5 * 60 * 1000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (infoTimer) {
      clearInterval(infoTimer);
      infoTimer = null;
    }
    mqttDisconnect();
  }

  function resetState() {
    state.nodes.clear();
    state.messages = [];
    state.connected = false;
    state.deviceInfo = null;
    state.lastError = null;
  }

  if (config.enabled) startPolling();

  // ── API Endpoints ──

  app.get('/api/meshtastic/status', (req, res) => {
    res.json({
      mode: config.mode || 'proxy',
      enabled: config.enabled,
      connected: state.connected,
      lastSeen: state.lastSeen,
      lastError: state.lastError,
      host: config.mode === 'proxy' && config.enabled ? config.host : null,
      mqttBroker: config.mode === 'mqtt' && config.enabled ? config.mqttBroker : null,
      mqttTopic: config.mode === 'mqtt' ? config.mqttTopic : null,
      pollMs: config.pollMs,
      configSource: config.source,
      nodeCount: state.nodes.size,
      messageCount: state.messages.length,
      deviceInfo: state.deviceInfo,
    });
  });

  app.get('/api/meshtastic/nodes', (req, res) => {
    const nodes = [...state.nodes.values()].map((n) => ({
      num: n.num,
      id: n.id,
      longName: n.longName,
      shortName: n.shortName,
      lat: n.lat,
      lon: n.lon,
      alt: n.alt,
      batteryLevel: n.batteryLevel,
      voltage: n.voltage,
      snr: n.snr,
      lastHeard: n.lastHeard,
      hopsAway: n.hopsAway,
      hwModel: n.hwModel,
      hasPosition: n.lat != null && n.lon != null,
    }));
    res.json({ connected: state.connected, nodes, timestamp: Date.now() });
  });

  app.get('/api/meshtastic/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const messages = since ? state.messages.filter((m) => m.timestamp > since) : state.messages;
    res.json({ connected: state.connected, messages: messages.slice(-100), timestamp: Date.now() });
  });

  app.post('/api/meshtastic/send', writeLimiter, async (req, res) => {
    if (!config.enabled || !state.connected) {
      return res.status(503).json({ error: 'Meshtastic not connected' });
    }
    if (config.mode === 'direct') {
      return res.status(400).json({ error: 'Direct mode sends from the browser — use the device URL directly' });
    }
    const { text, to, channel } = req.body || {};
    if (!text || typeof text !== 'string' || text.length > 228) {
      return res.status(400).json({ error: 'Text required (max 228 chars)' });
    }
    if (config.mode === 'mqtt') {
      // Publish to MQTT
      if (!mqttClient || !mqttClient.connected) {
        return res.status(503).json({ error: 'MQTT not connected' });
      }
      try {
        const payload = JSON.stringify({
          type: 'sendtext',
          payload: { text: text.trim(), to: to || 0xffffffff, channel: channel || 0 },
        });
        mqttClient.publish(config.mqttTopic?.replace(/#$/, '') + 'sendtext', payload, { qos: 0 });
        addMessage({
          id: `local-${Date.now()}`,
          from: state.myNodeNum || 0,
          to: to || 0xffffffff,
          text: text.trim(),
          timestamp: Date.now(),
          channel: channel || 0,
          fromName: state.deviceInfo?.longName || 'Me',
        });
        return res.json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: `MQTT publish failed: ${e.message}` });
      }
    }
    // Proxy mode — forward to device
    try {
      const payload = { text: text.trim(), to: to || 0xffffffff, channel: channel || 0 };
      const sendRes = await fetch(`${config.host}/api/v1/sendtext`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!sendRes.ok) throw new Error(`Device returned ${sendRes.status}`);
      addMessage({
        id: `local-${Date.now()}`,
        from: state.myNodeNum || 0,
        to: payload.to,
        text: payload.text,
        timestamp: Date.now(),
        channel: payload.channel,
        fromName: state.deviceInfo?.longName || 'Me',
      });
      res.json({ ok: true });
    } catch (e) {
      logErrorOnce('Meshtastic', `Send failed: ${e.message}`);
      res.status(500).json({ error: `Send failed: ${e.message}` });
    }
  });

  // POST /api/meshtastic/configure
  app.post('/api/meshtastic/configure', writeLimiter, async (req, res) => {
    const { enabled, mode, host, mqttBroker, mqttTopic, mqttUsername, mqttPassword, pollMs } = req.body || {};

    // Disable
    if (enabled === false) {
      stopPolling();
      config = { ...config, enabled: false, source: 'saved' };
      resetState();
      saveConfig(config);
      return res.json({ ok: true, enabled: false, message: 'Meshtastic disabled.' });
    }

    if (!enabled || !mode) {
      return res.status(400).json({ error: 'Provide { enabled: true, mode: "direct"|"mqtt"|"proxy", ... }' });
    }

    // ── Direct mode — just save the config, browser handles everything ──
    if (mode === 'direct') {
      stopPolling();
      config = { mode: 'direct', enabled: true, host: host || '', pollMs: clampPollMs(pollMs), source: 'saved' };
      saveConfig(config);
      resetState();
      startPolling();
      return res.json({
        ok: true,
        mode: 'direct',
        message: 'Direct browser mode enabled. The browser will connect to your device.',
      });
    }

    // ── MQTT mode ──
    if (mode === 'mqtt') {
      if (!mqttBroker) {
        return res.status(400).json({ error: 'MQTT broker URL is required (e.g. mqtt://mqtt.meshtastic.org)' });
      }
      stopPolling();
      config = {
        mode: 'mqtt',
        enabled: true,
        mqttBroker: mqttBroker.trim(),
        mqttTopic: (mqttTopic || 'msh/#').trim(),
        mqttUsername: (mqttUsername || '').trim(),
        mqttPassword: (mqttPassword || '').trim(),
        pollMs: clampPollMs(pollMs),
        source: 'saved',
      };
      saveConfig(config);
      resetState();
      startPolling();
      return res.json({ ok: true, mode: 'mqtt', message: `Connected to MQTT broker ${config.mqttBroker}` });
    }

    // ── Proxy mode ──
    if (mode === 'proxy') {
      if (!host) {
        return res.status(400).json({ error: 'Device host URL is required' });
      }
      const validated = validateDeviceHost(host);
      if (!validated.ok) {
        return res.status(400).json({ error: validated.error });
      }
      // Test connection
      try {
        const testRes = await fetch(`${validated.host}/api/v1/nodes`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (!testRes.ok) {
          return res.status(502).json({ error: `Device returned HTTP ${testRes.status}. Check the address.` });
        }
      } catch (e) {
        return res.status(502).json({
          error: `Cannot reach ${validated.host} — ${e.message}. Make sure the device is on.`,
        });
      }
      stopPolling();
      config = { mode: 'proxy', enabled: true, host: validated.host, pollMs: clampPollMs(pollMs), source: 'saved' };
      saveConfig(config);
      resetState();
      startPolling();
      return res.json({ ok: true, mode: 'proxy', host: config.host, message: 'Connected and saved.' });
    }

    res.status(400).json({ error: `Unknown mode: ${mode}. Use "direct", "mqtt", or "proxy".` });
  });

  return { meshtasticState: state };
};
