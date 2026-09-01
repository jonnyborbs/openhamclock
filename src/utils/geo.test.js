import { describe, it, expect } from 'vitest';
import { validateGridLocator, latLonToMaidenhead, maidenheadToLatLon, maidenheadToBoundingBox } from './geo.js';
import { getSunPosition, getMoonPosition, getMoonPhase } from './geo.js';
import { normalizeLon } from './geo.js';
import { destinationPoint, deadReckonPosition, calculateDistance, calculateBearing } from './geo.js';
import { densifyPath, densifyGeoJson } from './geo.js';

// normalize to [−π, +π)
const normalizeRadians = (r) => {
  const twoPi = 2 * Math.PI;
  const x = ((r % twoPi) + twoPi) % twoPi; // now in [0, 2π)
  return x >= Math.PI ? x - twoPi : x; // map [π, 2π) → [−π, 0)
};
const normalizeDegrees360 = (d) => {
  return ((d % 360) + 360) % 360;
};
const normalizeDegrees180 = (d) => {
  return ((((d + 180) % 360) + 360) % 360) - 180;
};
const deg2rad = (d) => {
  return (d * Math.PI) / 180;
};
const rad2deg = (r) => {
  return (r * 180) / Math.PI;
};
// Convert H:M:S → radians
const hmsToRad = (h, m, s) => {
  const hours = h + m / 60 + s / 3600;
  return (hours / 24) * 2 * Math.PI;
};
// Convert D:M:S → radians
const dmsToRad = (d, m, s) => {
  const sign = d < 0 ? -1 : 1;
  const deg = Math.abs(d) + m / 60 + s / 3600;
  return sign * deg * (Math.PI / 180);
};

