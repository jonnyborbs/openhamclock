'use strict';
/**
 * aprs-parser.js — Lightweight APRS position packet parser
 *
 * Parses a raw APRS line ("CALLSIGN>PATH:payload") into a station object
 * with lat/lon, symbol, comment, speed, course, and altitude.
 * Returns null for non-position packets (messages, telemetry, status, etc.).
 *
 * Supported APRS position formats:
 *   !  =  Position without timestamp (uncompressed)
 *   /  @  Position with timestamp    (uncompressed)
 *   ;     Object report
 */

// Parse APRS uncompressed latitude: DDMM.MMN
function parseAprsLat(s) {
  if (!s || s.length < 8) return NaN;
  const deg = parseInt(s.substring(0, 2));
  const min = parseFloat(s.substring(2, 7));
  const hemi = s.charAt(7);
  const lat = deg + min / 60;
  return hemi === 'S' ? -lat : lat;
}

// Parse APRS uncompressed longitude: DDDMM.MMW
function parseAprsLon(s) {
  if (!s || s.length < 9) return NaN;
  const deg = parseInt(s.substring(0, 3));
  const min = parseFloat(s.substring(3, 8));
  const hemi = s.charAt(8);
  const lon = deg + min / 60;
  return hemi === 'W' ? -lon : lon;
}

// Parse resource tokens from APRS comment field (EmComm bracket notation)
// e.g. "[Beds 12/20] [Water OK]" → tokens array + clean comment
function parseResourceTokens(comment) {
  if (!comment) return { tokens: [], cleanComment: '' };
  const tokens = [];
  const regex = /\[([A-Za-z]+)\s+([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(comment)) !== null) {
    const key = match[1];
    const val = match[2].trim();
    const capacityMatch = val.match(/^(\d+)\/(\d+)$/);
    if (capacityMatch) {
      tokens.push({ key, current: parseInt(capacityMatch[1]), max: parseInt(capacityMatch[2]), type: 'capacity' });
    } else if (val === '!') {
      tokens.push({ key, value: '!', type: 'critical' });
    } else if (val.toUpperCase() === 'OK') {
      tokens.push({ key, value: 'OK', type: 'status' });
    } else if (/^-\d+$/.test(val)) {
      tokens.push({ key, value: parseInt(val), type: 'need' });
    } else if (/^\d+$/.test(val)) {
      tokens.push({ key, value: parseInt(val), type: 'quantity' });
    } else {
      tokens.push({ key, value: val, type: 'text' });
    }
  }
  const cleanComment = comment.replace(regex, '').trim();
  return { tokens, cleanComment };
}

/**
 * Parse a raw APRS packet line into a position station object.
 * @param {string} line  Raw APRS line: "CALLSIGN>PATH:payload"
 * @returns {{ call, ssid, lat, lon, symbol, comment, tokens, cleanComment,
 *             speed, course, altitude, raw } | null}
 */
function parseAprsPacket(line) {
  try {
    const headerEnd = line.indexOf(':');
    if (headerEnd < 0) return null;

    const header = line.substring(0, headerEnd);
    const payload = line.substring(headerEnd + 1);
    const callsign = header.split('>')[0].split('-')[0].trim();
    const ssid = header.split('>')[0].trim();

    if (!callsign || callsign.length < 3) return null;

    const dataType = payload.charAt(0);
    let lat, lon, symbolTable, symbolCode, comment, rest;

    if (dataType === '!' || dataType === '=') {
      // Position without timestamp: !DDMM.MMN/DDDMM.MMW$...
      lat = parseAprsLat(payload.substring(1, 9));
      symbolTable = payload.charAt(9);
      lon = parseAprsLon(payload.substring(10, 19));
      symbolCode = payload.charAt(19);
      comment = payload.substring(20).trim();
    } else if (dataType === '/' || dataType === '@') {
      // Position with timestamp: /HHMMSSh DDMM.MMN/DDDMM.MMW$...
      lat = parseAprsLat(payload.substring(8, 16));
      symbolTable = payload.charAt(16);
      lon = parseAprsLon(payload.substring(17, 26));
      symbolCode = payload.charAt(26);
      comment = payload.substring(27).trim();
    } else if (dataType === ';') {
      // Object: ;NAME_____*HHMMSSh DDMM.MMN/DDDMM.MMW$...
      const objPayload = payload.substring(11);
      const ts = objPayload.charAt(0) === '*' ? 8 : 0;
      rest = objPayload.substring(ts);
      if (rest.length >= 19) {
        lat = parseAprsLat(rest.substring(0, 8));
        symbolTable = rest.charAt(8);
        lon = parseAprsLon(rest.substring(9, 18));
        symbolCode = rest.charAt(18);
        comment = rest.substring(19).trim();
      }
    } else {
      return null; // Not a position packet we handle
    }

    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    let speed = null,
      course = null,
      altitude = null;
    const csMatch = comment?.match(/^(\d{3})\/(\d{3})/);
    if (csMatch) {
      course = parseInt(csMatch[1]);
      speed = parseInt(csMatch[2]); // knots
    }
    const altMatch = comment?.match(/\/A=(\d{6})/);
    if (altMatch) {
      altitude = parseInt(altMatch[1]); // feet
    }

    const { tokens, cleanComment } = parseResourceTokens(comment);

    return {
      call: callsign,
      ssid,
      lat,
      lon,
      symbol: `${symbolTable}${symbolCode}`,
      comment: comment || '',
      tokens,
      cleanComment,
      speed,
      course,
      altitude,
      raw: line,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { parseAprsPacket };
