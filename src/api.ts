// Open-Meteo (https://open-meteo.com) — free, no API key.
// The widget has a Swift port of fetchForecast in Model.swift.

import type { Forecast, SavedLocation, Tide } from "./types";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

const FORECAST_DAYS = 7;
/** A sea grid cell further away than this means "not coastal". */
const COAST_MAX_KM = 25;
/** Smaller swings than this are not treated as tides (enclosed water, bad cells). */
const MIN_TIDAL_RANGE_M = 0.1;

async function getJson(url: string, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

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

export async function fetchForecast(loc: SavedLocation): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: "temperature_2m,precipitation_probability",
    daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: String(FORECAST_DAYS),
  });
  const [weather, tides] = await Promise.all([
    getJson(`${FORECAST_URL}?${params}`),
    fetchTides(loc).catch(() => null),
  ]);
  return {
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
    tides,
  };
}

/**
 * Open-Meteo's marine model includes tides in `sea_level_height_msl`.
 * It is a coarse model (not for navigation) but good enough to show
 * roughly when high and low tide happen.
 */
async function fetchTides(loc: SavedLocation): Promise<Tide[] | null> {
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: "sea_level_height_msl",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: String(FORECAST_DAYS),
    cell_selection: "sea",
  });
  const data = await getJson(`${MARINE_URL}?${params}`);
  if (distanceKm(loc.lat, loc.lon, data.latitude, data.longitude) > COAST_MAX_KM) return null;
  return findTides(data.hourly?.time ?? [], data.hourly?.sea_level_height_msl ?? []);
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
