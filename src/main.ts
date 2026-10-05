import "./style.css";
import { fetchForecast, findTideStation, searchPlaces, type PlaceResult } from "./api";
import { attachScrub, buildChart, forecastWindow, swellAt, tideAt, type Window } from "./chart";
import * as fmt from "./format";
import { loadState, saveState } from "./store";
import type { AppState, Forecast, SavedLocation } from "./types";

/** Refresh a location once its data is older than this (when online). */
const STALE_AFTER_S = 30 * 60;
/** Don't retry a failed location more often than this. */
const RETRY_AFTER_S = 2 * 60;

let state: AppState;
let editing = false;
const refreshing = new Set<string>();
const lastAttempt = new Map<string, number>();

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nowSec = () => Date.now() / 1000;

// ---------------------------------------------------------------- rendering

function render() {
  const list = $("#list");
  document.body.classList.toggle("editing", editing);
  $("#units").textContent = state.units === "f" ? "°F" : "°C";
  $("#edit").textContent = editing ? "Done" : "Edit";
  $("#edit").hidden = state.locations.length === 0;
  renderStatus();

  if (state.locations.length === 0) {
    list.innerHTML = `<p class="empty">No places yet.<br><button class="link" data-action="add">Add a place</button></p>`;
    return;
  }
  list.innerHTML = state.locations.map((loc) => `<article class="card" data-id="${esc(loc.id)}"></article>`).join("");
  for (const loc of state.locations) renderCard(loc);
}

function renderCard(loc: SavedLocation) {
  const card = $(`.card[data-id="${CSS.escape(loc.id)}"]`, $("#list"));
  if (!card) return;
  const f = state.forecasts[loc.id];
  const win = f ? forecastWindow(f) : null;
  const now = f && win ? currentConditions(f, win) : null;

  const tools = `<div class="tools">
      <button data-action="up" aria-label="Move up">↑</button>
      <button data-action="down" aria-label="Move down">↓</button>
      <button data-action="remove" class="danger">Remove</button>
    </div>`;

  const head = `<header class="head">
      <div class="where"><h2>${esc(loc.name)}</h2><p class="sub">${esc(loc.detail)}</p></div>
      <div class="now">
        <span class="big">${now ? fmt.temp(now.temp, state.units) : "–"}</span>
        <span class="sub">${now ? `H ${fmt.temp(now.max, state.units)}  L ${fmt.temp(now.min, state.units)}` : ""}</span>
      </div>
    </header>`;

  let body: string;
  if (!f) {
    body = `<p class="note">${refreshing.has(loc.id) ? "Loading…" : "No data yet. It will load next time you're online."}</p>`;
  } else if (!win) {
    body = `<p class="note">The saved forecast has run out. Connect to refresh.</p>`;
  } else {
    const sea = hasSea(f, win);
    body = `<div class="readout">${readout(f, win, null)}</div>
      <div class="chart"></div>
      ${sea ? legend(f) : ""}`;
  }

  const meta = `<footer class="meta">${
    refreshing.has(loc.id)
      ? "Updating…"
      : f
        ? `Updated ${fmt.age(f.fetchedAt)} <span class="dim">· ${fmt.capturedAt(f.fetchedAt)}</span>`
        : ""
  }</footer>`;

  card.innerHTML = tools + head + body + meta;
  card.classList.toggle("stale", !!f && nowSec() - f.fetchedAt > 6 * 3600);

  if (f && win) {
    const holder = $(".chart", card);
    const width = Math.max(240, Math.floor(holder.clientWidth || card.clientWidth - 32));
    const chart = buildChart(f, win, state.units, width);
    holder.innerHTML = chart.svg;
    const out = $(".readout", card);
    attachScrub($<SVGSVGElement>("svg", holder), chart, win, width, (i) => {
      out.innerHTML = readout(f, win, i);
      out.classList.toggle("active", i != null);
    });
  }
}

function currentConditions(f: Forecast, w: Window) {
  const t = nowSec();
  const i = w.idx;
  const a = f.hourly.temp[i];
  const b = f.hourly.temp[i + 1];
  const frac = Math.min(1, Math.max(0, (t - f.hourly.time[i]) / 3600));
  const temp = a != null && b != null ? a + (b - a) * frac : a;
  let d = f.daily.time.findIndex((dayStart, k) => t >= dayStart && t < (f.daily.time[k + 1] ?? dayStart + 86400));
  if (d < 0) d = 0;
  return { temp, max: f.daily.max[d], min: f.daily.min[d], pop: f.hourly.pop[i] };
}

function hasSea(f: Forecast, w: Window): boolean {
  return tideAt(f.tides, w.start) != null || f.hourly.time.slice(w.idx, w.idx + 24).some((t) => swellAt(f, t));
}

