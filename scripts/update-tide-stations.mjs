#!/usr/bin/env node
// Rebuilds src/noaa-tide-stations.json from NOAA's list of tide-prediction
// stations: [[id, name, lat, lon], ...]. Run occasionally (NOAA adds and
// retires stations rarely):  node scripts/update-tide-stations.mjs
//
// The initial copy was extracted from the openwatersio/slackwater-database
// mirror of the same NOAA list (public-domain NOAA records).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/noaa-tide-stations.json");

const res = await fetch(URL, { headers: { "User-Agent": "DailyWeather/0.1 (station list update)" } });
if (!res.ok) throw new Error(`NOAA returned HTTP ${res.status}`);
const { stations } = await res.json();
if (!Array.isArray(stations) || stations.length < 1000) {
  throw new Error(`Unexpected response: ${stations?.length ?? 0} stations. Not overwriting ${out}.`);
}

const rows = stations
  .filter((s) => s.id && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)))
  .map((s) => [String(s.id), String(s.name), +Number(s.lat).toFixed(4), +Number(s.lng).toFixed(4)])
  .sort((a, b) => a[0].localeCompare(b[0]));

fs.writeFileSync(out, JSON.stringify(rows));
console.log(`Wrote ${rows.length} stations to ${path.relative(process.cwd(), out)}`);
