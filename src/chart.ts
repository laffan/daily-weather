// Two stacked 24-hour charts sharing one time axis:
//   1. weather — temperature line over hourly rain-chance bars
//   2. sea     — tide curve (rising tide tinted, highs/lows labelled) over
//                hourly swell bars on a fixed 0–5 ft scale; coastal places only
// Hour numbers sit between the two. Sunrise/sunset lines and the faint
// hour grid run through both. Each measure has its own band, so no chart
// needs a y-axis.

import * as fmt from "./format";
import type { Forecast, Tide, Units } from "./types";

export const HOURS = 24;

const PAD_X = 8;
const SUN_Y = 10;
const TEMP_TOP = 30;
const TEMP_BOTTOM = 64;
const RAIN_TOP = 80;
const RAIN_BOTTOM = 102;
const HOUR_Y = 117;
/** Everything below the hour row is shifted down from here. */
const SEA_TOP = 126;
const TIDE_TOP = 18; // offsets within the sea chart
const TIDE_BOTTOM = 52;
const TIDE_FLOOR = 60; // tint fills down to here so low water still shows a sliver
/** Swell bars are stacks of short lines, each worth half a foot; 10 lines = 5 ft (fixed scale). */
const SWELL_STEP_M = 0.5 / 3.28084;
const SWELL_LINES = 10;
const SWELL_LINE = 2; // px thick
const SWELL_GAP = 1; // px between lines
const SWELL_BOTTOM = 104;
const SWELL_TOP = SWELL_BOTTOM - SWELL_LINES * (SWELL_LINE + SWELL_GAP) + SWELL_GAP;

export interface Window {
  /** Unix seconds: 12 hours before today's local noon, so noon sits mid-chart. */
  start: number;
  /** Index into forecast.hourly of the first hour at or after `start`. */
  idx: number;
  /** Hours available from idx within the window (≤ HOURS + 1). */
  count: number;
  /** Index into forecast.hourly of the current hour. */
  nowIdx: number;
}

/** Today's chart window (local to the place), or null if the saved forecast doesn't cover now. */
export function forecastWindow(f: Forecast, nowSec = Date.now() / 1000): Window | null {
  const hours = f.hourly.time;
  const nowIdx = hours.findIndex((t) => t >= Math.floor(nowSec / 3600) * 3600);
  if (nowIdx < 0) return null;

  // Local noon today. Found by clock hour rather than midnight + 12 h so
  // daylight-saving days still centre on noon.
  const day = f.daily.time.findLast((d) => d <= nowSec) ?? f.daily.time[0];
  const noon = hours.find((t) => t >= day && t < day + 26 * 3600 && fmt.hour24(t, f.tz) === "12") ?? day + 12 * 3600;
  const start = noon - (HOURS / 2) * 3600;

  const idx = hours.findIndex((t) => t >= start);
  let count = 0;
  while (idx + count < hours.length && hours[idx + count] <= start + HOURS * 3600) count++;
  return count >= 2 ? { start, idx, count, nowIdx } : null;
}

// ---------------------------------------------------------------- tides

export interface TideState {
  /** Metres, same datum as the forecast's tides. */
  level: number;
  rising: boolean;
  /** In the middle third between the surrounding low and high. */
  mid: boolean;
}

/** Tide height between two turning points, using the usual cosine shape. */
export function tideAt(tides: Tide[] | null | undefined, t: number): TideState | null {
  if (!tides) return null;
  const j = tides.findIndex((x) => x.time > t);
  if (j <= 0) return null;
  const a = tides[j - 1];
  const b = tides[j];
  const p = (1 - Math.cos((Math.PI * (t - a.time)) / (b.time - a.time))) / 2; // 0 → 1
  return { level: a.height + (b.height - a.height) * p, rising: b.height > a.height, mid: p >= 1 / 3 && p <= 2 / 3 };
}

/** Swell reading for the hour starting at t. */
export function swellAt(f: Forecast, t: number): { height: number; period: number | null } | null {
  const s = f.swell;
  if (!s) return null;
  const i = s.time.indexOf(t);
  const h = i >= 0 ? s.height[i] : null;
  return h == null ? null : { height: h, period: s.period[i] ?? null };
}

// ---------------------------------------------------------------- chart

