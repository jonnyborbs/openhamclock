/**
 * Public telnet front-end — the part that makes this an actual cluster node
 * rather than another HTTP aggregator.
 *
 * Speaks enough of the classic DXSpider dialect for loggers, HamClock and
 * humans with a telnet client:
 *   login:  callsign (validated; junk is rejected, three strikes and out)
 *   stream: "DX de ..." lines as spots arrive (on by default)
 *   sh/dx [n]      last n spots (default 10, max 100)
 *   set/dx         enable the live stream
 *   unset/dx       disable the live stream
 *   dx <freq> <call> [comment]   submit a human spot
 *   bye / quit / q / exit, help / ?
 *
 * Abuse posture (we know exactly how unattended clients can hurt a node):
 * per-IP connection caps, login attempt limits, line length caps, command
 * flood disconnects, idle timeout, and rate-limited spot submission.
 */

const net = require('net');
const { isValidCallsign, baseCallsign, sanitizeLine } = require('./callsign.js');
const { formatSpotLine } = require('./format.js');

const LIMITS = {
  maxClients: 200,
  maxPerIp: 5,
  maxLoginAttempts: 3,
  loginTimeoutMs: 60 * 1000,
  idleTimeoutMs: 60 * 60 * 1000, // we stream TO clients; an hour with no input is fine
  maxLineLength: 256,
  floodWindowMs: 10 * 1000,
  floodMaxLines: 20,
  submitWindowMs: 60 * 1000,
  submitMaxPerWindow: 5,
};

class TelnetClusterServer {
  constructor({ port, nodeCall, store, log, motd }) {
    this.port = port;
    this.nodeCall = nodeCall;
    this.store = store;
    this.log = log;
    this.motd = motd || 'Welcome to the OpenHamClock DX Cluster';
    this.server = null;
    this.clients = new Set();
    this.ipCounts = new Map();
    this.totalLogins = 0;
    this.totalSubmissions = 0;
    this.unsubscribe = null;
  }

  start() {
    this.unsubscribe = this.store.onSpot((spot) => this._broadcast(spot));
    this.server = net.createServer((socket) => this._onConnection(socket));
    this.server.on('error', (err) => this.log('ERROR', `[Telnet] server error: ${err.message}`));
    this.server.listen(this.port, () => {
      this.log('START', `[Telnet] cluster listening on :${this.port} as ${this.nodeCall}`);
    });
  }

  stop() {
    this.unsubscribe?.();
    for (const c of this.clients) {
      try {
        c.socket.destroy();
      } catch {}
    }
    this.clients.clear();
    this.server?.close();
  }

  status() {
    return {
      port: this.port,
      clients: this.clients.size,
      loggedIn: [...this.clients].filter((c) => c.call).length,
      totalLogins: this.totalLogins,
      totalSubmissions: this.totalSubmissions,
    };
  }

  _prompt(client) {
    const d = new Date();
    const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
    return `${client.call} de ${this.nodeCall} ${hhmm} >\r\n`;
  }

