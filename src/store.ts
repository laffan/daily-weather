// Persistence. Inside Tauri the state lives in a JSON file that the iOS
// widget can also read (App Group container on iOS, app data dir elsewhere).
// In a plain browser (`npm run dev`) it falls back to localStorage.

import { invoke } from "@tauri-apps/api/core";
import type { AppState, Forecast } from "./types";

const LS_KEY = "daily-weather-state";
const inTauri = "__TAURI_INTERNALS__" in window;

export function emptyState(): AppState {
  const fahrenheit = /-(US|LR|MM|BS|BZ|KY|PW)$/i.test(navigator.language);
  return { version: 1, units: fahrenheit ? "f" : "c", locations: [], forecasts: {} };
}

function parse<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export async function loadState(): Promise<AppState> {
  let state: AppState | null = null;
  let widgetForecasts: Record<string, Forecast> = {};

  if (inTauri) {
    try {
      const files = await invoke<{ state: string | null; widget: string | null }>("load_state");
      state = parse<AppState>(files.state);
      widgetForecasts = parse<{ forecasts: Record<string, Forecast> }>(files.widget)?.forecasts ?? {};
    } catch (e) {
      console.warn("load_state failed", e);
    }
  }
  state ??= parse<AppState>(safeLocalStorageGet());
  state ??= emptyState();

  // The widget refreshes on its own and keeps its downloads in a separate
  // file; adopt any forecast it fetched more recently than we did.
  for (const [id, f] of Object.entries(widgetForecasts)) {
    if (!state.locations.some((l) => l.id === id)) continue;
    if ((state.forecasts[id]?.fetchedAt ?? 0) < f.fetchedAt) state.forecasts[id] = f;
  }
  return state;
}

export async function saveState(state: AppState): Promise<void> {
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(LS_KEY, json);
  } catch {
    /* storage may be unavailable; the Tauri file is the source of truth */
  }
  if (inTauri) {
    try {
      await invoke("save_state", { json });
    } catch (e) {
      console.warn("save_state failed", e);
    }
  }
}

function safeLocalStorageGet(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}
