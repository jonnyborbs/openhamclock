const net = require('net');
const http = require('http');

const OHC_HOST = '127.0.0.1';
const OHC_PORT = 3001;

// N3FJP default placeholder coordinates for the 1st call district.
const N3FJP_DEFAULT_LAT = 42.4;
const N3FJP_DEFAULT_LON = -71.7;

let N3FJP_HOST = process.env.N3FJP_TARGET_HOST || '127.0.0.1';
let N3FJP_PORT = parseInt(process.env.N3FJP_TARGET_PORT, 10) || 1100;

const client = new net.Socket();
client.setNoDelay(true); // Kills network buffering lag

// 💡 Fetch configuration dynamically from the database via your server's API
function initBridge() {
  http
    .get(`http://${OHC_HOST}:${OHC_PORT}/api/settings`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const settings = JSON.parse(body);
          // Fallback checks for whatever key you named your integration fields
          if (settings.n3fjp_host || settings.n3fjpIp) {
            N3FJP_HOST = settings.n3fjp_host || settings.n3fjpIp;
            N3FJP_PORT = parseInt(settings.n3fjp_port || settings.n3fjpPort, 10) || 1100;
          }
        } catch (e) {
          console.log('ℹ️ Could not parse settings API response, using defaults.');
        }

        console.log(`📡 Attempting network connection to N3FJP at ${N3FJP_HOST}:${N3FJP_PORT}...`);
        client.connect(N3FJP_PORT, N3FJP_HOST, () => {
          console.log(`✅ Bridge Connected to N3FJP at ${N3FJP_HOST}:${N3FJP_PORT} (Low-Latency Mode)`);
          reportConnectionStatus(true);
        });
      });
    })
    .on('error', () => {
      console.log('⚠️ Settings API unavailable yet. Connecting to local default...');
      client.connect(N3FJP_PORT, N3FJP_HOST, () => {
        reportConnectionStatus(true);
      });
    });
}

// Helper to broadcast the TCP socket status back to the main server
function reportConnectionStatus(isConnected) {
  const payload = JSON.stringify({ source: 'n3fjp', connected: isConnected });

  const req = http.request(
    {
      hostname: OHC_HOST,
      port: OHC_PORT,
      path: '/api/n3fjp/status',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Connection: 'close',
      },
    },
    (res) => {
      res.on('data', () => {});
    },
  );

  req.on('error', () => {
    /* Suppress error if main server is restarting */
  });
  req.write(payload);
  req.end();
}

// Start the bridge initialization
initBridge();

let dataBuffer = '';

client.on('data', (data) => {
  dataBuffer += data.toString();
  while (dataBuffer.includes('</CMD>')) {
    const endIdx = dataBuffer.indexOf('</CMD>') + 6;
    const currentRecord = dataBuffer.substring(0, endIdx);
    dataBuffer = dataBuffer.substring(endIdx);
    processN3FJPRecord(currentRecord);
  }
});

// Utility to convert ADIF format (e.g., N044 38.5 or W070 12.3) to Decimal Degrees
function parseAdifCoords(rawStr, isLongitude) {
  if (!rawStr) return 0;
  const clean = rawStr.toUpperCase().trim();
  if (!clean) return 0;

  const match = clean.match(/^([NSEW])\s*(\d+)(?:\s+([\d.]+))?/);
  if (!match) {
    const val = parseFloat(clean);
    return Number.isFinite(val) ? val : 0;
  }

  const dir = match[1];
  const degrees = parseInt(match[2], 10);
  const minutes = match[3] ? parseFloat(match[3]) : 0;

  let decimal = degrees + minutes / 60;

  if (dir === 'S' || dir === 'W') {
    decimal = -decimal;
  }

  // 💡 BOUNDS CHECK (Per K0CJH feedback): Ensure coordinates fall within valid ranges
  if (isLongitude) {
    if (decimal < -180 || decimal > 180) return 0;
  } else {
    if (decimal < -90 || decimal > 90) return 0;
  }

  return decimal;
}

