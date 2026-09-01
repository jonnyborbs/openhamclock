/**
 * POTA activator self-spotting for the POTA Activator panel.
 *
 * POST /api/pota/spot — validates and forwards a spot to POTA's spot
 * endpoint (the same one third-party spotting tools use; it accepts
 * posts identified by the activator/spotter callsigns). Upstream errors
 * are passed through verbatim so the operator sees exactly what POTA
 * said. A per-IP cooldown keeps one stuck client from hammering POTA.
 *
 * GET /api/pota/park/:reference — park lookup (name/location) so the
 * panel can confirm the reference before spotting. Cached 24 h per ref.
 */

const POTA_SPOT_URL = 'https://api.pota.app/spot';
const POTA_PARK_URL = 'https://api.pota.app/park/';
const SPOT_COOLDOWN_MS = 30 * 1000;
const PARK_CACHE_TTL = 24 * 60 * 60 * 1000;
const PARK_CACHE_MAX = 200;

const CALLSIGN_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,5}(\/[A-Z0-9]{1,4})?$/;
const REFERENCE_RE = /^[A-Z0-9]{1,4}-[0-9]{4,5}$/;

/**
 * Validate a spot request body → { spot } or { error }.
 * Frequency is kHz (POTA convention), passed as a string upstream.
 */
function validateSpot(body) {
  const activator = String(body?.activator || '')
    .trim()
    .toUpperCase();
  const spotter = String(body?.spotter || activator)
    .trim()
    .toUpperCase();
  const reference = String(body?.reference || '')
    .trim()
    .toUpperCase();
  const frequency = Number(body?.frequency);
  const mode = String(body?.mode || '')
    .trim()
    .toUpperCase()
    .slice(0, 12);
  const comments = String(body?.comments || '')
    .trim()
    .slice(0, 120);

  if (!CALLSIGN_RE.test(activator)) return { error: 'Valid activator callsign required' };
  if (!CALLSIGN_RE.test(spotter)) return { error: 'Valid spotter callsign required' };
  if (!REFERENCE_RE.test(reference)) return { error: 'Valid park reference required (e.g. US-1211)' };
  if (!Number.isFinite(frequency) || frequency < 1800 || frequency > 1300000) {
    return { error: 'Frequency must be in kHz (1800–1300000)' };
  }

  return {
    spot: {
      activator,
      spotter,
      reference,
      frequency: String(frequency),
      mode,
      comments,
      source: 'OpenHamClock',
    },
  };
}

module.exports = function (app, ctx) {
  const { fetch, APP_VERSION, logDebug, logErrorOnce } = ctx;

  const lastSpotByIp = new Map();
  const parkCache = new Map(); // reference → { data, timestamp }

  app.post('/api/pota/spot', async (req, res) => {
    const ip = req.ip || 'unknown';
    const last = lastSpotByIp.get(ip) || 0;
    if (Date.now() - last < SPOT_COOLDOWN_MS) {
      const wait = Math.ceil((SPOT_COOLDOWN_MS - (Date.now() - last)) / 1000);
      return res.status(429).json({ error: `Please wait ${wait}s between spots` });
    }

    const { spot, error } = validateSpot(req.body);
    if (error) return res.status(400).json({ error });

    try {
      const response = await fetch(POTA_SPOT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `OpenHamClock/${APP_VERSION}`,
        },
        body: JSON.stringify(spot),
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      lastSpotByIp.set(ip, Date.now());
      if (lastSpotByIp.size > 500) {
        // Drop oldest entries — this is a small per-IP cooldown map, not a log
        const cutoff = Date.now() - SPOT_COOLDOWN_MS;
        for (const [k, t] of lastSpotByIp) if (t < cutoff) lastSpotByIp.delete(k);
      }
      logDebug('[POTA spot]', spot.activator, '@', spot.reference, '→', response.status);
      // Pass POTA's verdict through — the panel shows it verbatim
      res.status(response.ok ? 200 : 502).json({
        ok: response.ok,
        status: response.status,
        message: text.slice(0, 300),
      });
    } catch (err) {
      logErrorOnce('POTA spot', err.message);
      res.status(502).json({ ok: false, error: 'Failed to reach POTA' });
    }
  });

  app.get('/api/pota/park/:reference', async (req, res) => {
    const reference = String(req.params.reference || '')
      .trim()
      .toUpperCase();
    if (!REFERENCE_RE.test(reference)) return res.status(400).json({ error: 'Invalid park reference' });

    try {
      const cached = parkCache.get(reference);
      if (cached && Date.now() - cached.timestamp < PARK_CACHE_TTL) {
        return res.json(cached.data);
      }
      const response = await fetch(POTA_PARK_URL + reference, {
        headers: { 'User-Agent': `OpenHamClock/${APP_VERSION}` },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 404) return res.status(404).json({ error: 'Park not found' });
      if (!response.ok) throw new Error(`POTA park responded ${response.status}`);
      const park = await response.json();
      const data = {
        reference: park.reference || reference,
        name: park.name || null,
        location: park.locationName || park.locationDesc || null,
        grid: park.grid6 || park.grid4 || null,
        active: park.active !== 0,
      };
      parkCache.set(reference, { data, timestamp: Date.now() });
      while (parkCache.size > PARK_CACHE_MAX) parkCache.delete(parkCache.keys().next().value);
      res.json(data);
    } catch (error) {
      logErrorOnce('POTA park', error.message);
      res.status(502).json({ error: 'Failed to look up park' });
    }
  });
};

module.exports.validateSpot = validateSpot;
