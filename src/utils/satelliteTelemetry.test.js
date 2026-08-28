import { describe, it, expect } from 'vitest';
import { deriveSatelliteTelemetry, nextPassTiming, formatSecsFromNow } from './satelliteTelemetry.js';

// Both satellite windows — the Leaflet one and the 3D panel — render from this
// module. These tests pin the formatting so the two cannot drift apart again:
// a change here that is not intended for both windows will fail loudly.

const METRIC = { dist: 'metric' };
const IMPERIAL = { dist: 'imperial' };

// altitude and speed go through toLocaleString, whose thousands separator
// follows the runtime locale — a Dutch machine renders 15.933 where a US one
// renders 15,933. Build the expectation the same way so these assertions pin
// the conversion and the unit without pinning the separator.
const localised = (n, unit) => `${n.toLocaleString()} ${unit}`;

const NOW = new Date('2026-08-19T12:00:00Z');
const inSecs = (s) => new Date(NOW.getTime() + s * 1000).toISOString();

const baseSat = {
  name: 'AO-7',
  lat: -76.3456,
  lon: 113.9412,
  alt: 1479.6,
  speedKmH: 25642.4,
  azimuth: 158,
  elevation: -70,
  range: 8123.45,
  rangeRate: -3.2149,
  dopplerFactor: 0.99998712,
  isVisible: false,
  mode: 'Linear',
  downlink: '29.400 - 29.500 MHz',
};

describe('formatSecsFromNow', () => {
  it('pads to hh:mm:ss across each magnitude', () => {
    expect(formatSecsFromNow(5)).toBe('00:00:05');
    expect(formatSecsFromNow(61)).toBe('00:01:01');
    expect(formatSecsFromNow(3601)).toBe('01:00:01');
    expect(formatSecsFromNow(45296)).toBe('12:34:56');
  });

  it('returns empty for non-finite input rather than NaN text', () => {
    expect(formatSecsFromNow(null)).toBe('');
    expect(formatSecsFromNow(undefined)).toBe('');
    expect(formatSecsFromNow(Number.NaN)).toBe('');
  });
});

describe('nextPassTiming', () => {
  it('picks the first pass that has not finished yet, not merely the first listed', () => {
    const sat = {
      // A pass already over, then the one that matters.
      nextPassStartTimes: [inSecs(-3600), inSecs(600)],
      nextPassEndTimes: [inSecs(-3000), inSecs(1200)],
    };
    expect(nextPassTiming(sat, NOW)).toEqual({ startsIn: 600, endsIn: 1200 });
  });

  it('reports a pass in progress with a negative start', () => {
    const sat = { nextPassStartTimes: [inSecs(-120)], nextPassEndTimes: [inSecs(300)] };
    const { startsIn, endsIn } = nextPassTiming(sat, NOW);
    expect(startsIn).toBe(-120);
    expect(endsIn).toBe(300);
  });

  it('returns nulls when there is nothing scheduled', () => {
    expect(nextPassTiming({}, NOW)).toEqual({ startsIn: null, endsIn: null });
    expect(nextPassTiming({ nextPassStartTimes: 'nonsense' }, NOW)).toEqual({ startsIn: null, endsIn: null });
  });
});

describe('deriveSatelliteTelemetry', () => {
  it('formats metric values with their units', () => {
    const d = deriveSatelliteTelemetry(baseSat, METRIC, NOW);
    expect(d.altitude).toBe(localised(1480, 'km'));
    expect(d.speed).toBe(localised(25642, 'km/h'));
    expect(d.range).toBe('8123 km');
    expect(d.rangeRate).toBe('-3.21 km/s');
    expect(d.lat).toBe('-76.35');
    expect(d.lon).toBe('113.94');
    expect(d.azEl).toBe('158° / -70°');
    expect(d.dopplerFactor).toBe('0.9999871');
  });

  it('converts to imperial rather than relabelling', () => {
    const d = deriveSatelliteTelemetry(baseSat, IMPERIAL, NOW);
    expect(d.altitude).toBe(localised(919, 'miles'));
    expect(d.speed).toBe(localised(15933, 'mph'));
    expect(d.range).toBe('5048 miles');
    expect(d.rangeRate).toBe('-2.00 miles/s');
    // Coordinates and angles are not distances and must not be scaled.
    expect(d.lat).toBe('-76.35');
    expect(d.azEl).toBe('158° / -70°');
  });

  it('separates below-horizon from above-horizon-but-below-minimum', () => {
    expect(deriveSatelliteTelemetry({ ...baseSat, isVisible: true }, METRIC, NOW).status).toBe('visible');
    expect(deriveSatelliteTelemetry({ ...baseSat, isVisible: false, elevation: 2 }, METRIC, NOW).status).toBe(
      'belowMinElev',
    );
    expect(deriveSatelliteTelemetry({ ...baseSat, isVisible: false, elevation: -30 }, METRIC, NOW).status).toBe(
      'belowHorizon',
    );
  });

  it('renders missing numbers as N/A or empty, never NaN', () => {
    const d = deriveSatelliteTelemetry({ name: 'unknown' }, METRIC, NOW);
    expect(d.altitude).toBe('N/A');
    expect(d.speed).toBe('N/A');
    expect(d.range).toBe('');
    expect(d.azEl).toBe('');
    expect(d.dopplerFactor).toBe('');
    expect(d.nextPass).toBe('');
    expect(JSON.stringify(d)).not.toMatch(/NaN/);
  });

  it('survives a null satellite instead of throwing', () => {
    expect(() => deriveSatelliteTelemetry(null, METRIC, NOW)).not.toThrow();
    expect(deriveSatelliteTelemetry(null, METRIC, NOW).name).toBe('');
  });

  it('treats an absent unit preference as imperial, matching the app default', () => {
    expect(deriveSatelliteTelemetry(baseSat, undefined, NOW).altitude).toBe(localised(919, 'miles'));
  });

  it('surfaces pass countdowns already formatted', () => {
    const sat = { ...baseSat, nextPassStartTimes: [inSecs(600)], nextPassEndTimes: [inSecs(1200)] };
    const d = deriveSatelliteTelemetry(sat, METRIC, NOW);
    expect(d.nextPass).toBe('00:10:00');
    expect(d.endingIn).toBe('00:20:00');
  });

  it('passes orbit elements through for the Predict modal', () => {
    const omm = { OBJECT_NAME: 'AO-7' };
    expect(deriveSatelliteTelemetry({ ...baseSat, omm }, METRIC, NOW).omm).toBe(omm);
    expect(deriveSatelliteTelemetry(baseSat, METRIC, NOW).omm).toBeNull();
  });
});
