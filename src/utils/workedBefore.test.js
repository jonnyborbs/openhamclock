import { describe, expect, it } from 'vitest';

import { bandFromFreq, buildWorkedIndex, lookupWorked, normalizeMode } from './workedBefore.js';

describe('normalizeMode', () => {
  it('collapses phone submodes to SSB', () => {
    expect(normalizeMode('USB')).toBe('SSB');
    expect(normalizeMode('lsb')).toBe('SSB');
    expect(normalizeMode('PH')).toBe('SSB');
    expect(normalizeMode('SSB')).toBe('SSB');
  });

  it('collapses PSK submodes and passes other modes through uppercased', () => {
    expect(normalizeMode('PSK31')).toBe('PSK');
    expect(normalizeMode('psk63')).toBe('PSK');
    expect(normalizeMode('cw')).toBe('CW');
    expect(normalizeMode('FT8')).toBe('FT8');
  });

  it('returns null for empty/missing modes', () => {
    expect(normalizeMode(null)).toBe(null);
    expect(normalizeMode('')).toBe(null);
    expect(normalizeMode('   ')).toBe(null);
  });
});

describe('bandFromFreq', () => {
  it('accepts MHz, kHz, and N1MM band-in-MHz values', () => {
    expect(bandFromFreq(14.074)).toBe('20m'); // MHz (contest freqMHz)
    expect(bandFromFreq(14230)).toBe('20m'); // kHz (N3FJP freq_khz)
    expect(bandFromFreq(14)).toBe('20m'); // N1MM bandMHz tag
    expect(bandFromFreq(7)).toBe('40m');
  });

  it('returns null for unknown or missing frequencies', () => {
    expect(bandFromFreq(null)).toBe(null);
    expect(bandFromFreq('')).toBe(null);
    expect(bandFromFreq(0)).toBe(null);
    expect(bandFromFreq(999999999)).toBe(null); // out of any band
  });
});

describe('buildWorkedIndex', () => {
  it('indexes N3FJP QSOs (freq_khz) and contest QSOs (freqMHz) under base calls', () => {
    const index = buildWorkedIndex({
      n3fjpQsos: [{ dx_call: 'OZ6ABL', freq_khz: 14230, mode: 'USB', status: 'log' }],
      contestQsos: [{ dxCall: 'W1AW', freqMHz: 7.03, mode: 'CW' }],
    });

    expect(index.size).toBe(2);
    expect(index.get('OZ6ABL').bands.has('20m')).toBe(true);
    expect(index.get('OZ6ABL').combos.has('20m|SSB')).toBe(true);
    expect(index.get('W1AW').combos.has('40m|CW')).toBe(true);
  });

  it('skips N3FJP preview rows — they are not logged contacts', () => {
    const index = buildWorkedIndex({
      n3fjpQsos: [{ dx_call: 'K1ABC', freq_khz: 14074, mode: 'FT8', status: 'preview' }],
    });
    expect(index.size).toBe(0);
  });

  it('strips portable prefixes/suffixes so 5Z4/OZ6ABL and OZ6ABL share one entry', () => {
    const index = buildWorkedIndex({
      n3fjpQsos: [{ dx_call: '5Z4/OZ6ABL', freq_khz: 21050, mode: 'CW', status: 'log' }],
      contestQsos: [{ dxCall: 'OZ6ABL', freqMHz: 14.2, mode: 'USB' }],
    });
    expect(index.size).toBe(1);
    const entry = index.get('OZ6ABL');
    expect(entry.combos.has('15m|CW')).toBe(true);
    expect(entry.combos.has('20m|SSB')).toBe(true);
  });

  it('falls back to the N1MM bandMHz tag when freqMHz is missing', () => {
    const index = buildWorkedIndex({
      contestQsos: [{ dxCall: 'DL1ABC', bandMHz: 14, mode: 'CW' }],
    });
    expect(index.get('DL1ABC').combos.has('20m|CW')).toBe(true);
  });

  it('tolerates missing/empty/garbage sources', () => {
    expect(buildWorkedIndex().size).toBe(0);
    expect(buildWorkedIndex({}).size).toBe(0);
    expect(buildWorkedIndex({ n3fjpQsos: null, contestQsos: undefined }).size).toBe(0);
    expect(buildWorkedIndex({ n3fjpQsos: [null, {}, { mode: 'CW' }], contestQsos: [null] }).size).toBe(0);
  });

  it('still indexes a call when the frequency is unusable (call-level worked)', () => {
    const index = buildWorkedIndex({
      contestQsos: [{ dxCall: 'JA1XYZ', mode: 'CW' }],
    });
    const entry = index.get('JA1XYZ');
    expect(entry).toBeDefined();
    expect(entry.bands.size).toBe(0);
  });

  it('indexes native logbook QSOs (freq in MHz) as a third source', () => {
    const index = buildWorkedIndex({
      logbookQsos: [{ call: 'OZ1ABC', freq: 14.25, mode: 'SSB', band: '20m' }],
    });
    expect(index.get('OZ1ABC').combos.has('20m|SSB')).toBe(true);
    expect(lookupWorked(index, 'OZ1ABC', 14.2, 'SSB')).toBe('dupe');
  });

  it('falls back to the ADIF band tag when a logbook QSO has no freq', () => {
    const index = buildWorkedIndex({
      logbookQsos: [
        { call: 'W1AW', band: '40M', mode: 'CW' }, // imported ADIF, uppercase band, no freq
        { call: 'K1ABC', mode: 'FT8' }, // neither freq nor band — call-level only
      ],
    });
    expect(index.get('W1AW').combos.has('40m|CW')).toBe(true);
    expect(lookupWorked(index, 'W1AW', 7.03, 'CW')).toBe('dupe');
    expect(index.get('K1ABC').bands.size).toBe(0);
    expect(lookupWorked(index, 'K1ABC', 14.074, 'FT8')).toBe('worked');
  });

  it('merges the logbook with the live feeds under one base call', () => {
    const index = buildWorkedIndex({
      n3fjpQsos: [{ dx_call: 'OZ6ABL', freq_khz: 14230, mode: 'USB', status: 'log' }],
      logbookQsos: [{ call: 'OZ6ABL/P', freq: 7.09, mode: 'SSB' }],
    });
    expect(index.size).toBe(1);
    const entry = index.get('OZ6ABL');
    expect(entry.combos.has('20m|SSB')).toBe(true);
    expect(entry.combos.has('40m|SSB')).toBe(true);
  });

  it('ignores garbage logbook rows', () => {
    const index = buildWorkedIndex({ logbookQsos: [null, {}, { freq: 14.2 }] });
    expect(index.size).toBe(0);
  });
});

