/**
 * Band derivation and classic cluster line formatting.
 */

// Amateur bands by frequency in kHz: [name, low, high]
const BANDS = [
  ['2200m', 135.7, 137.8],
  ['630m', 472, 479],
  ['160m', 1800, 2000],
  ['80m', 3500, 4000],
  ['60m', 5250, 5450],
  ['40m', 7000, 7300],
  ['30m', 10100, 10150],
  ['20m', 14000, 14350],
  ['17m', 18068, 18168],
  ['15m', 21000, 21450],
  ['12m', 24890, 24990],
  ['10m', 28000, 29700],
  ['6m', 50000, 54000],
  ['4m', 70000, 71000],
  ['2m', 144000, 148000],
  ['1.25m', 222000, 225000],
  ['70cm', 420000, 450000],
  ['23cm', 1240000, 1300000],
];

function bandForKhz(freqKhz) {
  if (!Number.isFinite(freqKhz)) return null;
  for (const [name, low, high] of BANDS) {
    if (freqKhz >= low && freqKhz <= high) return name;
  }
  return null;
}

function toHHMMz(ts) {
  const d = new Date(Number.isFinite(ts) ? ts : Date.now());
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}z`;
}

// Classic cluster stream line, column-aligned the way DXSpider emits it:
// DX de KM3T-#:    14025.1  W1AW         CW 23 dB 22 WPM CQ             1234Z
function formatSpotLine(spot) {
  const spotter = `${spot.spotter}:`.padEnd(10);
  const freq = String(parseFloat(spot.freqKhz).toFixed(1)).padStart(8);
  const call = String(spot.call).padEnd(13);
  const comment = String(spot.comment || '')
    .slice(0, 30)
    .padEnd(31);
  const d = new Date(Number.isFinite(spot.timestamp) ? spot.timestamp : Date.now());
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
  return `DX de ${spotter}${freq}  ${call}${comment}${hhmm}`;
}

module.exports = { bandForKhz, toHHMMz, formatSpotLine, BANDS };
