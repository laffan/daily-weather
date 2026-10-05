// Data sources (all free, no API keys):
//   Open-Meteo forecast   temperature, rain chance, sunrise/sunset
//   NOAA CO-OPS           tide predictions from the nearest US station
//   NOAA GFS-Wave model   hourly swell, served through Open-Meteo's marine API
//   Open-Meteo marine     modelled tides where there is no NOAA station
// The widget has a Swift port of fetchForecast in Model.swift.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { Forecast, SavedLocation, Tide, TideStation } from "./types";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const NOAA_STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const NOAA_DATA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

const FORECAST_DAYS = 7;
/** A marine-model sea cell further away than this means "not coastal". */
const COAST_MAX_KM = 25;
/** The GFS-Wave grid is ~25 km, so allow its nearest sea cell to be further out. */
const SWELL_MAX_KM = 50;
const NOAA_STATION_MAX_KM = 30;
/** Smaller swings than this are not treated as tides (enclosed water, bad cells). */
const MIN_TIDAL_RANGE_M = 0.1;

// Inside Tauri, requests go through Rust (no CORS restrictions); in a plain
// browser during development, the normal fetch is used.
const httpFetch: typeof fetch = "__TAURI_INTERNALS__" in window ? tauriFetch : fetch.bind(window);

