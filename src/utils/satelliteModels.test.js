import { describe, it, expect } from 'vitest';
import { classifySatellite } from './satelliteModels.js';

// Keys mirror the live satellite registry — if a new bird lands in the wrong
// bucket it still renders (cubesat default), this just keeps the buckets honest.
describe('classifySatellite', () => {
  it('gives the ISS its own model', () => {
    expect(classifySatellite('ISS')).toBe('iss');
    expect(classifySatellite('ISS (ZARYA)')).toBe('iss');
  });

  it('classifies geostationary birds', () => {
    for (const k of ['GOES-16', 'GOES-19', 'EWS-G2', 'ELEKTRO-L3', 'GK-2A', 'HIMAWARI-9', 'QO-100']) {
      expect(classifySatellite(k)).toBe('geo');
    }
  });

  it('classifies polar orbiters', () => {
    for (const k of ['METOP-B', 'METEOR-M2-3', 'NOAA-20', 'NOAA-21']) {
      expect(classifySatellite(k)).toBe('polar');
    }
  });

  it('defaults amateur birds and unknowns to cubesat', () => {
    for (const k of ['SO-50', 'AO-91', 'FO-29', 'TEVEL2-4', 'RS-44', 'SO-125', 'PO-101', 'QMR-KWT-2', '']) {
      expect(classifySatellite(k)).toBe('cubesat');
    }
    expect(classifySatellite(undefined)).toBe('cubesat');
  });
});
