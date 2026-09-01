/**
 * Open REST API — QSO map layer ingest (issue #1015).
 *
 * Lets ANY external logging application push logged QSOs to OpenHamClock so
 * they render on the user's map (the "Logged QSOs (API)" layer), without
 * requiring N3FJP/N1MM/WSJT-X specifically. See docs/API.md for the contract.
 *
 *   POST   /api/qso-layer  — push QSOs (single object, array, or { qsos: [...] })
 *   GET    /api/qso-layer  — read stored QSOs (the map layer polls this)
 *   DELETE /api/qso-layer  — clear all stored QSOs
 *
 * Storage mirrors the N3FJP logged-QSO relay: a simple in-memory list on the
 * user's own (self-hosted) instance — capped, pruned by retention window,
 * lost on restart by design. Writes go through the same writeLimiter +
 * requireWriteAuth (API_WRITE_KEY) gate as the other ingest endpoints:
 * open on local installs with no key configured, Bearer-token guarded otherwise.
 */

const { normalizeQsoBatch } = require('../utils/qsoLayer');

module.exports = function (app, ctx) {
  const { writeLimiter, requireWriteAuth } = ctx;

  const QSO_LAYER_RETENTION_MINUTES = parseInt(process.env.QSO_LAYER_RETENTION_MINUTES || '1440', 10);
  const QSO_LAYER_MAX_QSOS = parseInt(process.env.QSO_LAYER_MAX_QSOS || '500', 10);

  let apiQsos = []; // newest first

  function pruneApiQsos() {
    const cutoff = Date.now() - QSO_LAYER_RETENTION_MINUTES * 60 * 1000;
    apiQsos = apiQsos.filter((q) => {
      const t = Date.parse(q.ts_utc || '');
      return !Number.isNaN(t) && t >= cutoff;
    });
    if (apiQsos.length > QSO_LAYER_MAX_QSOS) apiQsos.length = QSO_LAYER_MAX_QSOS;
  }

  // Ingest QSOs. Accepts one QSO object, a bare array, or { qsos: [...] }.
  app.post('/api/qso-layer', writeLimiter, requireWriteAuth, (req, res) => {
    const { qsos, errors } = normalizeQsoBatch(req.body);

    if (qsos.length === 0) {
      return res.status(400).json({ ok: false, accepted: 0, errors });
    }

    // Dedupe: an identical call + timestamp + frequency is the same QSO
    // re-sent (loggers commonly retry) — replace rather than duplicate.
    for (const qso of qsos) {
      apiQsos = apiQsos.filter((q) => !(q.call === qso.call && q.ts_utc === qso.ts_utc && q.freq === qso.freq));
      apiQsos.unshift(qso);
    }
    pruneApiQsos();

    res.json({
      ok: true,
      accepted: qsos.length,
      rejected: errors.length,
      ...(errors.length ? { errors } : {}),
      stored: apiQsos.length,
    });
  });

  // Read stored QSOs — same response shape as /api/n3fjp/qsos so map layer
  // code stays symmetrical.
  app.get('/api/qso-layer', (req, res) => {
    pruneApiQsos();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      retention_minutes: QSO_LAYER_RETENTION_MINUTES,
      max_qsos: QSO_LAYER_MAX_QSOS,
      qsos: apiQsos,
    });
  });

  // Clear the layer (e.g. logger starting a fresh session).
  app.delete('/api/qso-layer', writeLimiter, requireWriteAuth, (req, res) => {
    const cleared = apiQsos.length;
    apiQsos = [];
    res.json({ ok: true, cleared });
  });
};
