/**
 * Tests for the Winlink Express CSV parser (rig-bridge/lib/winlink-csv-parser).
 * The parser is a pure CommonJS module shared by the winlink-express-csv
 * rig-bridge plugin; header-variant tolerance is the core requirement since
 * Winlink Express form exports differ per template and version.
 */
import { describe, it, expect } from 'vitest';
import parser from './winlink-csv-parser.js';

const { parseCsvText, parseWinlinkCsv, parseCoord, parseTimestamp, hashRow, mapHeader } = parser;

describe('parseCsvText', () => {
  it('parses simple rows with CRLF and LF line endings', () => {
    expect(parseCsvText('a,b,c\r\n1,2,3\n4,5,6')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted fields with embedded commas, quotes, and newlines', () => {
    const rows = parseCsvText('a,"b,1","say ""hi"""\n"multi\nline",x,y');
    expect(rows).toEqual([
      ['a', 'b,1', 'say "hi"'],
      ['multi\nline', 'x', 'y'],
    ]);
  });

  it('skips blank lines and strips a BOM', () => {
    const rows = parseCsvText('\uFEFFh1,h2\n\n\nv1,v2\n');
    expect(rows).toEqual([
      ['h1', 'h2'],
      ['v1', 'v2'],
    ]);
  });
});

describe('parseCoord', () => {
  it('parses plain decimal degrees', () => {
    expect(parseCoord('35.1234')).toBeCloseTo(35.1234);
    expect(parseCoord('-80.5')).toBeCloseTo(-80.5);
    expect(parseCoord(' 0 ')).toBe(0);
  });

  it('applies hemisphere suffixes and prefixes', () => {
    expect(parseCoord('35.1234N')).toBeCloseTo(35.1234);
    expect(parseCoord('35.1234 S')).toBeCloseTo(-35.1234);
    expect(parseCoord('80.5W')).toBeCloseTo(-80.5);
    expect(parseCoord('W 80.5')).toBeCloseTo(-80.5);
    expect(parseCoord('80.5 E')).toBeCloseTo(80.5);
  });

  it('parses degrees-decimal minutes forms', () => {
    expect(parseCoord('35-07.40N')).toBeCloseTo(35 + 7.4 / 60);
    expect(parseCoord('080-30.00W')).toBeCloseTo(-(80 + 30 / 60));
    expect(parseCoord('35 07.40 S')).toBeCloseTo(-(35 + 7.4 / 60));
  });

  it('returns null for garbage', () => {
    expect(parseCoord('')).toBeNull();
    expect(parseCoord(null)).toBeNull();
    expect(parseCoord('not-a-number')).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('parses ISO and Winlink slash-date formats', () => {
    expect(parseTimestamp('2026-08-27T14:32:00Z')).toBe(Date.parse('2026-08-27T14:32:00Z'));
    expect(parseTimestamp('2026/08/27 14:32')).toBe(Date.parse('2026-08-27 14:32'));
  });

  it('returns null for empty/garbage values', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('yesterday-ish')).toBeNull();
  });
});

describe('mapHeader', () => {
  it('maps normalized header aliases and lists unknown columns', () => {
    const { mapping, unknown } = mapHeader(['From', 'Template', 'GPS Latitude', 'GPS_Longitude', 'Shift Lead']);
    expect(mapping.callsign).toBe(0);
    expect(mapping.formType).toBe(1);
    expect(mapping.lat).toBe(2);
    expect(mapping.lon).toBe(3);
    expect(unknown).toEqual([{ index: 4, name: 'Shift Lead' }]);
  });
});

describe('parseWinlinkCsv', () => {
  const STANDARD = [
    'Callsign,Form Type,Latitude,Longitude,Date/Time,Comments',
    'KD0AAA,Field Situation Report,39.0997,-94.5786,2026/08/27 14:32,"Power out, shelter at capacity"',
    'W0BBB,Damage Assessment,38.9500N,94.6000W,2026-08-27T15:00:00Z,Roof damage on Main St',
  ].join('\r\n');

  it('parses a standard export with canonical fields', () => {
    const { reports, skipped } = parseWinlinkCsv(STANDARD);
    expect(skipped).toBe(0);
    expect(reports).toHaveLength(2);

    const [r1, r2] = reports;
    expect(r1.callsign).toBe('KD0AAA');
    expect(r1.formType).toBe('Field Situation Report');
    expect(r1.lat).toBeCloseTo(39.0997);
    expect(r1.lon).toBeCloseTo(-94.5786);
    expect(r1.text).toBe('Power out, shelter at capacity');
    expect(r1.timestamp).toBe(Date.parse('2026-08-27 14:32'));
    expect(r1.id).toMatch(/^[0-9a-f]{40}$/);

    expect(r2.lat).toBeCloseTo(38.95);
    expect(r2.lon).toBeCloseTo(-94.6);
  });

  it('handles header variants (From/Template/GPS columns)', () => {
    const csv = [
      'From,Template,GPS Latitude,GPS Longitude,Time Received,Remarks',
      'n0ccc,ICS-213,35-07.40N,080-30.00W,2026/08/27 16:05,Requesting water resupply',
    ].join('\n');
    const { reports } = parseWinlinkCsv(csv);
    expect(reports).toHaveLength(1);
    expect(reports[0].callsign).toBe('N0CCC'); // upper-cased
    expect(reports[0].formType).toBe('ICS-213');
    expect(reports[0].lat).toBeCloseTo(35 + 7.4 / 60);
    expect(reports[0].lon).toBeCloseTo(-(80 + 30 / 60));
    expect(reports[0].text).toBe('Requesting water resupply');
  });

  it('preserves unknown columns in extra', () => {
    const csv = [
      'Callsign,Form,Lat,Lon,Shelter Name,Beds Available',
      'K0CJH,Shelter Report,39.1,-94.6,Union Station,42',
    ].join('\n');
    const { reports } = parseWinlinkCsv(csv);
    expect(reports[0].extra).toEqual({ 'Shelter Name': 'Union Station', 'Beds Available': '42' });
  });

  it('tolerates missing/invalid coordinates and timestamps', () => {
    const csv = ['Callsign,Form,Latitude,Longitude,Date', 'K1DDD,FSR,,,not-a-date', 'K2EEE,FSR,999,-200,'].join('\n');
    const { reports } = parseWinlinkCsv(csv);
    expect(reports).toHaveLength(2);
    expect(reports[0].lat).toBeNull();
    expect(reports[0].lon).toBeNull();
    expect(reports[0].timestamp).toBeNull();
    // Out-of-range coords are nulled, row still kept
    expect(reports[1].lat).toBeNull();
    expect(reports[1].lon).toBeNull();
  });

  it('skips rows with no callsign, form type, or text, and repeated header lines', () => {
    const csv = [
      'Callsign,Form,Comments,Ops Period',
      'K0CJH,FSR,ok,Day 1',
      ',,,', // fully blank — silently ignored
      ',,,Day 2', // content but no callsign/form/text — counted as skipped
      'Callsign,Form,Comments,Ops Period', // header re-emitted mid-file
      'W1AW,DA,damage,Day 2',
    ].join('\n');
    const { reports, skipped } = parseWinlinkCsv(csv);
    expect(reports.map((r) => r.callsign)).toEqual(['K0CJH', 'W1AW']);
    expect(skipped).toBe(1);
  });

  it('produces stable row hashes for dedupe across polls', () => {
    const a = parseWinlinkCsv(STANDARD).reports;
    const b = parseWinlinkCsv(STANDARD + '\r\nN9FFF,FSR,39.2,-94.7,2026/08/27 17:00,new row').reports;
    expect(b[0].id).toBe(a[0].id);
    expect(b[1].id).toBe(a[1].id);
    expect(b[2].id).not.toBe(a[0].id);
    expect(hashRow(['x'])).toBe(hashRow(['x']));
  });

  it('returns empty results for empty input', () => {
    expect(parseWinlinkCsv('')).toEqual({ reports: [], skipped: 0, headerFields: [] });
    expect(parseWinlinkCsv(null).reports).toEqual([]);
  });
});