async function getJson(url: string, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await httpFetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- places

export interface PlaceResult {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const coords = parseCoordinates(query);
  if (coords) {
    return [{ name: `${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}`, detail: "Coordinates", ...coords }];
  }
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const data = await getJson(url);
  return (data.results ?? []).map((r: any) => ({
    name: r.name,
    detail: [r.admin1, r.country_code ?? r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

function parseCoordinates(q: string): { lat: number; lon: number } | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

let stationList: Promise<{ id: string; name: string; lat: number; lon: number }[]> | null = null;

/** Nearest NOAA tide-prediction station, or null if none is within range. */
export async function findTideStation(lat: number, lon: number): Promise<TideStation | null> {
  stationList ??= getJson(NOAA_STATIONS_URL, 30000)
    .then((d) =>
      (d.stations ?? []).map((s: any) => ({ id: String(s.id), name: String(s.name), lat: Number(s.lat), lon: Number(s.lng) })),
    )
    .catch((e) => {
      stationList = null; // retry next time
      throw e;
    });
  let best: TideStation | null = null;
  let bestKm = NOAA_STATION_MAX_KM;
  for (const s of await stationList!) {
    const km = distanceKm(lat, lon, s.lat, s.lon);
    if (km <= bestKm) {
      bestKm = km;
      best = { id: s.id, name: s.name };
    }
  }
  return best;
}

// ---------------------------------------------------------------- forecast

export async function fetchForecast(loc: SavedLocation): Promise<Forecast> {
  const common = {
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: String(FORECAST_DAYS),
  };
  const q = (extra: Record<string, string>) => new URLSearchParams({ ...common, ...extra });

  const [weather, model, gfsWave, noaa] = await Promise.all([
    getJson(`${FORECAST_URL}?${q({
      hourly: "temperature_2m,precipitation_probability",
      daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
    })}`),
    // Default marine models: modelled sea level (tides) + a swell fallback.
    getJson(`${MARINE_URL}?${q({
      hourly: "sea_level_height_msl,swell_wave_height,swell_wave_period",
      cell_selection: "sea",
      past_days: "1", // the chart starts at midnight, before the first upcoming turn
    })}`).catch(() => null),
    // NOAA's GFS-Wave (WAVEWATCH III) swell forecast.
    getJson(`${MARINE_URL}?${q({
      hourly: "swell_wave_height,swell_wave_period",
      models: "ncep_gfswave025",
      cell_selection: "sea",
      past_days: "1",
    })}`).catch(() => null),
    loc.tideStation ? fetchNoaaTides(loc.tideStation.id).catch(() => null) : Promise.resolve(null),
  ]);

  const f: Forecast = {
    fetchedAt: Math.floor(Date.now() / 1000),
    tz: weather.timezone,
    hourly: {
      time: weather.hourly.time,
      temp: weather.hourly.temperature_2m,
      pop: weather.hourly.precipitation_probability,
    },
    daily: {
      time: weather.daily.time,
      sunrise: weather.daily.sunrise,
      sunset: weather.daily.sunset,
      max: weather.daily.temperature_2m_max,
      min: weather.daily.temperature_2m_min,
    },
    tides: null,
    swell: null,
  };

  const near = (m: any, km: number) => m?.hourly && distanceKm(loc.lat, loc.lon, m.latitude, m.longitude) <= km;

  if (noaa && noaa.length) {
    f.tides = noaa;
    f.tideDatum = "MLLW";
    f.tideSource = `NOAA · ${loc.tideStation!.name}`;
  } else if (near(model, COAST_MAX_KM)) {
    f.tides = findTides(model.hourly.time, model.hourly.sea_level_height_msl ?? []);
    if (f.tides) {
      f.tideDatum = "MSL";
      f.tideSource = "Open-Meteo model";
    }
  }

  const coastal = f.tides != null || near(model, COAST_MAX_KM);
  if (coastal && near(gfsWave, SWELL_MAX_KM) && hasValues(gfsWave.hourly.swell_wave_height)) {
    f.swell = swellFrom(gfsWave, "NOAA GFS-Wave");
  } else if (near(model, COAST_MAX_KM) && hasValues(model.hourly.swell_wave_height)) {
    f.swell = swellFrom(model, "Open-Meteo");
  }
  return f;
}

function swellFrom(m: any, source: string): NonNullable<Forecast["swell"]> {
  return {
    time: m.hourly.time,
    height: m.hourly.swell_wave_height,
    period: m.hourly.swell_wave_period ?? [],
    source,
  };
}

const hasValues = (a: (number | null)[] | undefined) => !!a?.some((v) => v != null);

/** High/low predictions for the next week. Heights in metres above MLLW. */
async function fetchNoaaTides(station: string): Promise<Tide[]> {
  // Start a day back so the curve before the first upcoming turn is known.
  const begin = new Date(Date.now() - 86400 * 1000);
  const ymd = `${begin.getUTCFullYear()}${String(begin.getUTCMonth() + 1).padStart(2, "0")}${String(begin.getUTCDate()).padStart(2, "0")}`;
  const params = new URLSearchParams({
    begin_date: ymd,
    range: String((FORECAST_DAYS + 2) * 24),
    station,
    product: "predictions",
    datum: "MLLW",
    interval: "hilo",
    units: "metric",
    time_zone: "gmt",
    format: "json",
    application: "daily-weather",
  });
  const data = await getJson(`${NOAA_DATA_URL}?${params}`);
  if (!Array.isArray(data.predictions)) throw new Error(data.error?.message ?? "no predictions");
  return data.predictions.map((p: any) => ({
    // "2026-10-05 04:12" in GMT
    time: Date.parse(`${p.t.replace(" ", "T")}:00Z`) / 1000,
    kind: p.type === "H" ? "high" : "low",
    height: Number(p.v),
  }));
}

/** Local extrema of an hourly series, refined with a parabola through the three samples. */
export function findTides(time: number[], level: (number | null)[]): Tide[] | null {
  const valid = level.filter((v): v is number => v != null);
  if (valid.length < 24) return null;
  if (Math.max(...valid) - Math.min(...valid) < MIN_TIDAL_RANGE_M) return null;

  const tides: Tide[] = [];
  for (let i = 1; i < level.length - 1; i++) {
    const a = level[i - 1], b = level[i], c = level[i + 1];
    if (a == null || b == null || c == null) continue;
    const isHigh = b > a && b >= c;
    const isLow = b < a && b <= c;
    if (!isHigh && !isLow) continue;
    const denom = a - 2 * b + c;
    const offset = denom === 0 ? 0 : (0.5 * (a - c)) / denom; // in steps, within ±0.5
    const step = time[i + 1] - time[i];
    tides.push({
      time: Math.round(time[i] + offset * step),
      kind: isHigh ? "high" : "low",
      height: b - 0.25 * (a - c) * offset,
    });
  }
  return tides;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
