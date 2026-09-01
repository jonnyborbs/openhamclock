/**
 * Unit tests for the CANParks upstream normalization helpers.
 * Pure-function coverage: field-name variants, kHz/MHz/Hz detection,
 * epoch/ISO timestamps, parks-directory enrichment join, garbage tolerance,
 * and park record slimming.
 */
import { describe, expect, it } from 'vitest';

const { normalizeSpot, slimPark, buildParkIndex, toMhz, toIsoTime } = require('./canparks.js');

// The shape observed live from api.canparks.ca/spots on 2026-08-28.
const LIVE_SPOT = {
  id: 'pota_55776992',
  activator_callsign: 'VE2OCH',
  spotter_callsign: 'VE2OCH',
  frequency_khz: 7074,
  band: '40m',
  mode: 'UNKNOWN',
  comment: 'POTA CA-0512 · qrp',
  source: 'pota',
  source_label: 'POTA.app',
  respot_of_id: null,
  is_self_spot: 0,
  created_at: '2026-08-28T13:14:10.000Z',
  expires_at: '2026-08-28T13:44:10.000Z',
  reference: 'QC-0071',
  park_name: 'Oka National Park',
  city: null,
  province_code: 'QC',
  direct_respot_count: 0,
};

const FAT_PARK = {
  id: 'QC-0071',
  reference: 'QC-0071',
  name: 'Oka National Park',
  city: 'Oka',
  province_code: 'QC',
  province: 'Quebec',
  grid: 'FN25xg',
  latitude: 45.4737,
  longitude: -74.0243,
  google_maps_url: 'https://www.google.com/maps/search/?api=1&query=45.47%2C-74.02',
  website_url: 'https://www.sepaq.com/pq/oka/',
  pota_reference: 'CA-0512',
  wwff_reference: 'VEFF-0512',
  status: 'active',
  pota_url: 'https://pota.app/#/park/CA-0512',
  wwff_url: 'https://spots.wwff.co/references/direct?wwff=VEFF-0512',
};

describe('toMhz', () => {
  it('detects unit by magnitude when no hint given', () => {
    expect(toMhz(7074)).toBeCloseTo(7.074); // kHz
    expect(toMhz(7.074)).toBeCloseTo(7.074); // already MHz
    expect(toMhz('14230')).toBeCloseTo(14.23); // kHz string
    expect(toMhz(145.5)).toBeCloseTo(145.5); // VHF MHz
    expect(toMhz(7074000)).toBeCloseTo(7.074); // Hz
  });

  it('honours explicit unit hints over magnitude', () => {
    expect(toMhz(472, 'khz')).toBeCloseTo(0.472); // 630m — magnitude alone would misread
    expect(toMhz(7074, 'khz')).toBeCloseTo(7.074);
    expect(toMhz(7.074, 'mhz')).toBeCloseTo(7.074);
    expect(toMhz(7074000, 'hz')).toBeCloseTo(7.074);
  });

  it('rejects garbage', () => {
    expect(toMhz(null)).toBeNull();
    expect(toMhz('')).toBeNull();
    expect(toMhz('QRP')).toBeNull();
    expect(toMhz(-7074)).toBeNull();
    expect(toMhz(0)).toBeNull();
  });
});

describe('toIsoTime', () => {
  it('passes through ISO strings with zone', () => {
    expect(toIsoTime('2026-08-28T13:14:10.000Z')).toBe('2026-08-28T13:14:10.000Z');
  });

  it('treats bare ISO strings as UTC (POTA-style quirk)', () => {
    expect(toIsoTime('2026-08-28T13:14:10')).toBe('2026-08-28T13:14:10.000Z');
    expect(toIsoTime('2026-08-28 13:14:10')).toBe('2026-08-28T13:14:10.000Z');
  });

  it('accepts epoch seconds and epoch milliseconds', () => {
    expect(toIsoTime(1787922850)).toBe('2026-08-28T13:14:10.000Z');
    expect(toIsoTime(1787922850000)).toBe('2026-08-28T13:14:10.000Z');
    expect(toIsoTime('1787922850')).toBe('2026-08-28T13:14:10.000Z');
  });

  it('rejects garbage', () => {
    expect(toIsoTime(null)).toBeNull();
    expect(toIsoTime('')).toBeNull();
    expect(toIsoTime('not a date')).toBeNull();
    expect(toIsoTime(-5)).toBeNull();
  });
});

