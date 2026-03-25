'use strict';
/**
 * winlink-gateway.js — Winlink gateway discovery + Pat client integration
 *
 * Two functions:
 *   1. Gateway Discovery: Fetches RMS gateway locations from api.winlink.org
 *   2. Pat Client: Interfaces with Pat (getpat.io) HTTP API for messaging
 *
 * Config section: config.winlink
 *   enabled:         boolean  (default: false)
 *   apiKey:          string   Winlink API key for gateway discovery (from winlink.org admin)
 *   refreshInterval: number   Gateway list refresh in seconds (default: 3600)
 *   pat:
 *     enabled:       boolean  (default: false)
 *     host:          string   Pat HTTP API host (default: '127.0.0.1')
 *     port:          number   Pat HTTP API port (default: 8080)
 */

let _currentInstance = null;

const descriptor = {
  id: 'winlink-gateway',
  name: 'Winlink Gateway',
  category: 'integration',
  configKey: 'winlink',

  registerRoutes(app) {
    // Gateway discovery endpoints
    app.get('/winlink/gateways', async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Winlink plugin not running' });
      const { grid, range, mode } = req.query;
      try {
        const gateways = await _currentInstance.getGateways(grid, range, mode);
        res.json({ count: gateways.length, gateways });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/winlink/gateways/:callsign', async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Winlink plugin not running' });
      try {
        const gateway = await _currentInstance.getGateway(req.params.callsign);
        if (!gateway) return res.status(404).json({ error: 'Gateway not found' });
        res.json(gateway);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Pat client endpoints
    app.get('/winlink/inbox', async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Winlink plugin not running' });
      try {
        const messages = await _currentInstance.getInbox();
        res.json(messages);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/winlink/outbox', async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Winlink plugin not running' });
      try {
        const messages = await _currentInstance.getOutbox();
        res.json(messages);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.post('/winlink/compose', async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Winlink plugin not running' });
      const { to, cc, subject, body } = req.body;
      if (!to || !subject) return res.status(400).json({ error: 'Missing to or subject' });
      try {
        const result = await _currentInstance.compose({ to, cc, subject, body: body || '' });
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.post('/winlink/connect', async (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Winlink plugin not running' });
      const { gateway, transport } = req.body;
      try {
        const result = await _currentInstance.connectGateway(gateway, transport);
        res.json(result);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/winlink/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });
  },

  create(config) {
    const cfg = config.winlink || {};
    const apiKey = cfg.apiKey || '';
    const refreshInterval = (cfg.refreshInterval || 3600) * 1000;
    const patCfg = cfg.pat || {};
    const patUrl = `http://${patCfg.host || '127.0.0.1'}:${patCfg.port || 8080}`;

    let gatewayCache = [];
    let gatewayCacheTime = 0;
    let refreshTimer = null;
    let patReachable = false;

    // Gateway discovery via Winlink API
    async function fetchGateways(grid, range) {
      if (!apiKey) {
        console.warn('[Winlink] No API key configured — gateway discovery disabled');
        return [];
      }

      const url = grid
        ? `https://api.winlink.org/gateway/proximity?GridSquare=${encodeURIComponent(grid)}&MaxDistance=${range || 500}&key=${encodeURIComponent(apiKey)}`
        : `https://api.winlink.org/channel/list.json?key=${encodeURIComponent(apiKey)}`;

      try {
        const http = require('https');
        return new Promise((resolve, reject) => {
          http
            .get(url, (res) => {
              let data = '';
              res.on('data', (chunk) => (data += chunk));
              res.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  const gateways = Array.isArray(json) ? json : json.Gateways || json.ChannelList || [];
                  resolve(gateways);
                } catch (e) {
                  reject(new Error(`Failed to parse Winlink API response: ${e.message}`));
                }
              });
            })
            .on('error', reject);
        });
      } catch (e) {
        console.error(`[Winlink] Gateway fetch error: ${e.message}`);
        return [];
      }
    }

    async function getGateways(grid, range, mode) {
      // Use cache if fresh
      if (Date.now() - gatewayCacheTime < refreshInterval && gatewayCache.length > 0 && !grid) {
        return mode ? gatewayCache.filter((g) => (g.Mode || g.ServiceCode || '').includes(mode)) : gatewayCache;
      }

      const gateways = await fetchGateways(grid, range);
      if (!grid) {
        gatewayCache = gateways;
        gatewayCacheTime = Date.now();
      }
      return mode ? gateways.filter((g) => (g.Mode || g.ServiceCode || '').includes(mode)) : gateways;
    }

    async function getGateway(callsign) {
      const gateways = await getGateways();
      return gateways.find((g) => (g.Callsign || g.callsign || '').toUpperCase() === callsign.toUpperCase());
    }

    // Pat client integration
    async function patFetch(path, method, body) {
      if (!patCfg.enabled) throw new Error('Pat client not enabled');
      const http = require('http');
      return new Promise((resolve, reject) => {
        const options = {
          hostname: patCfg.host || '127.0.0.1',
          port: patCfg.port || 8080,
          path,
          method: method || 'GET',
          headers: { 'Content-Type': 'application/json' },
        };
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    }

    async function getInbox() {
      return patFetch('/api/mailbox/in');
    }

    async function getOutbox() {
      return patFetch('/api/mailbox/out');
    }

    async function compose({ to, cc, subject, body }) {
      return patFetch('/api/mailbox/out', 'POST', {
        to: Array.isArray(to) ? to : [to],
        cc: cc ? (Array.isArray(cc) ? cc : [cc]) : [],
        subject,
        body,
      });
    }

    async function connectGateway(gateway, transport) {
      return patFetch(
        `/api/connect?transport=${transport || 'telnet'}&target=${encodeURIComponent(gateway || '')}`,
        'POST',
      );
    }

    async function checkPatHealth() {
      try {
        await patFetch('/api/status');
        patReachable = true;
      } catch (e) {
        patReachable = false;
      }
    }

    function connect() {
      console.log(`[Winlink] Plugin started`);

      if (apiKey) {
        console.log('[Winlink] Gateway discovery enabled');
        // Pre-fetch gateway list
        fetchGateways()
          .then((g) => {
            gatewayCache = g;
            gatewayCacheTime = Date.now();
            console.log(`[Winlink] Loaded ${g.length} gateways`);
          })
          .catch((e) => console.error(`[Winlink] Initial gateway fetch failed: ${e.message}`));

        refreshTimer = setInterval(async () => {
          try {
            const g = await fetchGateways();
            gatewayCache = g;
            gatewayCacheTime = Date.now();
          } catch (e) {}
        }, refreshInterval);
      } else {
        console.log('[Winlink] No API key — gateway discovery disabled (set winlink.apiKey)');
      }

      if (patCfg.enabled) {
        console.log(`[Winlink] Pat client integration at ${patUrl}`);
        checkPatHealth();
        setInterval(checkPatHealth, 30000);
      }
    }

    function disconnect() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      _currentInstance = null;
      console.log('[Winlink] Stopped');
    }

    function getStatus() {
      return {
        enabled: !!cfg.enabled,
        running: true,
        gatewayDiscovery: !!apiKey,
        gatewayCount: gatewayCache.length,
        patEnabled: !!patCfg.enabled,
        patReachable,
        patUrl: patCfg.enabled ? patUrl : null,
      };
    }

    const instance = {
      connect,
      disconnect,
      getStatus,
      getGateways,
      getGateway,
      getInbox,
      getOutbox,
      compose,
      connectGateway,
    };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