describe('Maidenhead Grid tests', () => {
  const gridCases = [
    // note that 'grid' fields entered in the test cases are all 8 characters long,
    // as tests will also validate the first 2, 4, 6 and 8 characters.

    // location in San Diego, CA, USA
    {
      grid: 'DM12kv99',
      actualLatLon: { lat: 32.91254, lon: -117.08409 },
      latLonSWCornerGrid6: [32.875, -117.167],
      latLonNECornerGrid6: [32.917, -117.083],
    },

    // location in Sydney, Australia
    {
      grid: 'QF56od55',
      actualLatLon: { lat: -33.8519, lon: 151.210886 },
    },

    // location at equator / prime meridian
    {
      grid: 'JJ00aa00',
      actualLatLon: { lat: 0, lon: 0 },
    },

    // location at equator just west of antimeridian
    {
      grid: 'RJ90XA90',
      actualLatLon: { lat: 0, lon: 179.999 },
    },

    // location at equator on antimeridian
    // note that this is not strictly valid as longitude should be given as -180 rather than +180,
    // however some sources may expected +180 to be functional so it should be tested
    {
      grid: 'AJ00AA00',
      actualLatLon: { lat: 0, lon: 180.0 },
    },

    // location at equator on antimeridian
    {
      grid: 'AJ00AA00',
      actualLatLon: { lat: 0, lon: -180.0 },
    },
  ];

  it('should invalidate empty grid locator', () => {
    expect(validateGridLocator('')).toBe(false);
  });

  it('should invalidate grid locator with invalid length', () => {
    expect(validateGridLocator('DM1')).toBe(false);
  });

  it('should invalidate grid locator with invalid characters', () => {
    expect(validateGridLocator('DM12zz')).toBe(false);
  });

  for (const { grid, actualLatLon, latLonSWCornerGrid6, latLonNECornerGrid6 } of gridCases) {
    it(
      ('should validate test case grid locator has size 8',
      () => {
        expect(grid.length).toEqual(8);
      }),
    );

    const defaultSize = 6;
    const sizes = [2, 4, 6, 8];
    for (const size of sizes) {
      it("should validate grid locator '" + grid.substring(0, size) + "'", () => {
        const subGrid = grid.substring(0, size);
        expect(validateGridLocator(subGrid)).toBe(true);
      });
    }

    for (const size of sizes) {
      it('should convert Lat/Lon to Maidenhead Grid of requested size ' + size, () => {
        const result = latLonToMaidenhead(actualLatLon, size);
        expect(result.toUpperCase()).toBe(grid.substring(0, size).toUpperCase());
      });
    }

    it('should convert Lat/Lon to Maidenhead Grid with default size 6 when no size is specified', () => {
      const result = latLonToMaidenhead(actualLatLon);
      expect(result.toUpperCase()).toBe(grid.substring(0, defaultSize).toUpperCase());
    });

    for (const size of sizes) {
      it("should convert Maidenhead Grid '" + grid.substring(0, size) + "' to Lat/Lon", () => {
        const { lat, lon } = maidenheadToLatLon(grid.substring(0, size));
        // handle case where longitude is given as +180 or -180, although +180 is strictly invalid it can sometimes be used so should be tested
        const { lat: expectedLat, lon: rawLon } = actualLatLon,
          expectedLon = ((rawLon + 180) % 360) - 180;
        let latBucketSize, lonBucketSize, latBucketStart, latBucketEnd, lonBucketStart, lonBucketEnd;

        switch (size) {
          case 2:
            latBucketSize = 10; // degrees
            latBucketStart = Math.floor(expectedLat / latBucketSize) * latBucketSize;
            latBucketEnd = latBucketStart + latBucketSize;

            lonBucketSize = 20; // degrees
            lonBucketStart = Math.floor(expectedLon / lonBucketSize) * lonBucketSize;
            lonBucketEnd = lonBucketStart + lonBucketSize;
            break;

          case 4:
            latBucketSize = 1; // degrees
            latBucketStart = Math.floor(expectedLat / latBucketSize) * latBucketSize;
            latBucketEnd = latBucketStart + latBucketSize;

            lonBucketSize = 2; // degrees
            lonBucketStart = Math.floor(expectedLon / lonBucketSize) * lonBucketSize;
            lonBucketEnd = lonBucketStart + lonBucketSize;
            break;

          case 6:
            latBucketSize = 2.5; // minutes
            latBucketStart = (Math.floor((60 * expectedLat) / latBucketSize) * latBucketSize) / 60;
            latBucketEnd = latBucketStart + latBucketSize / 60;

            lonBucketSize = 5; // minutes
            lonBucketStart = (Math.floor((60 * expectedLon) / lonBucketSize) * lonBucketSize) / 60;
            lonBucketEnd = lonBucketStart + lonBucketSize / 60;
            break;

          case 8:
            latBucketSize = 0.25; // minutes
            latBucketStart = (Math.floor((10 * 60 * expectedLat) / latBucketSize) * latBucketSize) / 60 / 10;
            latBucketEnd = latBucketStart + latBucketSize / 60;

            lonBucketSize = 0.5; // minutes
            lonBucketStart = (Math.floor((60 * expectedLon) / lonBucketSize) * lonBucketSize) / 60;
            lonBucketEnd = lonBucketStart + lonBucketSize / 60;
            break;

          default:
            throw new Error('invalid size');
        }

        expect(lat).toBeGreaterThanOrEqual(latBucketStart);
        expect(lat).toBeLessThan(latBucketEnd);
        expect(lon).toBeGreaterThanOrEqual(lonBucketStart);
        expect(lon).toBeLessThan(lonBucketEnd);
      });
    }

    if (latLonSWCornerGrid6 && latLonNECornerGrid6) {
      it(
        "should convert Maidenhead Grid '" + grid.substring(0, defaultSize) + "' to Lat/Lon bounding box coordinates",
        () => {
          const result = maidenheadToBoundingBox(grid.substring(0, defaultSize));
          expect(result).toHaveLength(2);
          expect(result[0]).toHaveLength(2);
          expect(result[1]).toHaveLength(2);

          expect(result[0][0]).toBeCloseTo(latLonSWCornerGrid6[0], 3);
          expect(result[0][1]).toBeCloseTo(latLonSWCornerGrid6[1], 3);
          expect(result[1][0]).toBeCloseTo(latLonNECornerGrid6[0], 3);
          expect(result[1][1]).toBeCloseTo(latLonNECornerGrid6[1], 3);
        },
      );
    }
  }
});