describe('normalizeSpot', () => {
  it('normalizes the observed live feed shape', () => {
    const s = normalizeSpot(LIVE_SPOT);
    expect(s.call).toBe('VE2OCH');
    expect(s.spotter).toBe('VE2OCH');
    expect(s.freq).toBeCloseTo(7.074);
    expect(s.mode).toBe(''); // 'UNKNOWN' is blanked
    expect(s.ref).toBe('QC-0071');
    expect(s.name).toBe('Oka National Park');
    expect(s.comments).toBe('POTA CA-0512 · qrp');
    expect(s.time).toBe('2026-08-28T13:14:10.000Z');
  });

  it('preserves unknown extra fields from the raw record', () => {
    const s = normalizeSpot(LIVE_SPOT);
    expect(s.source_label).toBe('POTA.app');
    expect(s.direct_respot_count).toBe(0);
    expect(s.band).toBe('40m');
  });

  it('accepts common field-name variants', () => {
    const s = normalizeSpot({
      activator: 'VA3ABC',
      spotter: 'VE7XYZ',
      freq: '14.230',
      mode: 'SSB',
      park: 'ON-0001',
      remarks: 'calling CQ',
      spotTime: '2026-08-28T12:00:00Z',
    });
    expect(s.call).toBe('VA3ABC');
    expect(s.spotter).toBe('VE7XYZ');
    expect(s.freq).toBeCloseTo(14.23);
    expect(s.mode).toBe('SSB');
    expect(s.ref).toBe('ON-0001');
    expect(s.comments).toBe('calling CQ');
    expect(s.time).toBe('2026-08-28T12:00:00.000Z');

    const s2 = normalizeSpot({ callsign: 'VE1AA', frequency: 7074, ref: 'NS-0002', timestamp: 1787922850 });
    expect(s2.call).toBe('VE1AA');
    expect(s2.freq).toBeCloseTo(7.074);
    expect(s2.ref).toBe('NS-0002');
    expect(s2.time).toBe('2026-08-28T13:14:10.000Z');
  });

  it('enriches lat/lon/grid/name/cross-refs from the parks index', () => {
    const index = buildParkIndex([slimPark(FAT_PARK)]);
    const s = normalizeSpot(LIVE_SPOT, index);
    expect(s.lat).toBeCloseTo(45.4737);
    expect(s.lon).toBeCloseTo(-74.0243);
    expect(s.grid).toBe('FN25xg');
    expect(s.potaRef).toBe('CA-0512');
    expect(s.wwffRef).toBe('VEFF-0512');
  });

  it('joins the parks index case-insensitively', () => {
    const index = buildParkIndex([slimPark(FAT_PARK)]);
    const s = normalizeSpot({ ...LIVE_SPOT, reference: 'qc-0071' }, index);
    expect(s.lat).toBeCloseTo(45.4737);
  });

  it('spot-provided coordinates win over the directory', () => {
    const index = buildParkIndex([slimPark(FAT_PARK)]);
    const s = normalizeSpot({ ...LIVE_SPOT, latitude: 50.0, longitude: -100.0 }, index);
    expect(s.lat).toBe(50.0);
    expect(s.lon).toBe(-100.0);
  });

  it('computes a grid from coordinates when neither spot nor park has one', () => {
    const s = normalizeSpot({ call: 'VE2AA', latitude: 45.4737, longitude: -74.0243 });
    expect(s.grid).toMatch(/^FN25/);
  });

  it('survives spots for parks missing from the directory', () => {
    const index = buildParkIndex([slimPark(FAT_PARK)]);
    const s = normalizeSpot({ ...LIVE_SPOT, reference: 'YT-9999' }, index);
    expect(s.call).toBe('VE2OCH');
    expect(s.lat).toBeNull();
    expect(s.lon).toBeNull();
  });

  it('returns null for garbage and unrecognizable records', () => {
    expect(normalizeSpot(null)).toBeNull();
    expect(normalizeSpot(undefined)).toBeNull();
    expect(normalizeSpot('oops')).toBeNull();
    expect(normalizeSpot(42)).toBeNull();
    expect(normalizeSpot([])).toBeNull();
    expect(normalizeSpot({})).toBeNull();
    expect(normalizeSpot({ frequency: 7074 })).toBeNull(); // no callsign under any name
  });

  it('tolerates junk field values without throwing', () => {
    const s = normalizeSpot({
      call: 'VE0JUNK',
      frequency: 'loud',
      mode: 42,
      reference: null,
      comment: { nested: true },
      created_at: 'yesterday-ish',
      latitude: 'north',
    });
    expect(s.call).toBe('VE0JUNK');
    expect(s.freq).toBeNull();
    expect(s.mode).toBe('');
    expect(s.ref).toBe('');
    expect(s.comments).toBe('');
    expect(s.time).toBeNull();
    expect(s.lat).toBeNull();
  });
});

describe('slimPark', () => {
  it('keeps only the client-relevant fields', () => {
    const slim = slimPark(FAT_PARK);
    expect(slim).toEqual({
      reference: 'QC-0071',
      name: 'Oka National Park',
      grid: 'FN25xg',
      latitude: 45.4737,
      longitude: -74.0243,
      province_code: 'QC',
      status: 'active',
      pota_reference: 'CA-0512',
      wwff_reference: 'VEFF-0512',
    });
    expect(slim).not.toHaveProperty('google_maps_url');
    expect(slim).not.toHaveProperty('website_url');
    expect(slim).not.toHaveProperty('city');
    expect(slim).not.toHaveProperty('pota_url');
  });

  it('coerces numeric strings and rejects reference-less records', () => {
    expect(slimPark({ reference: 'AB-0001', latitude: '51.72', longitude: '-111.93' }).latitude).toBeCloseTo(51.72);
    expect(slimPark({ name: 'No Ref Park' })).toBeNull();
    expect(slimPark(null)).toBeNull();
    expect(slimPark('junk')).toBeNull();
  });
});

describe('buildParkIndex', () => {
  it('indexes by uppercased reference and ignores junk entries', () => {
    const index = buildParkIndex([slimPark(FAT_PARK), null, {}, { reference: 'ab-0001', name: 'Antelope' }]);
    expect(index['QC-0071'].name).toBe('Oka National Park');
    expect(index['AB-0001'].name).toBe('Antelope');
    expect(Object.keys(index)).toHaveLength(2);
  });

  it('returns an empty index for non-arrays', () => {
    expect(Object.keys(buildParkIndex(null))).toHaveLength(0);
    expect(Object.keys(buildParkIndex('nope'))).toHaveLength(0);
  });
});
