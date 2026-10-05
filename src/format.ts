import type { Units } from "./types";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat(undefined, opts); // unknown zone: fall back to device time
    }
    formatters.set(key, f);
  }
  return f;
}

/** "7:05a" / "19:05" — clock time at the location. */
export function clock(unix: number, tz: string): string {
  return compactMeridiem(formatter(tz, { hour: "numeric", minute: "2-digit" }).format(unix * 1000));
}

/** "3p" / "15" — hour at the location, for axis labels. */
export function hour(unix: number, tz: string): string {
  return compactMeridiem(formatter(tz, { hour: "numeric" }).format(unix * 1000));
}

/** "Mon" — weekday at the location. */
export function weekday(unix: number, tz: string): string {
  return formatter(tz, { weekday: "short" }).format(unix * 1000);
}

function compactMeridiem(s: string): string {
  return s.replace(/\s?([AaPp])\.?\s?[Mm]\.?/, (_, m: string) => m.toLowerCase());
}

export function temp(celsius: number | null | undefined, units: Units): string {
  if (celsius == null) return "–";
  const v = units === "f" ? celsius * 1.8 + 32 : celsius;
  return `${Math.round(v)}°`;
}

/** "just now", "12m ago", "3h ago", "2d ago" */
export function age(unix: number, nowMs = Date.now()): string {
  const s = Math.max(0, nowMs / 1000 - unix);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Absolute capture time in the device's own zone: "9:41a" today, "Mon 9:41a" otherwise. */
export function capturedAt(unix: number): string {
  const d = new Date(unix * 1000);
  const time = compactMeridiem(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}
