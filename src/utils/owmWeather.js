/**
 * OpenWeatherMap → Open-Meteo shape adapter (discussion #474).
 *
 * The weather panels and convertWeatherData() speak Open-Meteo's response
 * shape. Users who already hold an OWM key (the clouds layer uses one) can
 * pick OpenWeatherMap as their weather source; this module maps OWM's free
 * 2.5-tier `weather` + `forecast` (3-hourly, 5 day) responses into that same
 * shape so nothing downstream changes.
 *
 * Notes on fidelity:
 * - OWM 2.5 has no UV index or minutely data; uv fields come back 0.
 * - Dew point isn't in the 2.5 payload — approximated from temperature and
 *   humidity via the Magnus formula (±0.3 °C in normal ranges).
 * - Hourly forecast is 3-hourly upstream; each entry is tripled so the
 *   panel's every-3rd-hour sampling shows each real data point once.
 */

/** OWM condition id → WMO weather code (what WEATHER_CODES expects). */
export function owmIdToWmo(id) {
  if (id >= 200 && id < 300) return 95; // thunderstorm
  if (id >= 300 && id < 400) return 53; // drizzle
  if (id === 500) return 61;
  if (id === 501) return 63;
  if (id >= 502 && id <= 504) return 65;
  if (id === 511) return 66; // freezing rain
  if (id === 520) return 80;
  if (id === 521) return 81;
  if (id >= 522 && id <= 531) return 82;
  if (id === 600) return 71;
  if (id === 601) return 73;
  if (id === 602) return 75;
  if (id >= 611 && id <= 616) return 85; // sleet family
  if (id >= 620 && id <= 622) return 86;
  if (id >= 700 && id < 800) return 45; // mist/haze/fog/dust
  if (id === 800) return 0;
  if (id === 801) return 1;
  if (id === 802) return 2;
  return 3; // 803/804 broken/overcast
}

/** Magnus dew point approximation (°C in, °C out). */
export function dewPointC(tempC, rhPercent) {
  if (tempC == null || !rhPercent) return null;
  const gamma = Math.log(rhPercent / 100) + (17.625 * tempC) / (243.04 + tempC);
  return (243.04 * gamma) / (17.625 - gamma);
}

const msToKmh = (ms) => (ms == null ? null : ms * 3.6);
const precipOf = (entry) =>
  (entry?.rain?.['3h'] ?? entry?.rain?.['1h'] ?? 0) + (entry?.snow?.['3h'] ?? entry?.snow?.['1h'] ?? 0);

/**
 * Map OWM `/data/2.5/weather` (current) + `/data/2.5/forecast` (3h list)
 * responses (units=metric) into Open-Meteo's raw response shape.
 */
export function mapOwmToOpenMeteo(current, forecast) {
  if (!current?.main) return null;
  const tzOffset = current.timezone ?? forecast?.city?.timezone ?? 0; // seconds

  const wmo = owmIdToWmo(current.weather?.[0]?.id ?? 800);
  const now = current.dt ?? Math.floor(Date.now() / 1000);
  const isDay =
    current.sys?.sunrise && current.sys?.sunset ? (now >= current.sys.sunrise && now < current.sys.sunset ? 1 : 0) : 1;

  const out = {
    timezone: `UTC${tzOffset >= 0 ? '+' : ''}${Math.round(tzOffset / 3600)}`,
    current: {
      temperature_2m: current.main.temp,
      relative_humidity_2m: current.main.humidity,
      apparent_temperature: current.main.feels_like,
      weather_code: wmo,
      cloud_cover: current.clouds?.all ?? 0,
      pressure_msl: current.main.sea_level ?? current.main.pressure,
      wind_speed_10m: msToKmh(current.wind?.speed),
      wind_direction_10m: current.wind?.deg ?? 0,
      wind_gusts_10m: msToKmh(current.wind?.gust),
      precipitation: precipOf(current),
      uv_index: 0,
      visibility: current.visibility ?? null, // meters, same as Open-Meteo
      dew_point_2m: dewPointC(current.main.temp, current.main.humidity),
      is_day: isDay,
    },
    hourly: { time: [], temperature_2m: [], precipitation_probability: [], weather_code: [] },
    daily: {
      time: [],
      temperature_2m_max: [],
      temperature_2m_min: [],
      precipitation_sum: [],
      precipitation_probability_max: [],
      weather_code: [],
      uv_index_max: [],
      wind_speed_10m_max: [],
    },
  };

  const list = Array.isArray(forecast?.list) ? forecast.list : [];

  // Hourly: first 24h of 3-hourly entries, each tripled to hour granularity.
  for (const entry of list.slice(0, 8)) {
    for (let h = 0; h < 3; h++) {
      out.hourly.time.push(new Date((entry.dt + h * 3600) * 1000).toISOString());
      out.hourly.temperature_2m.push(entry.main?.temp ?? null);
      out.hourly.precipitation_probability.push(Math.round((entry.pop ?? 0) * 100));
      out.hourly.weather_code.push(owmIdToWmo(entry.weather?.[0]?.id ?? 800));
    }
  }

  // Daily: bucket the 3-hourly list by location-local calendar day.
  const days = new Map(); // 'YYYY-MM-DD' → aggregate
  for (const entry of list) {
    const key = new Date((entry.dt + tzOffset) * 1000).toISOString().slice(0, 10);
    let d = days.get(key);
    if (!d) {
      d = { max: -Infinity, min: Infinity, precip: 0, popMax: 0, windMax: 0, codes: [] };
      days.set(key, d);
    }
    d.max = Math.max(d.max, entry.main?.temp_max ?? entry.main?.temp ?? -Infinity);
    d.min = Math.min(d.min, entry.main?.temp_min ?? entry.main?.temp ?? Infinity);
    d.precip += precipOf(entry);
    d.popMax = Math.max(d.popMax, Math.round((entry.pop ?? 0) * 100));
    d.windMax = Math.max(d.windMax, msToKmh(entry.wind?.speed) ?? 0);
    d.codes.push(owmIdToWmo(entry.weather?.[0]?.id ?? 800));
  }
  for (const [key, d] of [...days.entries()].slice(0, 3)) {
    out.daily.time.push(key);
    out.daily.temperature_2m_max.push(Number.isFinite(d.max) ? d.max : null);
    out.daily.temperature_2m_min.push(Number.isFinite(d.min) ? d.min : null);
    out.daily.precipitation_sum.push(parseFloat(d.precip.toFixed(2)));
    out.daily.precipitation_probability_max.push(d.popMax);
    // Representative code: the worst (highest WMO) of the day reads honestly
    out.daily.weather_code.push(Math.max(...d.codes));
    out.daily.uv_index_max.push(0);
    out.daily.wind_speed_10m_max.push(Math.round(d.windMax));
  }

  return out;
}

export default { owmIdToWmo, dewPointC, mapOwmToOpenMeteo };
