/**
 * adif — ADIF (.adi) parse/build for the native logbook.
 *
 * parseAdif(text) → { header, qsos[] }
 *   - `<FIELD:len>value` and `<FIELD:len:type>value`, case-insensitive tags
 *   - `<EOH>` / `<EOR>` case-insensitive, whitespace/newlines anywhere
 *   - declared length is trusted even when the visible value looks longer or
 *     shorter (clamped at end-of-text)
 *   - garbage between records/fields is ignored
 *   - fields the QSO model doesn't cover land in `extras` (uppercase ADIF
 *     names) so import → export round-trips losslessly
 *
 * buildAdif(qsos, { myCall }) → valid ADI text (adif_ver 3.1.4).
 */
import { version as appVersion } from '../../package.json';

/** Model fields (lowercase ADIF tag → QSO record key; identity here). */
const MODEL_FIELDS = new Set([
  'call',
  'qso_date',
  'time_on',
  'band',
  'mode',
  'submode',
  'freq',
  'rst_sent',
  'rst_rcvd',
  'gridsquare',
  'name',
  'comment',
  'tx_pwr',
  'my_gridsquare',
]);

// <FIELD:len> or <FIELD:len:type> or bare <EOH>/<EOR>
const TAG_RE = /<([A-Za-z0-9_]+)(?::(\d+)(?::([^>:]*))?)?>/g;

/**
 * Walk ADIF text, invoking callbacks per data field and per record boundary.
 * Shared by header and record scanning.
 */
const scanFields = (text, { onField, onEor }) => {
  TAG_RE.lastIndex = 0;
  let match;
  while ((match = TAG_RE.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    if (name === 'eor') {
      onEor?.();
      continue;
    }
    if (name === 'eoh') continue; // handled by the header split; ignore strays
    if (match[2] === undefined) continue; // tag without a length — not a data field
    const len = parseInt(match[2], 10);
    const start = TAG_RE.lastIndex;
    // Trust the declared length; clamp only at end-of-text.
    const end = Math.min(start + (Number.isFinite(len) ? len : 0), text.length);
    const value = text.slice(start, end);
    TAG_RE.lastIndex = end;
    onField?.(name, value);
  }
};

/**
 * Parse ADIF text.
 * @param {string} text
 * @returns {{ header: object, qsos: Array<object> }}
 */
export const parseAdif = (text) => {
  const src = String(text ?? '');
  const eohMatch = /<eoh>/i.exec(src);
  const headerText = eohMatch ? src.slice(0, eohMatch.index) : '';
  const bodyText = eohMatch ? src.slice(eohMatch.index + eohMatch[0].length) : src;

  const header = {};
  scanFields(headerText, {
    onField: (name, value) => {
      header[name] = value;
    },
  });

  const qsos = [];
  let current = null;
  const ensure = () => {
    if (!current) current = { extras: {} };
    return current;
  };

  scanFields(bodyText, {
    onField: (name, value) => {
      const rec = ensure();
      if (MODEL_FIELDS.has(name)) {
        if (name === 'freq') {
          const mhz = parseFloat(value);
          if (Number.isFinite(mhz)) {
            rec.freq = mhz;
          } else {
            rec.extras.FREQ = value; // unparsable — preserve verbatim
          }
        } else if (name === 'call') {
          rec.call = value.trim().toUpperCase();
        } else {
          rec[name] = value;
        }
      } else {
        rec.extras[name.toUpperCase()] = value;
      }
    },
    onEor: () => {
      if (current && (current.call || Object.keys(current).length > 1 || Object.keys(current.extras).length > 0)) {
        qsos.push(current);
      }
      current = null;
    },
  });
  // A trailing record without <EOR> is tolerated only if it has a call —
  // otherwise it is trailing garbage.
  if (current && current.call) qsos.push(current);

  return { header, qsos };
};

const adifField = (name, value) => {
  if (value === undefined || value === null || value === '') return '';
  const str = String(value);
  return `<${name}:${str.length}>${str}`;
};

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Build ADI text from QSO records.
 * @param {Array<object>} qsos
 * @param {object} [opts]
 * @param {string} [opts.myCall] emitted as STATION_CALLSIGN on records that lack one
 * @returns {string}
 */
export const buildAdif = (qsos, { myCall } = {}) => {
  const now = new Date();
  const created =
    `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}` +
    ` ${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;

  const lines = [
    'OpenHamClock logbook export',
    adifField('adif_ver', '3.1.4'),
    adifField('programid', 'OpenHamClock'),
    adifField('programversion', appVersion),
    adifField('created_timestamp', created),
    '<eoh>',
    '',
  ];

  for (const q of Array.isArray(qsos) ? qsos : []) {
    if (!q) continue;
    const parts = [];
    parts.push(adifField('call', q.call));
    parts.push(adifField('qso_date', q.qso_date));
    parts.push(adifField('time_on', q.time_on));
    parts.push(adifField('band', q.band));
    parts.push(adifField('mode', q.mode));
    parts.push(adifField('submode', q.submode));
    if (q.freq !== undefined && q.freq !== null && q.freq !== '' && Number.isFinite(parseFloat(q.freq))) {
      parts.push(adifField('freq', parseFloat(q.freq)));
    }
    parts.push(adifField('rst_sent', q.rst_sent));
    parts.push(adifField('rst_rcvd', q.rst_rcvd));
    parts.push(adifField('gridsquare', q.gridsquare));
    parts.push(adifField('name', q.name));
    parts.push(adifField('comment', q.comment));
    parts.push(adifField('tx_pwr', q.tx_pwr));
    parts.push(adifField('my_gridsquare', q.my_gridsquare));

    const extras = q.extras && typeof q.extras === 'object' ? q.extras : {};
    const hasStationCall = Object.keys(extras).some((k) => k.toUpperCase() === 'STATION_CALLSIGN');
    for (const [name, value] of Object.entries(extras)) {
      parts.push(adifField(name.toUpperCase(), value));
    }
    if (myCall && !hasStationCall) {
      parts.push(adifField('STATION_CALLSIGN', String(myCall).toUpperCase()));
    }

    lines.push(parts.filter(Boolean).join(' ') + ' <eor>');
  }

  return lines.join('\n') + '\n';
};

export default { parseAdif, buildAdif };