export interface Chart {
  svg: string;
  /** Per window hour: y of the temperature / tide curves (for the scrub dots). */
  tempY: (number | null)[];
  tideY: (number | null)[];
  bottom: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildChart(f: Forecast, w: Window, units: Units, width: number, nowSec = Date.now() / 1000): Chart {
  const end = w.start + HOURS * 3600;
  const plotW = width - 2 * PAD_X;
  const step = plotW / HOURS;
  const x = (t: number) => r1(PAD_X + ((t - w.start) / (end - w.start)) * plotW);
  const times = f.hourly.time.slice(w.idx, w.idx + w.count);
  const temps = f.hourly.temp.slice(w.idx, w.idx + w.count);
  const pops = f.hourly.pop.slice(w.idx, w.idx + w.count);

  const hasTides = !!f.tides && tideAt(f.tides, w.start) != null;
  const hasSwell = !!f.swell && times.some((t) => swellAt(f, t));
  const hasSea = hasTides || hasSwell;
  const seaTop = SEA_TOP + (hasTides ? 0 : -TIDE_FLOOR + 6);
  const bottom = hasSea ? seaTop + (hasSwell ? SWELL_BOTTOM : TIDE_FLOOR) : HOUR_Y + 5;

  const back: string[] = []; // grid, tints, sun lines
  const front: string[] = []; // data and labels

  // Hour grid + hour numbers (12-hour clock) between the charts.
  const labelEvery = step >= 12 ? 1 : 2;
  for (let i = 0; i <= HOURS; i++) {
    const t = w.start + i * 3600;
    const hx = x(t);
    const h12 = hour12(t, f.tz);
    const major = h12 === 12;
    const cls = major ? "grid major" : "grid";
    back.push(`<line class="${cls}" x1="${hx}" x2="${hx}" y1="${TEMP_TOP - 8}" y2="${RAIN_BOTTOM}"/>`);
    if (hasSea) back.push(`<line class="${cls}" x1="${hx}" x2="${hx}" y1="${seaTop + (hasTides ? TIDE_TOP - 8 : SWELL_TOP)}" y2="${bottom}"/>`);
    // On narrow screens label even hours only, so 12 always gets a number.
    if (i < HOURS && h12 % labelEvery === 0) {
      front.push(`<text class="hour${major ? " major" : ""}" x="${hx}" y="${HOUR_Y}" text-anchor="middle">${h12}</text>`);
    }
  }

  // Sunrise / sunset: a line through both charts, labelled at the top.
  for (let d = 0; d < f.daily.time.length; d++) {
    for (const [t, glyph] of [[f.daily.sunrise[d], "↑"], [f.daily.sunset[d], "↓"]] as const) {
      if (t <= w.start || t >= end) continue;
      const sx = x(t);
      const anchor = sx < 30 ? "start" : sx > width - 30 ? "end" : "middle";
      back.push(`<line class="sun-line" x1="${sx}" x2="${sx}" y1="${SUN_Y + 5}" y2="${HOUR_Y - 11}"/>`);
      if (hasSea) back.push(`<line class="sun-line" x1="${sx}" x2="${sx}" y1="${HOUR_Y + 5}" y2="${bottom}"/>`);
      front.push(`<text class="sun" x="${sx}" y="${SUN_Y}" text-anchor="${anchor}">${glyph} ${esc(fmt.clock(t, f.tz))}</text>`);
    }
  }

  // ---- weather chart

  const barW = Math.max(2, step - 2);
  pops.forEach((p, i) => {
    if (p == null || i >= HOURS || p <= 0) return;
    const h = Math.max(1.5, (p / 100) * (RAIN_BOTTOM - RAIN_TOP));
    front.push(`<rect class="rain" x="${r1(x(times[i]) + (step - barW) / 2)}" y="${r1(RAIN_BOTTOM - h)}" width="${r1(barW)}" height="${r1(h)}" rx="1"/>`);
  });
  front.push(`<line class="base" x1="${PAD_X}" x2="${width - PAD_X}" y1="${RAIN_BOTTOM + 0.5}" y2="${RAIN_BOTTOM + 0.5}"/>`);

  const peak = pops.reduce<number>((best, p, i) => (p != null && i < HOURS && p > (pops[best] ?? -1) ? i : best), 0);
  if ((pops[peak] ?? 0) >= 10) {
    const top = RAIN_BOTTOM - ((pops[peak] ?? 0) / 100) * (RAIN_BOTTOM - RAIN_TOP);
    front.push(`<text class="label minor" x="${clampX(x(times[peak]) + step / 2, width)}" y="${r1(top - 3)}" text-anchor="middle">${pops[peak]}%</text>`);
  }

  let tempY: (number | null)[] = times.map(() => null);
  const valid = temps.filter((v): v is number => v != null);
  if (valid.length >= 2) {
    const lo = Math.min(...valid);
    const hi = Math.max(...valid);
    const span = Math.max(hi - lo, 4); // keep flat days from looking dramatic
    const base = (hi + lo) / 2 - span / 2;
    const y = (v: number) => r1(TEMP_BOTTOM - ((v - base) / span) * (TEMP_BOTTOM - TEMP_TOP));
    tempY = temps.map((v) => (v == null ? null : y(v)));
    front.push(`<path class="temp" d="${smoothPath(times.map((t, i) => (tempY[i] == null ? null : [x(t), tempY[i]!])))}"/>`);
    const hiI = temps.indexOf(hi);
    const loI = temps.indexOf(lo);
    if (hiI !== loI) {
      front.push(`<text class="label" x="${clampX(x(times[hiI]), width)}" y="${y(hi) - 6}" text-anchor="middle">${fmt.temp(hi, units)}</text>`);
      front.push(`<text class="label" x="${clampX(x(times[loI]), width)}" y="${y(lo) + 14}" text-anchor="middle">${fmt.temp(lo, units)}</text>`);
    }
  }

  // ---- sea chart

  let tideY: (number | null)[] = times.map(() => null);
  if (hasTides) {
    const tides = f.tides!;
    // Sample every 10 minutes for a smooth curve and crisp tint edges.
    const samples: { t: number; s: TideState }[] = [];
    for (let t = w.start; t <= end; t += 600) {
      const s = tideAt(tides, t);
      if (s) samples.push({ t, s });
    }
    const turning = tides.filter((x) => x.time >= w.start && x.time <= end);
    const levels = samples.map((p) => p.s.level).concat(turning.map((x) => x.height));
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const span = Math.max(hi - lo, 0.5);
    const top = seaTop + TIDE_TOP;
    const bot = seaTop + TIDE_BOTTOM;
    const y = (v: number) => r1(bot - ((v - lo) / span) * (bot - top));
    const floor = seaTop + TIDE_FLOOR;

    // Tint under the curve wherever the tide is rising.
    {
      const test = (s: TideState) => s.rising;
      let run: { t: number; s: TideState }[] = [];
      const flush = () => {
        if (run.length >= 2) {
          const pts = run.map((p) => `${x(p.t)},${y(p.s.level)}`).join(" ");
          back.push(`<polygon class="tint-rising" points="${x(run[0].t)},${floor} ${pts} ${x(run[run.length - 1].t)},${floor}"/>`);
        }
        run = [];
      };
      samples.forEach((p, k) => {
        if (test(p.s)) {
          // Include the previous sample so adjacent runs meet without a gap.
          if (!run.length && k > 0) run.push(samples[k - 1]);
          run.push(p);
        } else if (run.length) {
          run.push(p);
          flush();
        }
      });
      flush();
    }

    front.push(`<polyline class="tide" points="${samples.map((p) => `${x(p.t)},${y(p.s.level)}`).join(" ")}"/>`);
    tideY = times.map((t) => {
      const s = tideAt(tides, t);
      return s ? y(s.level) : null;
    });

    for (const tide of turning) {
      const tx = clampX(x(tide.time), width, 16);
      const ty = tide.kind === "high" ? y(tide.height) - 6 : y(tide.height) + 13;
      front.push(`<circle class="tide-point" cx="${x(tide.time)}" cy="${y(tide.height)}" r="2.5"/>`);
      front.push(`<text class="label minor" x="${tx}" y="${ty}" text-anchor="middle">${esc(fmt.clock(tide.time, f.tz))}</text>`);
    }
  }

  if (hasSwell) {
    const heights = times.slice(0, HOURS).map((t) => swellAt(f, t)?.height ?? 0);
    const sBot = seaTop + SWELL_BOTTOM;
    const lines = (h: number) => (h <= 0 ? 0 : Math.min(SWELL_LINES, Math.max(1, Math.round(h / SWELL_STEP_M))));
    let d = "";
    heights.forEach((h, i) => {
      const bx = r1(x(times[i]) + (step - barW) / 2);
      for (let k = 0; k < lines(h); k++) {
        d += `M${bx},${sBot - k * (SWELL_LINE + SWELL_GAP) - SWELL_LINE}h${r1(barW)}v${SWELL_LINE}h${-r1(barW)}z`;
      }
    });
    front.push(`<path class="swell" d="${d}"/>`);
    front.push(`<line class="base" x1="${PAD_X}" x2="${width - PAD_X}" y1="${sBot + 0.5}" y2="${sBot + 0.5}"/>`);
    const pk = heights.indexOf(Math.max(...heights));
    if (heights[pk] > 0) {
      const top = sBot - lines(heights[pk]) * (SWELL_LINE + SWELL_GAP) + SWELL_GAP;
      front.push(`<text class="label minor" x="${clampX(x(times[pk]) + step / 2, width)}" y="${r1(top - 4)}" text-anchor="middle">${fmt.length(heights[pk], units)}</text>`);
    }
  }

  // Current time, through both charts.
  if (nowSec >= w.start && nowSec <= end) {
    const nx = x(nowSec);
    front.push(`<line class="now-line" x1="${nx}" x2="${nx}" y1="${TEMP_TOP - 8}" y2="${RAIN_BOTTOM}"/>`);
    if (hasSea) front.push(`<line class="now-line" x1="${nx}" x2="${nx}" y1="${seaTop + (hasTides ? TIDE_TOP - 8 : SWELL_TOP)}" y2="${bottom}"/>`);
  }

  // Scrub cursor (positioned by attachScrub).
  const cursor = `<g class="cursor" visibility="hidden"><line x1="0" x2="0" y1="${TEMP_TOP - 8}" y2="${bottom}"/>` +
    `<circle class="c-temp" r="3.5" cx="0" cy="-20"/><circle class="c-tide" r="3.5" cx="0" cy="-20"/></g>`;

  const h = bottom + 4;
  const svg = `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Next 24 hours: temperature, chance of rain${hasSea ? ", tide and swell" : ""}">${back.join("")}${front.join("")}${cursor}</svg>`;
  return { svg, tempY, tideY, bottom };
}

function hour12(t: number, tz: string): number {
  const h = Number(fmt.hour24(t, tz)) % 12;
  return h === 0 ? 12 : h;
}

function clampX(v: number, width: number, margin = 14): number {
  return Math.min(Math.max(v, margin), width - margin);
}

/** Monotone cubic (Fritsch–Carlson) so the curve never overshoots the data. Gaps break the path. */
function smoothPath(pts: ([number, number] | null)[]): string {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
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
        path += `C${r1(r[i][0] + dx)},${r1(r[i][1] + m[i] * dx)} ${r1(r[i + 1][0] - dx)},${r1(r[i + 1][1] - m[i + 1] * dx)} ${r[i + 1][0]},${r[i + 1][1]}`;
      }
      return path;
    })
    .join("");
}

