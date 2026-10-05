// Shared data model. The same JSON shape is read by the iOS widget
// (src-tauri/ios/DailyWeatherWidget/Model.swift) — keep the two in sync.

export interface SavedLocation {
  id: string;
  name: string;
  /** Region / country line shown under the name. */
  detail: string;
  lat: number;
  lon: number;
}

export interface Tide {
  /** Unix seconds. */
  time: number;
  kind: "high" | "low";
  /** Metres relative to mean sea level. */
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
  /** null when the location is not near the coast. */
  tides: Tide[] | null;
}

export type Units = "f" | "c";

export interface AppState {
  version: 1;
  units: Units;
  locations: SavedLocation[];
  forecasts: Record<string, Forecast>;
}