  _onConnection(socket) {
    const ip = socket.remoteAddress || 'unknown';
    const perIp = this.ipCounts.get(ip) || 0;

    if (this.clients.size >= LIMITS.maxClients || perIp >= LIMITS.maxPerIp) {
      socket.end('Too many connections, sorry. 73\r\n');
      return;
    }
    this.ipCounts.set(ip, perIp + 1);

    const client = {
      socket,
      ip,
      call: null,
      streaming: true,
      loginAttempts: 0,
      buffer: '',
      lineTimes: [],
      submitTimes: [],
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.clients.add(client);
    socket.setKeepAlive(true, 60 * 1000);

    const write = (text) => {
      if (!socket.destroyed) socket.write(text);
    };

    write(`${this.motd}\r\n\r\nrunning OHC-Cluster — spots from RBN skimmers + human spotters\r\n\r\n`);
    write('Please enter your call: ');

    const loginTimer = setTimeout(() => {
      if (!client.call) {
        write('Login timeout. 73\r\n');
        socket.destroy();
      }
    }, LIMITS.loginTimeoutMs);

    const idleTimer = setInterval(() => {
      if (Date.now() - client.lastActivityAt > LIMITS.idleTimeoutMs) {
        write(`Idle timeout. 73 de ${this.nodeCall}\r\n`);
        socket.destroy();
      }
    }, 60 * 1000);

    socket.on('data', (data) => {
      client.lastActivityAt = Date.now();
      client.buffer += data.toString('utf8');

      if (client.buffer.length > LIMITS.maxLineLength * 4) {
        write('Input too long. 73\r\n');
        socket.destroy();
        return;
      }

      const lines = client.buffer.split(/\r?\n/);
      client.buffer = lines.pop() || '';

      for (const rawLine of lines) {
        // Flood guard: too many lines in the window = not a human, not a logger
        const now = Date.now();
        client.lineTimes = client.lineTimes.filter((t) => now - t < LIMITS.floodWindowMs);
        client.lineTimes.push(now);
        if (client.lineTimes.length > LIMITS.floodMaxLines) {
          this.log('ERROR', `[Telnet] flood from ${ip}, disconnecting`);
          socket.destroy();
          return;
        }

        const line = sanitizeLine(rawLine).slice(0, LIMITS.maxLineLength);
        if (!client.call) {
          this._handleLogin(client, line, write, loginTimer);
        } else if (line) {
          this._handleCommand(client, line, write);
        }
      }
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      clearTimeout(loginTimer);
      clearInterval(idleTimer);
      this.clients.delete(client);
      const n = (this.ipCounts.get(ip) || 1) - 1;
      if (n <= 0) this.ipCounts.delete(ip);
      else this.ipCounts.set(ip, n);
      if (client.call) this.log('CLOSE', `[Telnet] ${client.call} disconnected (${ip})`);
    });
  }

  _handleLogin(client, line, write, loginTimer) {
    if (!line) return;
    const call = line.toUpperCase();

    if (!isValidCallsign(call)) {
      client.loginAttempts++;
      if (client.loginAttempts >= LIMITS.maxLoginAttempts) {
        write('Sorry, that is not a valid amateur callsign. 73\r\n');
        client.socket.destroy();
        return;
      }
      write('That does not look like a valid callsign.\r\nPlease enter your call: ');
      return;
    }

    clearTimeout(loginTimer);
    client.call = call;
    this.totalLogins++;
    this.log('AUTH', `[Telnet] ${call} logged in from ${client.ip}`);

    write(`\r\nHello ${call}, welcome to ${this.nodeCall} — the OpenHamClock cluster.\r\n`);
    write(`Spot stream is ON. Commands: sh/dx [n], set/dx, unset/dx, dx <freq> <call> [comment], help, bye\r\n\r\n`);

    // A taste of recent activity so the screen isn't blank
    const recent = this.store.query({ limit: 10 });
    for (let i = recent.length - 1; i >= 0; i--) write(`${formatSpotLine(recent[i])}\r\n`);
    write(this._prompt(client));
  }

  _handleCommand(client, line, write) {
    const lower = line.toLowerCase();
    const [cmd, ...rest] = lower.split(/\s+/);

    if (['bye', 'quit', 'q', 'exit', 'b'].includes(cmd)) {
      write(`73 de ${this.nodeCall}\r\n`);
      client.socket.end();
      return;
    }

    if (cmd === 'help' || cmd === '?' || cmd === 'h') {
      write(
        [
          'OHC-Cluster commands:',
          '  sh/dx [n]                  show last n spots (default 10, max 100)',
          '  sh/dx/human [n]            show last n human (non-skimmer) spots',
          '  set/dx                     enable live spot stream',
          '  unset/dx                   disable live spot stream',
          '  dx <freq-khz> <call> [comment]   submit a spot',
          '  bye                        disconnect',
          '',
        ].join('\r\n') + '\r\n',
      );
      write(this._prompt(client));
      return;
    }

    if (cmd === 'sh/dx' || cmd === 'show/dx' || cmd === 'sh/dx/human' || cmd === 'show/dx/human') {
      const humanOnly = cmd.endsWith('/human');
      const n = Math.min(Math.max(parseInt(rest[0], 10) || 10, 1), 100);
      const spots = this.store.query({ limit: n, humanOnly });
      if (spots.length === 0) write('No spots yet.\r\n');
      for (let i = spots.length - 1; i >= 0; i--) write(`${formatSpotLine(spots[i])}\r\n`);
      write(this._prompt(client));
      return;
    }

    if (cmd === 'set/dx') {
      client.streaming = true;
      write('Spot stream enabled.\r\n' + this._prompt(client));
      return;
    }

    if (cmd === 'unset/dx' || cmd === 'set/nodx') {
      client.streaming = false;
      write('Spot stream disabled.\r\n' + this._prompt(client));
      return;
    }

    if (cmd === 'dx') {
      this._handleSubmission(client, line, write);
      return;
    }

    write(`Unknown command. Try: help\r\n${this._prompt(client)}`);
  }

  _handleSubmission(client, line, write) {
    const now = Date.now();
    client.submitTimes = client.submitTimes.filter((t) => now - t < LIMITS.submitWindowMs);
    if (client.submitTimes.length >= LIMITS.submitMaxPerWindow) {
      write(`Easy there — max ${LIMITS.submitMaxPerWindow} spots per minute.\r\n${this._prompt(client)}`);
      return;
    }

    // dx 14025.5 W1AW worked him long path
    const m = line.match(/^dx\s+([\d.]+)\s+([A-Za-z0-9/]+)\s*(.*)$/i);
    if (!m) {
      write(`Usage: dx <freq-khz> <call> [comment]\r\n${this._prompt(client)}`);
      return;
    }
    const freqKhz = parseFloat(m[1]);
    const dxCall = m[2].toUpperCase();
    const comment = (m[3] || '').slice(0, 60);

    if (!Number.isFinite(freqKhz) || freqKhz < 100 || freqKhz > 1300000) {
      write(`Frequency out of range (kHz expected).\r\n${this._prompt(client)}`);
      return;
    }
    if (!isValidCallsign(dxCall)) {
      write(`"${dxCall}" does not look like a valid callsign.\r\n${this._prompt(client)}`);
      return;
    }

    client.submitTimes.push(now);
    this.totalSubmissions++;
    this.store.add({
      spotter: baseCallsign(client.call),
      call: dxCall,
      freqKhz,
      comment,
      timestamp: now,
      source: 'OHC',
      isSkimmer: false,
    });
    this.log('SPOT', `[Telnet] ${client.call} spotted ${dxCall} on ${freqKhz} kHz`);
    write(this._prompt(client));
  }

  _broadcast(spot) {
    const line = `${formatSpotLine(spot)}\r\n`;
    for (const client of this.clients) {
      if (!client.call || !client.streaming) continue;
      try {
        if (!client.socket.destroyed) client.socket.write(line);
      } catch {}
    }
  }
}

module.exports = { TelnetClusterServer, LIMITS };
