'use strict';
/**
 * plugins/rtl-tcp.js — RTL-SDR via rtl_tcp binary protocol plugin
 *
 * Connects to an rtl_tcp server for cheap RTL-SDR dongles. Receive-only —
 * setMode and setPTT are no-ops. Frequency changes are sent as 5-byte
 * binary commands; IQ sample data from the server is discarded.
 *
 * Start rtl_tcp:  rtl_tcp -a 127.0.0.1 -p 1234
 */

const net = require('net');

// rtl_tcp tuner types (from header byte)
const TUNER_TYPES = {
  1: 'E4000',
  2: 'FC0012',
  3: 'FC0013',
  4: 'FC2580',
  5: 'R820T',
  6: 'R828D',
};

module.exports = {
  id: 'rtl-tcp',
  name: 'RTL-SDR (rtl_tcp)',
  category: 'rig',
  configKey: 'rtltcp',

  create(config, { updateState, state }) {
    const cfg = config.rtltcp || {};
    const host = cfg.host || '127.0.0.1';
    const port = cfg.port || 1234;
    const sampleRate = cfg.sampleRate || 2400000;
    const gain = cfg.gain ?? 'auto';

    let socket = null;
    let reconnectTimer = null;
    let wasExplicitlyDisconnected = false;
    let headerParsed = false;
    let headerBuf = Buffer.alloc(0);

    /**
     * Send a 5-byte rtl_tcp command: 1 byte command ID + 4 bytes big-endian value
     */
    function sendCmd(cmdByte, value) {
      if (!socket) return;
      const buf = Buffer.alloc(5);
      buf.writeUInt8(cmdByte, 0);
      buf.writeUInt32BE(value >>> 0, 1);
      socket.write(buf);
    }

    function configureDevice() {
      // Set sample rate (cmd 0x02)
      console.log(`[RTL-TCP] Setting sample rate: ${(sampleRate / 1e6).toFixed(1)} MS/s`);
      sendCmd(0x02, sampleRate);

      if (gain === 'auto') {
        // Automatic gain mode (cmd 0x03, value 0)
        console.log('[RTL-TCP] Gain mode: auto');
        sendCmd(0x03, 0);
      } else {
        // Manual gain mode (cmd 0x03, value 1)
        const gainTenths = Math.round(parseFloat(gain) * 10);
        console.log(`[RTL-TCP] Gain mode: manual, ${gain} dB`);
        sendCmd(0x03, 1);
        // Set gain value in tenths of dB (cmd 0x04)
        sendCmd(0x04, gainTenths);
      }
    }

    function connect() {
      if (socket) return;
      wasExplicitlyDisconnected = false;
      headerParsed = false;
      headerBuf = Buffer.alloc(0);

      console.log(`[RTL-TCP] Connecting to ${host}:${port}...`);

      const s = new net.Socket();
      s.connect(port, host, () => {
        console.log('[RTL-TCP] Connected');
        socket = s;
      });

      s.on('data', (data) => {
        if (!headerParsed) {
          // Accumulate until we have the 12-byte header
          headerBuf = Buffer.concat([headerBuf, data]);
          if (headerBuf.length < 12) return;

          // Parse header: 4 bytes magic ("RTL0"), 4 bytes tuner type, 4 bytes gain count
          const magic = headerBuf.toString('ascii', 0, 4);
          if (magic !== 'RTL0') {
            console.error(`[RTL-TCP] Invalid magic: "${magic}" — expected "RTL0"`);
            s.destroy();
            return;
          }

          const tunerType = headerBuf.readUInt32BE(4);
          const gainCount = headerBuf.readUInt32BE(8);
          const tunerName = TUNER_TYPES[tunerType] || `Unknown (${tunerType})`;
          console.log(`[RTL-TCP] Tuner: ${tunerName}, gain steps: ${gainCount}`);

          headerParsed = true;
          headerBuf = null; // free

          // Configure device and mark connected
          configureDevice();
          updateState('connected', true);

          // Any remaining data after header is IQ samples — discard
          return;
        }

        // After header, all incoming data is IQ samples — discard silently.
        // Do NOT accumulate — just let GC reclaim the buffer.
      });

      s.on('close', () => {
        updateState('connected', false);
        socket = null;

        if (!wasExplicitlyDisconnected) {
          console.log('[RTL-TCP] Connection lost — retrying in 5 s…');
          reconnectTimer = setTimeout(connect, 5000);
        }
      });

      s.on('error', (err) => {
        if (!wasExplicitlyDisconnected) {
          console.error(`[RTL-TCP] Error: ${err.message}`);
        }
        s.destroy();
      });
    }

    function disconnect() {
      wasExplicitlyDisconnected = true;
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
      headerParsed = false;
      headerBuf = Buffer.alloc(0);
      updateState('connected', false);
      console.log('[RTL-TCP] Disconnected');
    }

    function setFreq(hz) {
      console.log(`[RTL-TCP] SET FREQ: ${(hz / 1e6).toFixed(6)} MHz`);
      sendCmd(0x01, hz);
      // rtl_tcp has no readback — self-report the frequency
      updateState('freq', hz);
    }

    function setMode(_mode) {
      // No-op: RTL-SDR is an IQ dongle with no mode concept
    }

    function setPTT(_on) {
      // No-op: RTL-SDR is receive-only
    }

    return { connect, disconnect, setFreq, setMode, setPTT };
  },
};