/**
 * Touch/drag across either chart to read exact values. `onReadout` receives
 * the hovered hour's index into forecast.hourly, or null when the finger lifts.
 */
export function attachScrub(svg: SVGSVGElement, chart: Chart, f: Forecast, w: Window, width: number, onReadout: (k: number | null) => void) {
  const cursor = svg.querySelector<SVGGElement>(".cursor")!;
  const line = cursor.querySelector("line")!;
  const dotTemp = cursor.querySelector<SVGCircleElement>(".c-temp")!;
  const dotTide = cursor.querySelector<SVGCircleElement>(".c-tide")!;
  const step = (width - 2 * PAD_X) / HOURS;

  const move = (ev: PointerEvent) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    const slot = Math.max(0, Math.min(HOURS, Math.round((px - PAD_X) / step)));
    const k = f.hourly.time.indexOf(w.start + slot * 3600);
    if (k < 0) return; // no data for that hour (e.g. start of a daylight-saving day)
    const i = k - w.idx;
    const cx = String(PAD_X + slot * step);
    line.setAttribute("x1", cx);
    line.setAttribute("x2", cx);
    for (const [dot, ys] of [[dotTemp, chart.tempY], [dotTide, chart.tideY]] as const) {
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", String(ys[i] ?? -20));
    }
    cursor.setAttribute("visibility", "visible");
    onReadout(k);
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
