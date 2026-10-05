// 24-hour chart: temperature line on top, rain-chance bars in their own lane
// underneath (separate scales, shared time axis), night shaded so sunrise and
// sunset read at a glance, and high/low tide ticks when the place is coastal.

import * as fmt from "./format";
import type { Forecast, Units } from "./types";

export const HOURS = 24;

const PAD_X = 10;
const SUN_Y = 10;
const TEMP_TOP = 30;
const TEMP_BOTTOM = 72;
const RAIN_TOP = 94;
const RAIN_BOTTOM = 120;
const TIDE_Y = 136;

export interface Window {
  start: number; // unix seconds, top of the current hour
  idx: number; // index into forecast.hourly of `start`
  count: number; // hours available from idx (≤ HOURS + 1)
}

export function forecastWindow(f: Forecast, nowSec = Date.now() / 1000): Window | null {
  const start = Math.floor(nowSec / 3600) * 3600;
  const idx = f.hourly.time.findIndex((t) => t >= start);
  if (idx < 0) return null;
  const count = Math.min(HOURS + 1, f.hourly.time.length - idx);
  return count >= 2 ? { start: f.hourly.time[idx], idx, count } : null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderChart(f: Forecast, w: Window, units: Units, width: number): string {
  const end = w.start + HOURS * 3600;
  const x = (t: number) => PAD_X + ((t - w.start) / (end - w.start)) * (width - 2 * PAD_X);
  const times = f.hourly.time.slice(w.idx, w.idx + w.count);
  const temps = f.hourly.temp.slice(w.idx, w.idx + w.count);
  const pops = f.hourly.pop.slice(w.idx, w.idx + w.count);

  const hasTides = f.tides != null;
  const AXIS_Y = hasTides ? 154 : 138;
  const H = AXIS_Y + 4;
  const parts: string[] = [];

  // Night shading, bounded by sunset → next sunrise.
  for (let d = 0; d < f.daily.time.length; d++) {
    const nightStart = d === 0 ? -Infinity : f.daily.sunset[d - 1];
    const nightEnd = f.daily.sunrise[d];
    shade(nightStart, nightEnd);
  }
  const last = f.daily.time.length - 1;
  if (last >= 0) shade(f.daily.sunset[last], Infinity);

  function shade(a: number, b: number) {
    const x0 = x(Math.max(a, w.start));
    const x1 = x(Math.min(b, end));
    if (x1 <= x0) return;
    parts.push(`<rect class="night" x="${x0}" y="0" width="${x1 - x0}" height="${RAIN_BOTTOM}"/>`);
  }

  // Sunrise / sunset labels at the shading edges.
  for (let d = 0; d < f.daily.time.length; d++) {
    for (const [t, glyph] of [[f.daily.sunrise[d], "↑"], [f.daily.sunset[d], "↓"]] as const) {
      if (t <= w.start || t >= end) continue;
      const cx = x(t);
      const anchor = cx < 30 ? "start" : cx > width - 30 ? "end" : "middle";
      parts.push(`<text class="sun" x="${cx}" y="${SUN_Y}" text-anchor="${anchor}">${glyph} ${esc(fmt.clock(t, f.tz))}</text>`);
    }
  }

  // Rain-chance bars (0–100 % → lane height).
  const step = (width - 2 * PAD_X) / HOURS;
  const barW = Math.max(2, step - 2);
  pops.forEach((p, i) => {
    if (p == null || i >= HOURS) return;
    const h = Math.max(p > 0 ? 1.5 : 0, (p / 100) * (RAIN_BOTTOM - RAIN_TOP));
    if (h === 0) return;
    const bx = x(times[i]) + (step - barW) / 2;
    parts.push(`<rect class="rain" x="${bx}" y="${RAIN_BOTTOM - h}" width="${barW}" height="${h}" rx="1"/>`);
  });
  parts.push(`<line class="base" x1="${PAD_X}" x2="${width - PAD_X}" y1="${RAIN_BOTTOM + 0.5}" y2="${RAIN_BOTTOM + 0.5}"/>`);

  // Peak rain chance, labelled once.
  const peak = pops.reduce<number>((best, p, i) => (p != null && i < HOURS && p > (pops[best] ?? -1) ? i : best), 0);
  if ((pops[peak] ?? 0) >= 10) {
    const px = x(times[peak]) + step / 2;
    const top = RAIN_BOTTOM - ((pops[peak] ?? 0) / 100) * (RAIN_BOTTOM - RAIN_TOP);
    parts.push(`<text class="label rain-label" x="${clampX(px, width)}" y="${top - 3}" text-anchor="middle">${pops[peak]}%</text>`);
  }

  // Temperature line.
  const valid = temps.filter((v): v is number => v != null);
  if (valid.length >= 2) {
    const lo = Math.min(...valid);
    const hi = Math.max(...valid);
    const span = Math.max(hi - lo, 4); // keep flat days from looking dramatic
    const mid = (hi + lo) / 2;
    const y = (v: number) => TEMP_BOTTOM - ((v - (mid - span / 2)) / span) * (TEMP_BOTTOM - TEMP_TOP);
    const pts = times.map((t, i) => (temps[i] == null ? null : ([x(t), y(temps[i]!)] as const)));
    parts.push(`<path class="temp" d="${smoothPath(pts)}"/>`);

    const hiI = temps.indexOf(hi);
    const loI = temps.indexOf(lo);
    if (hiI !== loI) {
      parts.push(`<text class="label" x="${clampX(x(times[hiI]), width)}" y="${y(hi) - 6}" text-anchor="middle">${fmt.temp(hi, units)}</text>`);
      parts.push(`<text class="label" x="${clampX(x(times[loI]), width)}" y="${y(lo) + 14}" text-anchor="middle">${fmt.temp(lo, units)}</text>`);
    }
  }

  // Tides.
  for (const tide of f.tides ?? []) {
    if (tide.time < w.start || tide.time > end) continue;
    const tx = x(tide.time);
    parts.push(`<text class="tide" x="${clampX(tx, width, 6)}" y="${TIDE_Y + 4}" text-anchor="middle">${tide.kind === "high" ? "H" : "L"}</text>`);
  }

  // Time axis, every 6 h.
  for (let i = 0; i <= HOURS; i += 6) {
    const t = w.start + i * 3600;
    const label = i === 0 ? "Now" : fmt.hour(t, f.tz);
    const anchor = i === 0 ? "start" : i === HOURS ? "end" : "middle";
    parts.push(`<text class="axis" x="${x(t)}" y="${AXIS_Y}" text-anchor="${anchor}">${esc(label)}</text>`);
  }

  // Scrub cursor (positioned by attachScrub).
  parts.push(`<g class="cursor" visibility="hidden"><line x1="0" x2="0" y1="${TEMP_TOP - 12}" y2="${RAIN_BOTTOM}"/><circle r="3.5" cx="0" cy="0"/></g>`);

  return `<svg viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img" aria-label="Next 24 hours: temperature and chance of rain">${parts.join("")}</svg>`;
}

function clampX(v: number, width: number, margin = 14): number {
  return Math.min(Math.max(v, margin), width - margin);
}

/** Monotone cubic (Fritsch–Carlson) so the curve never overshoots the data. Gaps break the path. */
function smoothPath(pts: (readonly [number, number] | null)[]): string {
  const runs: (readonly [number, number])[][] = [];
  let run: (readonly [number, number])[] = [];
  for (const p of pts) {
    if (p) run.push(p);
    else if (run.length) (runs.push(run), (run = []));
  }
  if (run.length) runs.push(run);

  return runs
    .map((r) => {
      if (r.length === 1) return `M${r[0][0]},${r[0][1]}`;
      const n = r.length;
      const d = r.slice(1).map((p, i) => (p[1] - r[i][1]) / (p[0] - r[i][0]));
      const m = r.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
      for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) {
          m[i] = m[i + 1] = 0;
          continue;
        }
        const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
        if (s > 9) {
          const t = 3 / Math.sqrt(s);
          m[i] = t * a * d[i];
          m[i + 1] = t * b * d[i];
        }
      }
      let path = `M${r[0][0]},${r[0][1]}`;
      for (let i = 0; i < n - 1; i++) {
        const dx = (r[i + 1][0] - r[i][0]) / 3;
        path += `C${r[i][0] + dx},${r[i][1] + m[i] * dx} ${r[i + 1][0] - dx},${r[i + 1][1] - m[i + 1] * dx} ${r[i + 1][0]},${r[i + 1][1]}`;
      }
      return path;
    })
    .join("");
}