// Quick helper to fetch true callsign coordinates from your existing server database
function fetchTrueCallCoords(callsign) {
  return new Promise((resolve) => {
    const call = (callsign || '').toUpperCase().trim();
    if (!call || call === 'CLEAR') return resolve(null);

    const req = http.get(`http://${OHC_HOST}:${OHC_PORT}/api/callsign/${encodeURIComponent(call)}`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data && typeof data.lat === 'number' && typeof data.lon === 'number') {
            return resolve({ lat: data.lat, lon: data.lon });
          }
        } catch (e) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// 💡 THE PREVIEW CACHE: Tracks coordinates between tabbing out and logging the contact
const activePreviews = {};

async function processN3FJPRecord(raw) {
  const getTag = (tag) => {
    const m = raw.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
    return m && m[1] ? m[1].trim() : '';
  };

  const call = getTag('CALL');
  const isClearSignal = raw.includes('CLEARTAB') || raw.includes('<CLEAR>') || (raw.includes('CALLTAB') && call === '');

  let eventType = isClearSignal ? 'clear' : raw.includes('CALLTAB') ? 'preview' : 'log';

  if (!call && eventType !== 'clear') return;

  // Handle clearing out the cache if you clear the contact window in N3FJP
  if (isClearSignal && call) {
    delete activePreviews[call];
  }

  // Parse the raw incoming coordinates out of N3FJP
  const rawLat = getTag('LAT');
  const rawLon = getTag('LON');
  let lat = parseAdifCoords(rawLat, false);
  let lon = parseAdifCoords(rawLon, true);

  const isPlaceholder = lat === N3FJP_DEFAULT_LAT && lon === N3FJP_DEFAULT_LON;
  const isBlankCoords = lat === 0.0 && lon === 0.0;

  // 📡 PREVIEW PHASE: Capture the accurate coordinates when you tab out
  if (eventType === 'preview') {
    if ((isPlaceholder || isBlankCoords) && call) {
      const trueCoords = await fetchTrueCallCoords(call);
      if (trueCoords) {
        lat = trueCoords.lat;
        lon = trueCoords.lon;
      } else {
        lat = undefined;
        lon = undefined;
      }
    }
    if (call) {
      activePreviews[call] = { lat, lon };
    }
  }

  // 📝 LOGGING PHASE: Lock in the preview position to defeat N3FJP's call-district overrides
  if (eventType === 'log' && call) {
    if (activePreviews[call]) {
      lat = activePreviews[call].lat;
      lon = activePreviews[call].lon;
      delete activePreviews[call]; // Clean up memory
    } else if (isPlaceholder || isBlankCoords) {
      lat = undefined;
      lon = undefined;
    }
  }

  const qso = {
    dx_call: isClearSignal ? 'CLEAR' : call,
    dx_grid: getTag('GRIDSQUARE') || getTag('GRID'),
    lat: lat,
    lon: lon,
    status: isClearSignal ? 'clear' : eventType,
    source: 'n3fjp',
    ts_utc: new Date().toISOString(),
  };

  const payload = JSON.stringify(qso);
  const req = http.request(
    {
      hostname: OHC_HOST,
      port: OHC_PORT,
      path: '/api/n3fjp/qso',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Connection: 'close',
      },
    },
    (res) => {
      res.on('data', () => {});
    },
  );

  req.on('error', (e) => console.error('❌ Bridge Error:', e.message));
  req.write(payload);
  req.end();

  console.log(
    `⚡ ${eventType === 'clear' ? '🗑️  CLEARED' : eventType === 'preview' ? '📡 PREVIEW' : '💾 LOGGED'}: ${call || 'N/A'} (Lat: ${lat ? lat.toFixed(2) : 'AUTO'}, Lon: ${lon ? lon.toFixed(2) : 'AUTO'})`,
  );
}

// Global listeners for handling drops and automatic retries
client.on('error', (err) => {
  console.error('❌ Socket Error:', err.message);
  reportConnectionStatus(false);
});

client.on('close', () => {
  console.log(`📡 Connection to N3FJP closed. Retrying to connect to ${N3FJP_HOST} in 5s...`);
  reportConnectionStatus(false);
  setTimeout(() => client.connect(N3FJP_PORT, N3FJP_HOST), 5000);
});