/** Line 1: weather. Line 2 (coastal places): tide and swell. `i` = scrubbed hour, or null. */
function readout(f: Forecast, w: Window, i: number | null): string {
  const lines = [i == null ? weatherSummary(f, w) : weatherAt(f, w.idx + i)];
  if (hasSea(f, w)) lines.push(i == null ? seaSummary(f, w) : seaAt(f, f.hourly.time[w.idx + i]));
  return lines.map((l) => `<p>${l || "&nbsp;"}</p>`).join("");
}

const dot = ` <span class="dim">·</span> `;

function weatherSummary(f: Forecast, w: Window): string {
  const pops = f.hourly.pop.slice(w.idx, w.idx + 24).map((p) => p ?? 0);
  const firstWet = pops.findIndex((p) => p >= 40);
  if (firstWet === 0) return `Rain likely now <span class="dim">· ${pops[0]}%</span>`;
  if (firstWet > 0) return `Rain likely from ${fmt.hour(f.hourly.time[w.idx + firstWet], f.tz)} <span class="dim">· ${pops[firstWet]}%</span>`;
  const max = Math.max(...pops);
  return max >= 10 ? `Rain chance ≤ ${max}% next 24h` : "Dry next 24h";
}

function weatherAt(f: Forecast, k: number): string {
  return [fmt.hour(f.hourly.time[k], f.tz), fmt.temp(f.hourly.temp[k], state.units), `${f.hourly.pop[k] ?? 0}% rain`].join(dot);
}

function seaSummary(f: Forecast, w: Window): string {
  const parts: string[] = [];
  const now = tideAt(f.tides, nowSec());
  if (now) parts.push(`Tide ${now.rising ? "rising" : "falling"}${now.mid ? ", mid" : ""}`);
  const swell = f.hourly.time.slice(w.idx, w.idx + 24).map((t) => swellAt(f, t)).filter((s) => s != null);
  if (swell.length) {
    const hs = swell.map((s) => s.height);
    const lo = Math.min(...hs), hi = Math.max(...hs);
    const range = fmt.length(lo, state.units) === fmt.length(hi, state.units)
      ? fmt.length(hi, state.units)
      : `${fmt.length(lo, state.units).replace(/ \w+$/, "")}–${fmt.length(hi, state.units)}`;
    const period = swell[0].period;
    parts.push(`Swell ${range}${period ? ` <span class="dim">@ ${Math.round(period)}s</span>` : ""}`);
  }
  return parts.join(dot);
}

function seaAt(f: Forecast, t: number): string {
  const parts: string[] = [];
  const tide = tideAt(f.tides, t);
  if (tide) parts.push(`Tide ${fmt.length(tide.level, state.units)} ${tide.rising ? "↑" : "↓"}${tide.mid ? " mid" : ""}`);
  const swell = swellAt(f, t);
  if (swell) parts.push(`Swell ${fmt.length(swell.height, state.units)}${swell.period ? ` <span class="dim">@ ${Math.round(swell.period)}s</span>` : ""}`);
  return parts.join(dot);
}

function legend(f: Forecast): string {
  const items: string[] = [];
  if (f.tides) items.push(`<span><i class="sw sw-rising"></i>Rising</span>`, `<span><i class="sw sw-mid"></i>Mid, rising</span>`);
  if (f.swell) items.push(`<span><i class="sw sw-swell"></i>Swell</span>`);
  const sources = [f.tideSource && `Tides: ${f.tideSource}`, f.swell?.source && `Swell: ${f.swell.source}`].filter(Boolean);
  return `<p class="legend">${items.join("")}</p>${sources.length ? `<p class="source">${sources.map((x) => `<span>${esc(x!)}</span>`).join(" · ")}${f.tideDatum === "MSL" ? " <span>(heights vs. mean sea level)</span>" : ""}</p>` : ""}`;
}

function renderStatus() {
  const el = $("#status");
  const busy = refreshing.size > 0;
  el.textContent = navigator.onLine ? "" : "Offline";
  $("#refresh").classList.toggle("busy", busy);
}

// ---------------------------------------------------------------- refreshing

async function refresh(loc: SavedLocation) {
  if (refreshing.has(loc.id)) return;
  refreshing.add(loc.id);
  lastAttempt.set(loc.id, nowSec());
  renderCard(loc);
  renderStatus();
  try {
    if (loc.tideStation === undefined) {
      // Looked up once per place; a failure leaves it undefined to retry next time.
      loc.tideStation = await findTideStation(loc.lat, loc.lon).catch(() => undefined);
    }
    const f = await fetchForecast(loc);
    // The location may have been removed while we were waiting.
    if (state.locations.some((l) => l.id === loc.id)) {
      state.forecasts[loc.id] = f;
      await saveState(state);
    }
  } catch (e) {
    console.warn(`refresh ${loc.name} failed`, e);
  } finally {
    refreshing.delete(loc.id);
    renderCard(loc);
    renderStatus();
  }
}