/**
 * Touch/drag across the chart to read exact values. `onReadout` receives the
 * hovered hour's index into the window, or null when the finger lifts.
 */
export function attachScrub(svg: SVGSVGElement, w: Window, width: number, onReadout: (i: number | null) => void) {
  const cursor = svg.querySelector<SVGGElement>(".cursor")!;
  const line = cursor.querySelector("line")!;
  const dot = cursor.querySelector("circle")!;
  const path = svg.querySelector<SVGPathElement>(".temp");
  const step = (width - 2 * PAD_X) / HOURS;

  const move = (ev: PointerEvent) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(w.count - 1, Math.round((px - PAD_X) / step)));
    const cx = PAD_X + i * step;
    line.setAttribute("x1", String(cx));
    line.setAttribute("x2", String(cx));
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(path ? yOnPath(path, cx) : -10));
    cursor.setAttribute("visibility", "visible");
    onReadout(i);
  };
  const leave = () => {
    cursor.setAttribute("visibility", "hidden");
    onReadout(null);
  };
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointermove", (ev) => (ev.pointerType === "mouse" || ev.buttons) && move(ev));
  svg.addEventListener("pointerup", (ev) => ev.pointerType !== "mouse" && leave());
  svg.addEventListener("pointercancel", leave);
  svg.addEventListener("pointerleave", leave);
}

function yOnPath(path: SVGPathElement, targetX: number): number {
  // Binary search along the path length for the point at targetX.
  let lo = 0, hi = path.getTotalLength();
  for (let k = 0; k < 20; k++) {
    const midLen = (lo + hi) / 2;
    if (path.getPointAtLength(midLen).x < targetX) lo = midLen;
    else hi = midLen;
  }
  return path.getPointAtLength(hi).y;
}
