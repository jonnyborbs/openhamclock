'use strict';
/**
 * aprs-symbols.js — APRS symbol sprite sheet utilities
 *
 * APRS symbols are identified by a two-character string:
 *   char 0: symbol table  '/' = primary, '\' = alternate, else overlay char (A-Z, 0-9)
 *   char 1: symbol code   ASCII 33 ('!') … 126 ('~') — 96 possible symbols
 *
 * Sprite sheet layout (hessu/aprs-symbols, 24 px variant):
 *   384 × 144 px  →  16 columns × 6 rows, each cell 24 × 24 px
 *   Cell index = symbolCode.charCodeAt(0) - 33
 *   X offset = (index % 16) * 24
 *   Y offset = Math.floor(index / 16) * 24
 *
 * Files (served from /public/):
 *   aprs-symbols-24-0.png  primary  table  ('/')
 *   aprs-symbols-24-1.png  alternate table ('\')
 *   aprs-symbols-24-2.png  overlay  table  (alphanumeric overlay char)
 */

const SPRITE_SIZE = 24; // px per cell in source sprite
const COLS = 16; // cells per row in sprite sheet

/**
 * Return the CSS background-position string for a symbol code character.
 * @param {string} code  Single character, ASCII 33–126
 * @param {number} displaySize  Rendered size in pixels (for background-size scaling)
 */
function spritePosition(code, displaySize) {
  const idx = code.charCodeAt(0) - 33;
  if (idx < 0 || idx > 95) return '0px 0px';
  const col = idx % COLS;
  const row = Math.floor(idx / COLS);
  const scale = displaySize / SPRITE_SIZE;
  return `-${col * displaySize}px -${row * displaySize}px`;
}

/**
 * Build a Leaflet divIcon descriptor for an APRS station.
 *
 * @param {string} symbol       Two-char APRS symbol (e.g. '/-', '/>', '\j')
 * @param {object} [opts]
 * @param {number} [opts.size=16]         Rendered icon size in px
 * @param {string} [opts.borderColor]     Optional ring color (CSS)
 * @param {boolean} [opts.watched=false]  Extra highlight for watched stations
 * @returns {{ html: string, iconSize: [number,number], iconAnchor: [number,number] }}
 *          Pass directly as options to L.divIcon().
 *          Returns null to signal "use fallback triangle".
 */
export function getAprsSymbolIcon(symbol, { size = 16, borderColor = null } = {}) {
  if (!symbol || symbol.length < 2) return null;

  const tableChar = symbol.charAt(0);
  const codeChar = symbol.charAt(1);
  const codeIdx = codeChar.charCodeAt(0) - 33;
  if (codeIdx < 0 || codeIdx > 95) return null;

  // Choose sprite sheet
  let sheetUrl;
  let overlayChar = null;
  if (tableChar === '/') {
    sheetUrl = '/aprs-symbols-24-0.png';
  } else if (tableChar === '\\') {
    sheetUrl = '/aprs-symbols-24-1.png';
  } else if (/^[A-Z0-9]$/.test(tableChar)) {
    // Overlay symbol: use alternate base sheet, stamp the overlay char on top
    sheetUrl = '/aprs-symbols-24-2.png';
    overlayChar = tableChar;
  } else {
    return null;
  }

  const bgPos = spritePosition(codeChar, size);
  const sheetPx = COLS * size + 'px ' + 6 * size + 'px';

  const border = borderColor ? `box-shadow: 0 0 0 2px ${borderColor};` : '';

  const overlayHtml = overlayChar
    ? `<span style="
        position:absolute;top:0;left:0;width:100%;height:100%;
        display:flex;align-items:center;justify-content:center;
        font-size:${Math.round(size * 0.55)}px;font-weight:700;
        color:#fff;text-shadow:0 0 2px #000;
        pointer-events:none;line-height:1;
      ">${overlayChar}</span>`
    : '';

  const html = `<div style="
    position:relative;
    width:${size}px;height:${size}px;
    background-image:url(${sheetUrl});
    background-size:${sheetPx};
    background-position:${bgPos};
    background-repeat:no-repeat;
    border-radius:2px;
    ${border}
    filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));
    image-rendering:pixelated;
  ">${overlayHtml}</div>`;

  return {
    html,
    iconSize: [size, size],
    iconAnchor: [Math.round(size / 2), Math.round(size / 2)],
  };
}