function refreshStale(force = false) {
  if (!navigator.onLine) return renderStatus();
  const t = nowSec();
  for (const loc of state.locations) {
    const f = state.forecasts[loc.id];
    const stale = !f || t - f.fetchedAt > STALE_AFTER_S;
    const recentlyTried = t - (lastAttempt.get(loc.id) ?? 0) < RETRY_AFTER_S;
    if (force || (stale && !recentlyTried)) void refresh(loc);
  }
}

// ---------------------------------------------------------------- editing

async function addPlace(p: PlaceResult) {
  const loc: SavedLocation = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: p.name,
    detail: p.detail,
    lat: Math.round(p.lat * 1e4) / 1e4,
    lon: Math.round(p.lon * 1e4) / 1e4,
  };
  state.locations.push(loc);
  await saveState(state);
  closeAdd();
  render();
  if (navigator.onLine) void refresh(loc);
}

async function removePlace(id: string) {
  const loc = state.locations.find((l) => l.id === id);
  if (!loc || !confirm(`Remove ${loc.name}?`)) return;
  state.locations = state.locations.filter((l) => l.id !== id);
  delete state.forecasts[id];
  if (state.locations.length === 0) editing = false;
  await saveState(state);
  render();
}

async function move(id: string, by: number) {
  const i = state.locations.findIndex((l) => l.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= state.locations.length) return;
  [state.locations[i], state.locations[j]] = [state.locations[j], state.locations[i]];
  await saveState(state);
  render();
}

// ---------------------------------------------------------------- add dialog

let searchTimer: number | undefined;
let searchSeq = 0;
let results: PlaceResult[] = [];

function openAdd() {
  const dlg = $<HTMLDialogElement>("#add");
  $<HTMLInputElement>("#q").value = "";
  $("#results").innerHTML = navigator.onLine ? "" : `<li class="hint">Offline: search needs a connection, but you can enter coordinates like “36.97, -122.03”.</li>`;
  dlg.showModal();
  $<HTMLInputElement>("#q").focus();
}

function closeAdd() {
  $<HTMLDialogElement>("#add").close();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  const q = $<HTMLInputElement>("#q").value.trim();
  if (q.length < 2) {
    $("#results").innerHTML = "";
    return;
  }
  searchTimer = window.setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const r = await searchPlaces(q);
      if (seq !== searchSeq) return;
      results = r;
      $("#results").innerHTML = r.length
        ? r.map((p, i) => `<li><button data-result="${i}"><span>${esc(p.name)}</span><span class="dim">${esc(p.detail)}</span></button></li>`).join("")
        : `<li class="hint">No matches.</li>`;
    } catch {
      if (seq !== searchSeq) return;
      $("#results").innerHTML = `<li class="hint">Couldn't search. Check your connection, or enter coordinates like “36.97, -122.03”.</li>`;
    }
  }, 300);
}

// ---------------------------------------------------------------- wiring

function wire() {
  document.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const btn = target.closest<HTMLElement>("[data-action]");
    const id = target.closest<HTMLElement>(".card")?.dataset.id;
    switch (btn?.dataset.action) {
      case "add":
        return openAdd();
      case "remove":
        return id && removePlace(id);
      case "up":
        return id && move(id, -1);
      case "down":
        return id && move(id, 1);
    }
    const result = target.closest<HTMLElement>("[data-result]");
    if (result) void addPlace(results[Number(result.dataset.result)]);
  });

  $("#units").addEventListener("click", async () => {
    state.units = state.units === "f" ? "c" : "f";
    await saveState(state);
    render();
  });
  $("#edit").addEventListener("click", () => {
    editing = !editing;
    render();
  });
  $("#refresh").addEventListener("click", () => refreshStale(true));
  $("#q").addEventListener("input", onSearchInput);
  $("#close").addEventListener("click", closeAdd);
  $("#add").addEventListener("click", (ev) => ev.target === ev.currentTarget && closeAdd());

  window.addEventListener("online", () => refreshStale());
  window.addEventListener("offline", renderStatus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      render();
      refreshStale();
    }
  });

  let resizeTimer: number | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 150);
  });

  // Keep "x minutes ago" and the chart's "now" honest, and catch
  // reconnects that don't fire an `online` event.
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (!document.querySelector(".readout.active")) render();
    refreshStale();
  }, 60 * 1000);
}

async function start() {
  state = await loadState();
  wire();
  render();
  refreshStale();
}

void start();
