'use strict';
/**
 * rotator.js — Rotator control plugin via rotctld (Hamlib)
 *
 * Connects to a rotctld TCP server to read and control antenna rotator
 * position (azimuth and elevation).
 *
 * Config section: config.rotator
 *   enabled:      boolean  (default: false)
 *   host:         string   rotctld host (default: '127.0.0.1')
 *   port:         number   rotctld port (default: 4533)
 *   pollInterval: number   Position poll interval in ms (default: 1000)
 *   verbose:      boolean  Log all position updates (default: false)
 *
 * API endpoints:
 *   GET  /api/rotator/status     Current position + connection state
 *   POST /api/rotator/position   Set azimuth/elevation: { az, el }
 *   POST /api/rotator/stop       Stop rotation
 *   POST /api/rotator/park       Park the rotator
 */

const net = require('net');

let _currentInstance = null;

const descriptor = {
  id: 'rotator',
  name: 'Rotator (rotctld)',
  category: 'integration',
  configKey: 'rotator',

  registerRoutes(app) {
    app.get('/api/rotator/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });

    app.post('/api/rotator/position', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Rotator plugin not running' });
      const { az, el } = req.body;
      if (!Number.isFinite(az)) return res.status(400).json({ error: 'Missing azimuth' });
      if (!_currentInstance.setPosition(az, el != null ? el : 0)) {
        return res.status(503).json({ error: 'Rotator not connected' });
      }
      res.json({ success: true });
    });

    app.post('/api/rotator/stop', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Rotator plugin not running' });
      if (!_currentInstance.stop()) {
        return res.status(503).json({ error: 'Rotator not connected' });
      }
      res.json({ success: true });
    });

    app.post('/api/rotator/park', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'Rotator plugin not running' });
      if (!_currentInstance.park()) {
        return res.status(503).json({ error: 'Rotator not connected' });
      }
      res.json({ success: true });
    });
  },

  create(config) {
    const cfg = config.rotator || {};
    const host = cfg.host || '127.0.0.1';
    const port = cfg.port || 4533;
    const pollInterval = cfg.pollInterval || 1000;

    let socket = null;
    let connected = false;
    let pollTimer = null;
    let reconnectTimer = null;
    let cmdQueue = [];
    let currentAz = 0;
    let currentEl = 0;
    let targetAz = null;
    let targetEl = null;

    function sendCommand(cmd, callback) {
      if (!socket || !connected) {
        if (callback) callback(null);
        return false;
      }
      cmdQueue.push({ cmd, callback });
      socket.write(cmd + '\n');
      return true;
    }

    function pollPosition() {
      sendCommand('p', (response) => {
        if (!response) return;
        const lines = response.trim().split('\n');
        if (lines.length >= 2) {
          const az = parseFloat(lines[0]);
          const el = parseFloat(lines[1]);
          if (Number.isFinite(az)) currentAz = az;
          if (Number.isFinite(el)) currentEl = el;
          if (cfg.verbose) {
            console.log(`[Rotator] Position: AZ=${currentAz.toFixed(1)} EL=${currentEl.toFixed(1)}`);
          }
        }
      });
    }

    function setPosition(az, el) {
      targetAz = az;
      targetEl = el;
      console.log(`[Rotator] SET position: AZ=${az.toFixed(1)} EL=${el.toFixed(1)}`);
      return sendCommand(`P ${az.toFixed(1)} ${el.toFixed(1)}`);
    }

    function stop() {
      console.log('[Rotator] STOP');
      return sendCommand('S');
    }

    function park() {
      console.log('[Rotator] PARK');
      return sendCommand('K');
    }

    function connect() {
      console.log(`[Rotator] Connecting to rotctld at ${host}:${port}...`);

      socket = net.createConnection({ host, port }, () => {
        console.log(`[Rotator] Connected to ${host}:${port}`);
        connected = true;
        pollTimer = setInterval(pollPosition, pollInterval);
        pollPosition();
      });

      let responseBuffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (data) => {
        responseBuffer += data;
        // Process complete responses (terminated by RPRT or newline)
        if (responseBuffer.includes('RPRT') || responseBuffer.endsWith('\n')) {
          const pending = cmdQueue.shift();
          if (pending && pending.callback) {
            pending.callback(responseBuffer);
          }
          responseBuffer = '';
        }
      });

      socket.on('error', (err) => {
        if (connected) console.error(`[Rotator] Error: ${err.message}`);
        connected = false;
      });

      socket.on('close', () => {
        if (connected) console.log('[Rotator] Connection closed, reconnecting in 10s...');
        connected = false;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        socket = null;
        reconnectTimer = setTimeout(() => connect(), 10000);
      });
    }

    function disconnect() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        try {
          socket.destroy();
        } catch (e) {}
        socket = null;
      }
      connected = false;
      _currentInstance = null;
      console.log('[Rotator] Stopped');
    }

    function getStatus() {
      return {
        enabled: !!cfg.enabled,
        running: socket !== null,
        connected,
        azimuth: currentAz,
        elevation: currentEl,
        targetAz,
        targetEl,
        host,
        port,
      };
    }

    const instance = { connect, disconnect, getStatus, setPosition, stop, park };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
