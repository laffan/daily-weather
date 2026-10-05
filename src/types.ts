// Shared data model. The same JSON shape is read by the iOS widget
// (src-tauri/ios/DailyWeatherWidget/Model.swift) — keep the two in sync.

export interface TideStation {
  /** NOAA CO-OPS station id, e.g. "9413745". */
  id: string;
  name: string;
}

export interface SavedLocation {
  id: string;
  name: string;
  /** Region / country line shown under the name. */
  detail: string;
  lat: number;
  lon: number;
  /**
   * Nearest NOAA tide-prediction station. `null` = looked, none close enough
   * (falls back to the Open-Meteo model); absent = not looked up yet.
   */
  tideStation?: TideStation | null;
}

export interface Tide {
  /** Unix seconds. */
  time: number;
  kind: "high" | "low";
  /** Metres, relative to `Forecast.tideDatum`. */
  height: number;
}

export interface Forecast {
  /** Unix seconds when the data was downloaded. */
  fetchedAt: number;
  /** IANA time zone of the location. */
  tz: string;
  hourly: {
    time: number[];
    /** °C */
    temp: (number | null)[];
    /** Precipitation probability, 0–100. */
    pop: (number | null)[];
  };
  daily: {
    /** Local midnight, unix seconds. */
    time: number[];
    sunrise: number[];
    sunset: number[];
    max: (number | null)[];
    min: (number | null)[];
  };
  /** Where the temperatures came from ("NOAA NBM" in the contiguous US). */
  tempSource?: string;
  /** High/low tide turning points; null when the place is not near the coast. */
  tides: Tide[] | null;
  /** "MLLW" for NOAA station predictions, "MSL" for the Open-Meteo model. */
  tideDatum?: "MLLW" | "MSL";
  /** Where the tides came from, for the attribution line. */
  tideSource?: string;
  /** Hourly swell; null when the place is not near the coast. */
  swell?: {
    time: number[];
    /** Significant swell height, metres. */
    height: (number | null)[];
    /** Swell period, seconds. */
    period: (number | null)[];
    source: string;
  } | null;
}

export type Units = "f" | "c";

export interface AppState {
  version: 1;
  units: Units;
  locations: SavedLocation[];
  forecasts: Record<string, Forecast>;
}
