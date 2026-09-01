import { describe, it, expect } from 'vitest';
import { aprsShelterStatus, aprsReportToShelter, mergeShelters } from './emcommShelters.js';

const fema = [
  { id: 1, name: 'Central High School', lat: 40.0, lon: -105.0, status: 'OPEN' },
  { id: 2, name: 'Fairgrounds', lat: 41.5, lon: -104.2, status: 'FULL' },
];

describe('aprsShelterStatus', () => {
  it('detects status keywords', () => {
    expect(aprsShelterStatus('Shelter open, accepting evacuees')).toBe('OPEN');
    expect(aprsShelterStatus('Shelter CLOSED due to flooding')).toBe('CLOSED');
    expect(aprsShelterStatus('Shelter full, no more beds')).toBe('FULL');
    expect(aprsShelterStatus('Evacuees arriving')).toBe(null);
    expect(aprsShelterStatus('')).toBe(null);
  });

  it('prefers CLOSED over OPEN when both appear', () => {
    expect(aprsShelterStatus('Shelter was open, now closed')).toBe('CLOSED');
  });
});

describe('aprsReportToShelter', () => {
  it('normalizes a report with capacity token', () => {
    const s = aprsReportToShelter({
      from: 'W1AW-5',
      text: 'Shelter open',
      tokens: [{ key: 'Beds', current: 40, max: 100, type: 'capacity' }],
      lat: 39.9,
      lon: -104.9,
      source: 'rf',
      timestamp: 123,
    });
    expect(s).toMatchObject({
      id: 'aprs-W1AW-5',
      name: 'W1AW-5',
      status: 'OPEN',
      currentPopulation: 40,
      evacuationCapacity: 100,
      source: 'aprs-rf',
    });
  });

  it('tags internet-sourced reports as aprs', () => {
    const s = aprsReportToShelter({ from: 'K0CJH', text: 'shelter', source: 'aprs-is' });
    expect(s.source).toBe('aprs');
    expect(s.lat).toBe(null);
  });
});

describe('mergeShelters', () => {
  it('appends APRS reports alongside FEMA shelters with source tags', () => {
    const merged = mergeShelters(fema, [
      { from: 'W1AW-5', text: 'shelter open', lat: 39.0, lon: -103.0, source: 'rf', timestamp: 1 },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0].source).toBe('fema');
    expect(merged[2]).toMatchObject({ id: 'aprs-W1AW-5', source: 'aprs-rf' });
  });

  it('keeps only the latest report per station', () => {
    const merged = mergeShelters(
      [],
      [
        { from: 'W1AW-5', text: 'shelter open', timestamp: 1, source: 'rf' },
        { from: 'W1AW-5', text: 'shelter closed', timestamp: 2, source: 'rf' },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('CLOSED');
  });

  it('dedupes only trivially identical positions, attaching the RF report', () => {
    const merged = mergeShelters(fema, [
      { from: 'W1AW-5', text: 'shelter open', lat: 40.0005, lon: -105.0005, source: 'rf', timestamp: 1 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].aprsReport).toMatchObject({ from: 'W1AW-5' });
  });

  it('does not dedupe nearby-but-distinct positions', () => {
    const merged = mergeShelters(fema, [
      { from: 'W1AW-5', text: 'shelter open', lat: 40.01, lon: -105.01, source: 'rf', timestamp: 1 },
    ]);
    expect(merged).toHaveLength(3);
  });

  it('keeps position-less reports as list-only entries', () => {
    const merged = mergeShelters(fema, [{ from: 'K0CJH', text: 'shelter open', timestamp: 1, source: 'rf' }]);
    expect(merged).toHaveLength(3);
    expect(merged[2].lat).toBe(null);
  });

  it('handles empty inputs', () => {
    expect(mergeShelters([], [])).toEqual([]);
    expect(mergeShelters(null, null)).toEqual([]);
  });
});