describe('Sun tests', () => {
  const sunEphemerisCases = [
    // based on https://eclipse.gsfc.nasa.gov/TYPE/sun1.html#su2000
    {
      date: '1999-12-22T00:00:00.000Z',
      gast: 6 + 0 / 60 + 26.7 / 3600,
      dec: -(23 + 26 / 60 + 14.1 / 3600),
      ra: 17 + 58 / 60 + 34.03 / 3600,
    },

    // based on https://eclipse.gsfc.nasa.gov/TYPE/sun1.html#su2000
    {
      date: '2000-01-01T00:00:00.000Z',
      gast: 6 + 39 / 60 + 52.3 / 3600,
      dec: -(23 + 4 / 60 + 16.2 / 3600),
      ra: 18 + 42 / 60 + 54.05 / 3600,
    },

    // based on https://eclipse.gsfc.nasa.gov/TYPE/sun1.html#su2000
    {
      date: '2000-06-21T00:00:00.000Z',
      gast: 17 + 57 / 60 + 59.8 / 3600,
      dec: 23 + 26 / 60 + 16.2 / 3600,
      ra: 5 + 59 / 60 + 41.15 / 3600,
    },

    // based on https://www.astropixels.com/ephemeris/sun/sun2026.html
    {
      date: '2026-01-01T00:00:00.000Z',
      gast: 6 + 42 / 60 + 38.8 / 3600,
      dec: -(23 + 1 / 60 + 2.1 / 3600),
      ra: 18 + 45 / 60 + 58.74 / 3600,
    },

    // based on https://www.astropixels.com/ephemeris/sun/sun2026.html
    {
      date: '2026-04-29T00:00:00.000Z',
      gast: 14 + 27 / 60 + 52.3 / 3600,
      dec: 14 + 24 / 60 + 3.3 / 3600,
      ra: 2 + 25 / 60 + 16.69 / 3600,
    },
  ];

  for (const ephemeris of sunEphemerisCases) {
    it('should validate getSunPosition() for known position', () => {
      const date = new Date(ephemeris.date);

      const subSolarPointFromGST = (raHours, decDeg, gstHours) => {
        // Hours → radians
        const TWO_PI = 2 * Math.PI;
        const ra = (raHours * TWO_PI) / 24;
        const gast = (gstHours * TWO_PI) / 24;

        // Latitude = Dec (unchanged)
        const lat = decDeg;

        // Longitude = RA - GAST (radians → degrees)
        let lon = normalizeDegrees180(((ra - gast) * 180) / Math.PI);

        return { lat, lon };
      };

      const sunPosition = getSunPosition(date); // target code
      const point = subSolarPointFromGST(ephemeris.ra, ephemeris.dec, ephemeris.gast);

      // check absolute difference in tested and calculated values does not exceed maximum allowed
      const maxAllowedDeltaLat = 0.75;
      const maxAllowedDeltaLon = 1.0;
      expect(Math.abs(normalizeDegrees180(sunPosition.lat - point.lat))).toBeLessThan(maxAllowedDeltaLat);
      expect(Math.abs(normalizeDegrees180(sunPosition.lon - point.lon))).toBeLessThan(maxAllowedDeltaLon);
    });
  }
});