describe('lookupWorked', () => {
  const index = buildWorkedIndex({
    n3fjpQsos: [{ dx_call: 'OZ6ABL', freq_khz: 14230, mode: 'USB', status: 'log' }],
    contestQsos: [{ dxCall: 'W1AW', freqMHz: 7.03, mode: 'CW' }],
  });

  it('returns dupe for the same call on the same band+mode', () => {
    // Spot freq in MHz, cluster-inferred mode SSB matches the logged USB QSO
    expect(lookupWorked(index, 'OZ6ABL', 14.25, 'SSB')).toBe('dupe');
    expect(lookupWorked(index, 'W1AW', 7.028, 'CW')).toBe('dupe');
  });

  it('returns worked for the same call on a different band or mode', () => {
    expect(lookupWorked(index, 'OZ6ABL', 7.15, 'SSB')).toBe('worked'); // other band
    expect(lookupWorked(index, 'OZ6ABL', 14.05, 'CW')).toBe('worked'); // other mode
  });

  it('returns worked when the spot has no frequency (call-level match)', () => {
    expect(lookupWorked(index, 'OZ6ABL')).toBe('worked');
  });

  it('falls back to band-only dupe detection when the spot mode is unknown', () => {
    expect(lookupWorked(index, 'OZ6ABL', 14.2, null)).toBe('dupe');
    expect(lookupWorked(index, 'OZ6ABL', 21.2, null)).toBe('worked');
  });

  it('matches decorated spot calls against the base call in the log', () => {
    expect(lookupWorked(index, 'OZ6ABL/P', 14.25, 'SSB')).toBe('dupe');
    expect(lookupWorked(index, '5Z4/OZ6ABL', 7.15, 'SSB')).toBe('worked');
  });

  it('returns null for calls not in the log and for empty indexes', () => {
    expect(lookupWorked(index, 'VK3XYZ', 14.2, 'SSB')).toBe(null);
    expect(lookupWorked(new Map(), 'OZ6ABL', 14.2, 'SSB')).toBe(null);
    expect(lookupWorked(null, 'OZ6ABL', 14.2, 'SSB')).toBe(null);
    expect(lookupWorked(index, '', 14.2, 'SSB')).toBe(null);
  });
});
