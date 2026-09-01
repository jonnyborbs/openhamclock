import { describe, expect, it } from 'vitest';
import { dewPointC, mapOwmToOpenMeteo, owmIdToWmo } from './owmWeather.js';

const CURRENT = {
  dt: 1_800_000_000,
  timezone: -14400, // UTC-4
  main: { temp: 25, feels_like: 27, humidity: 60, pressure: 1015, temp_max: 26, temp_min: 24 },
  weather: [{ id: 801 }],
  clouds: { all: 20 },
  wind: { speed: 5, deg: 270, gust: 8 },
  visibility: 10000,
  sys: { sunrise: 1_799_980_000, sunset: 1_800_030_000 },
};

const forecastEntry = (hoursFromNow, temp, id = 800, pop = 0.3) => ({
  dt: CURRENT.dt + hoursFromNow * 3600,
  main: { temp, temp_max: temp + 1, temp_min: temp - 1 },
  weather: [{ id }],
  wind: { speed: 4 },
  pop,
  rain: { '3h': 0.5 },
});

const FORECAST = {
  city: { timezone: -14400 },
  list: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30].map((h) => forecastEntry(h, 20 + h / 3)),
};

describe('owmIdToWmo', () => {
  it('maps representative OWM ids to WMO codes', () => {
    expect(owmIdToWmo(800)).toBe(0); // clear
    expect(owmIdToWmo(802)).toBe(2); // partly cloudy
    expect(owmIdToWmo(804)).toBe(3); // overcast
    expect(owmIdToWmo(500)).toBe(61); // light rain
    expect(owmIdToWmo(211)).toBe(95); // thunderstorm
    expect(owmIdToWmo(741)).toBe(45); // fog
    expect(owmIdToWmo(601)).toBe(73); // snow
  });
});

describe('dewPointC', () => {
  it('approximates dew point within tolerance', () => {
    expect(dewPointC(25, 60)).toBeCloseTo(16.7, 0); // textbook value ≈16.7°C
    expect(dewPointC(0, 100)).toBeCloseTo(0, 0);
    expect(dewPointC(null, 60)).toBeNull();
  });
});

describe('mapOwmToOpenMeteo', () => {
  const out = mapOwmToOpenMeteo(CURRENT, FORECAST);

  it('maps current conditions with unit conversions', () => {
    expect(out.current.temperature_2m).toBe(25);
    expect(out.current.wind_speed_10m).toBeCloseTo(18, 0); // 5 m/s → 18 km/h
    expect(out.current.weather_code).toBe(1); // 801 → mainly clear
    expect(out.current.is_day).toBe(1); // dt between sunrise/sunset
    expect(out.current.visibility).toBe(10000);
    expect(out.current.dew_point_2m).toBeCloseTo(16.7, 0);
  });

  it('triples 3-hourly entries so the panel sampling shows each once', () => {
    expect(out.hourly.time).toHaveLength(24); // 8 entries × 3
    expect(out.hourly.temperature_2m[0]).toBe(out.hourly.temperature_2m[2]);
    expect(out.hourly.temperature_2m[3]).not.toBe(out.hourly.temperature_2m[0]);
    expect(out.hourly.precipitation_probability[0]).toBe(30);
  });

  it('buckets daily aggregates by location-local day, up to 3 days', () => {
    expect(out.daily.time.length).toBeLessThanOrEqual(3);
    expect(out.daily.time[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.daily.temperature_2m_max[0]).toBeGreaterThan(out.daily.temperature_2m_min[0]);
    expect(out.daily.precipitation_probability_max[0]).toBe(30);
  });

  it('survives a missing forecast (current-only rendering)', () => {
    const solo = mapOwmToOpenMeteo(CURRENT, null);
    expect(solo.current.temperature_2m).toBe(25);
    expect(solo.hourly.time).toHaveLength(0);
    expect(solo.daily.time).toHaveLength(0);
  });

  it('returns null on junk', () => {
    expect(mapOwmToOpenMeteo(null, FORECAST)).toBeNull();
    expect(mapOwmToOpenMeteo({}, FORECAST)).toBeNull();
  });
});