describe('Moon tests', () => {
  // with reference to ephereris https://ssd.jpl.nasa.gov/horizons/app.html#/
  // sampled over a 28-day period
  const moonEphemerisCases = [
    {
      date: '2026-05-27T00:00:00Z',
      raRad: hmsToRad(12, 57, 13.11),
      decRad: dmsToRad(-9, 48, 29.6),
    },
    {
      date: '2026-06-03T00:00:00Z',
      raRad: hmsToRad(18, 48, 36.77),
      decRad: dmsToRad(-26, 55, 51.1),
    },
    {
      date: '2026-06-10T00:00:00Z',
      raRad: hmsToRad(0, 25, 53.25),
      decRad: dmsToRad(6, 1, 4.2),
    },
    {
      date: '2026-06-17T00:00:00Z',
      raRad: hmsToRad(7, 38, 4.91),
      decRad: dmsToRad(24, 47, 13.9),
    },
    {
      date: '2026-06-24T00:00:00Z',
      raRad: hmsToRad(13, 31, 1.59),
      decRad: dmsToRad(-13, 58, 59.0),
    },
  ];

  // Convert JS Date → Julian Date
  function julianDate(date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate() + (date.getUTCHours() + (date.getUTCMinutes() + date.getUTCSeconds() / 60) / 60) / 24;

    let Y = year;
    let M = month;
    if (M <= 2) {
      Y -= 1;
      M += 12;
    }

    const A = Math.floor(Y / 100);
    const B = 2 - A + Math.floor(A / 4);

    return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + day + B - 1524.5;
  }

  // Compute GMST (radians)
  function gmstFromJD(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    const gmstSec = 67310.54841 + (876600 * 3600 + 8640184.812866) * T + 0.093104 * T * T - 6.2e-6 * T * T * T;
    return (((gmstSec * (Math.PI / 43200)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  }

  // Main function: RA/Dec + UTC → sublunar lat/lon
  function sublunarPoint(dateUTC, raRad, decRad) {
    const jd = julianDate(dateUTC);
    const gmst = gmstFromJD(jd);

    // Approximate sublunar point
    const lonRad = normalizeRadians(raRad - gmst);
    const latRad = decRad;

    return {
      lat: rad2deg(latRad),
      lon: rad2deg(lonRad),
    };
  }

  for (const ephemeris of moonEphemerisCases) {
    it('should validate getMoonPosition() for known position', () => {
      const date = new Date(ephemeris.date);
      const targetFunctionResult = getMoonPosition(date); // target function
      const ephemerisResult = sublunarPoint(date, ephemeris.raRad, ephemeris.decRad); // internal calculation from ephemeris

      // check absolute difference in tested and calculated values does not exceed maximum allowed
      const maxAllowedDeltaLat = 0.25;
      const maxAllowedDeltaLon = 0.45;
      expect(Math.abs(normalizeDegrees180(targetFunctionResult.lat - ephemerisResult.lat))).toBeLessThan(
        maxAllowedDeltaLat,
      );
      expect(Math.abs(normalizeDegrees180(targetFunctionResult.lon - ephemerisResult.lon))).toBeLessThan(
        maxAllowedDeltaLon,
      );
    });
  }
});

describe('miscellaneous functionality tests', () => {
  for (const [lon, expected] of [
    [-720, 0],
    [-360, 0],
    [-180, -180],
    [-90, -90],
    [0, 0],
    [90, 90],
    [180, -180],
    [360, 0],
    [720, 0],
  ]) {
    it('should validate normalizeLon()', () => {
      expect(normalizeLon(lon)).toBe(expected);
    });
  }
});

// ─── Moon az/el + rise/set (EME) ──────────────────────────────────────────────
// Cross-validated against suncalc v2 (max err: az 0.30°, el 0.64° — the el
// delta is suncalc's refraction correction, which geometric EME elevation
// intentionally omits; distance within ~500 km).
import { getMoonAzEl, getMoonTimes } from './geo.js';

describe('getMoonAzEl', () => {
  const T = new Date('2026-07-28T23:00:00Z');

  it('is near zenith at the sublunar point and deeply negative at its antipode', () => {
    const sub = getMoonPosition(T);
    const zenith = getMoonAzEl(T, sub.lat, sub.lon);
    expect(zenith.elevation).toBeGreaterThan(89);
    const antipode = getMoonAzEl(T, -sub.lat, ((sub.lon + 360) % 360) - 180);
    expect(antipode.elevation).toBeLessThan(-85);
  });

  it('shows ~0.95° of parallax 90° away from the sublunar point', () => {
    const sub = getMoonPosition(T);
    // 90° along the same meridian: geometric horizon would be 0° for an
    // infinitely distant object; the moon dips by atan(Re/r) ≈ 0.9°.
    const quarter = getMoonAzEl(T, sub.lat - 90 < -90 ? sub.lat + 90 : sub.lat - 90, sub.lon);
    expect(quarter.elevation).toBeLessThan(-0.6);
    expect(quarter.elevation).toBeGreaterThan(-1.3);
  });

  it('returns azimuth in [0, 360) and a physical Earth–Moon distance', () => {
    for (const [lat, lon] of [
      [40, -105],
      [-33.9, 151.2],
      [64, -22],
    ]) {
      const p = getMoonAzEl(T, lat, lon);
      expect(p.azimuth).toBeGreaterThanOrEqual(0);
      expect(p.azimuth).toBeLessThan(360);
      expect(p.distanceKm).toBeGreaterThan(356000);
      expect(p.distanceKm).toBeLessThan(407000);
    }
  });

  it('matches suncalc-validated reference values (pinned)', () => {
    // Reference: suncalc v2 for Boulder, 2026-07-28T23:00Z → az 93.6°, el −33.6°
    // (theirs refraction-corrected; ours geometric — agree within tolerance)
    const p = getMoonAzEl(T, 40.015, -105.27);
    expect(p.azimuth).toBeCloseTo(93.5, 0);
    expect(p.elevation).toBeCloseTo(-34.3, 0);
  });
});

describe('getMoonTimes', () => {
  it('finds the next rise and set within 25h at mid-latitude', () => {
    const start = new Date('2026-07-28T07:00:00Z');
    const { rise, set } = getMoonTimes(start, 40.015, -105.27);
    expect(rise).toBeInstanceOf(Date);
    expect(set).toBeInstanceOf(Date);
    expect(rise.getTime()).toBeGreaterThan(start.getTime());
    expect(set.getTime()).toBeGreaterThan(start.getTime());
    // suncalc reference: set 2026-07-28T10:44Z, next rise 2026-07-29T02:08Z
    // (refracted limb); geometric center crossings land within ~10 min.
    expect(Math.abs(set.getTime() - Date.parse('2026-07-28T10:44:20Z'))).toBeLessThan(12 * 60 * 1000);
    expect(Math.abs(rise.getTime() - Date.parse('2026-07-29T02:08:32Z'))).toBeLessThan(12 * 60 * 1000);
  });

  it('elevation is positive between rise and set-after-rise', () => {
    const start = new Date('2026-07-28T07:00:00Z');
    const { rise } = getMoonTimes(start, 40.015, -105.27);
    const midPass = getMoonAzEl(new Date(rise.getTime() + 3 * 3600 * 1000), 40.015, -105.27);
    expect(midPass.elevation).toBeGreaterThan(0);
  });
});

describe('destinationPoint / deadReckonPosition (aircraft track prediction)', () => {
  it('travels due north: distance maps directly to latitude', () => {
    // 1° of latitude ≈ 111.195 km on the R=6371 sphere used by geo.js
    const p = destinationPoint(10, 20, 0, (Math.PI / 180) * 6371 * 4); // exactly 4°
    expect(p.lat).toBeCloseTo(14, 5);
    expect(p.lon).toBeCloseTo(20, 5);
  });

  it('travels due east along the equator: distance maps directly to longitude', () => {
    const p = destinationPoint(0, -30, 90, (Math.PI / 180) * 6371 * 10); // exactly 10°
    expect(p.lat).toBeCloseTo(0, 5);
    expect(p.lon).toBeCloseTo(-20, 5);
  });

  it('matches a published geodesy reference case', () => {
    // Movable Type "destination point" worked example (spherical Earth):
    // 53°19′14″N 001°43′47″W, bearing 096°01′18″, 124.8 km
    // → 53°11′18″N 000°08′00″E
    const p = destinationPoint(53.320556, -1.729722, 96.021667, 124.8);
    expect(p.lat).toBeCloseTo(53.188333, 3);
    expect(p.lon).toBeCloseTo(0.133333, 3);
  });

  it('round-trips with calculateDistance and calculateBearing', () => {
    const start = { lat: 40.015, lon: -105.27 };
    const p = destinationPoint(start.lat, start.lon, 57, 800);
    expect(calculateDistance(start.lat, start.lon, p.lat, p.lon)).toBeCloseTo(800, 6);
    expect(calculateBearing(start.lat, start.lon, p.lat, p.lon)).toBeCloseTo(57, 5);
  });

  it('dead-reckons position after N minutes at course/speed', () => {
    // 450 kn due north for 30 min → 225 nmi = 416.7 km = 3.7477° of latitude
    const p = deadReckonPosition(30, -100, 0, 450, 30);
    const expectedDeg = ((450 * 1.852 * 0.5) / 6371 / Math.PI) * 180;
    expect(p.lat).toBeCloseTo(30 + expectedDeg, 5);
    expect(p.lon).toBeCloseTo(-100, 5);
  });

  it('zero speed or zero minutes stays put', () => {
    const q = deadReckonPosition(45, 45, 270, 0, 60);
    expect(q.lat).toBeCloseTo(45, 8);
    expect(q.lon).toBeCloseTo(45, 8);
    const p = deadReckonPosition(45, 45, 270, 480, 0);
    expect(p.lat).toBeCloseTo(45, 8);
    expect(p.lon).toBeCloseTo(45, 8);
  });

  it('crosses the antimeridian eastbound and wraps to negative longitude', () => {
    // 480 kn due east on the equator from 179.5°E for 60 min → 480 nmi ≈ 8°
    const p = deadReckonPosition(0, 179.5, 90, 480, 60);
    const travelledDeg = ((480 * 1.852) / 6371 / Math.PI) * 180;
    expect(p.lat).toBeCloseTo(0, 5);
    expect(p.lon).toBeCloseTo(179.5 + travelledDeg - 360, 4); // ≈ −172.5
    expect(p.lon).toBeGreaterThanOrEqual(-180);
    expect(p.lon).toBeLessThan(180);
  });

  it('crosses the antimeridian westbound and wraps to positive longitude', () => {
    const p = deadReckonPosition(-20, -178, 270, 400, 90);
    expect(p.lon).toBeGreaterThan(0); // wrapped into eastern hemisphere
    expect(p.lon).toBeLessThan(180);
    expect(calculateDistance(-20, -178, p.lat, p.lon)).toBeCloseTo(400 * 1.852 * 1.5, 6);
  });
});

describe('densifyPath / densifyGeoJson (projection curvature densification)', () => {
  it('leaves short segments untouched', () => {
    const path = [
      [0, 0],
      [1, 1.5],
      [2, 3],
    ];
    expect(densifyPath(path)).toEqual(path);
  });

  it('does not subdivide a segment exactly at the threshold', () => {
    expect(
      densifyPath(
        [
          [0, 0],
          [0, 2],
        ],
        2,
      ),
    ).toEqual([
      [0, 0],
      [0, 2],
    ]);
  });

  it('subdivides a long east-west segment into even <=2° steps, endpoints preserved', () => {
    const out = densifyPath(
      [
        [10, 0],
        [10, 10],
      ],
      2,
    );
    expect(out.length).toBe(6); // 5 segments of 2°
    expect(out[0]).toEqual([10, 0]);
    expect(out[out.length - 1]).toEqual([10, 10]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i][0]).toBeCloseTo(10, 10); // constant latitude
      expect(out[i][1] - out[i - 1][1]).toBeCloseTo(2, 10);
    }
  });

  it('uses the larger of the lat/lon spans to pick the subdivision count', () => {
    // 7° of latitude vs 1° of longitude → ceil(7/2) = 4 segments → 3 inserted
    const out = densifyPath(
      [
        [0, 0],
        [7, 1],
      ],
      2,
    );
    expect(out.length).toBe(5);
    expect(out[1]).toEqual([7 / 4, 1 / 4]); // linear interpolation in lat/lon
  });

  it('never bridges an antimeridian jump (|dlon| > 180 left as-is)', () => {
    // A path already split-friendly: 179 → -179 is a 2° hop across the date
    // line stored as a -358° jump. Interpolating it would smear a line across
    // the whole map, so it must pass through untouched.
    const path = [
      [10, 170],
      [10, 179],
      [10, -179],
      [10, -170],
    ];
    const out = densifyPath(path, 2);
    expect(out).toContainEqual([10, 179]);
    expect(out).toContainEqual([10, -179]);
    const i179 = out.findIndex((p) => p[1] === 179);
    expect(out[i179 + 1]).toEqual([10, -179]); // still adjacent — jump preserved
    // and the sub-180 flanking segments got densified normally
    expect(out.length).toBe(4 + ceilSegs(9) - 1 + ceilSegs(9) - 1);
  });

  it('densifies unwrapped world-copy coordinates linearly (no wrap-around)', () => {
    // Unwrapped paths (e.g. from getGreatCirclePoints) can exceed ±180; a
    // 10° hop from 355 to 365 must interpolate through 357, 359, ... — not wrap
    const out = densifyPath(
      [
        [0, 355],
        [0, 365],
      ],
      2,
    );
    expect(out.length).toBe(6);
    expect(out[2]).toEqual([0, 359]);
  });

  it('passes through degenerate inputs unchanged', () => {
    expect(densifyPath([])).toEqual([]);
    expect(densifyPath([[5, 5]])).toEqual([[5, 5]]);
    expect(densifyPath(null)).toBe(null);
  });

  it('densifyGeoJson handles Polygon rings in [lon, lat] order', () => {
    const geom = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0], // 10° of longitude along the equator
          [10, 3],
          [0, 3],
          [0, 0],
        ],
      ],
    };
    const out = densifyGeoJson(geom, 2);
    expect(out).not.toBe(geom); // new object, input untouched
    expect(geom.coordinates[0].length).toBe(5);
    const ring = out.coordinates[0];
    expect(ring[0]).toEqual([0, 0]);
    expect(ring[ring.length - 1]).toEqual([0, 0]);
    // first edge subdivided into 5 → points at lon 2,4,6,8 with lat 0
    expect(ring[1]).toEqual([2, 0]);
    expect(ring[2]).toEqual([4, 0]);
    // ring stays closed and both 10°-long edges gained 4 points each,
    // the two 3° edges gained 1 each
    expect(ring.length).toBe(5 + 4 + 4 + 1 + 1);
  });

  it('densifyGeoJson handles MultiPolygon and leaves other types unchanged', () => {
    const multi = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [8, 0],
            [8, 1],
            [0, 0],
          ],
        ],
      ],
    };
    const out = densifyGeoJson(multi, 2);
    expect(out.coordinates[0][0].length).toBeGreaterThan(4);

    const point = { type: 'Point', coordinates: [5, 5] };
    expect(densifyGeoJson(point, 2)).toBe(point);
    expect(densifyGeoJson(null, 2)).toBe(null);
  });
});

// segments needed to cover `span` degrees at 2° max
function ceilSegs(span) {
  return Math.ceil(span / 2);
}
