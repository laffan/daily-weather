#!/usr/bin/env node
// Gives the DailyWeatherWidget target the same Apple development team as the
// app target in the generated Xcode project.
//
// Why: `tauri ios build/dev` writes DEVELOPMENT_TEAM into the app target
// (daily-weather_iOS) on every run, but never into other targets. The widget
// only gets a team if one was configured when `tauri ios init` ran, so
// without this Xcode fails with: Signing for "DailyWeatherWidget" requires a
// development team.
//
// Team ID is taken from, in order: $APPLE_DEVELOPMENT_TEAM,
// tauri.conf.json > bundle > iOS > developmentTeam, or the app target's
// existing DEVELOPMENT_TEAM. Safe to run repeatedly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appleDir = path.join(root, "src-tauri/gen/apple");
const WIDGET = "DailyWeatherWidget";

if (!fs.existsSync(appleDir)) {
  console.error("src-tauri/gen/apple not found. Run `npm run ios:init` first.");
  process.exit(1);
}
const proj = fs.readdirSync(appleDir).find((f) => f.endsWith(".xcodeproj"));
if (!proj) {
  console.error(`No .xcodeproj in ${appleDir}. Run \`npm run ios:init\` first.`);
  process.exit(1);
}
const pbxPath = path.join(appleDir, proj, "project.pbxproj");
let pbx = fs.readFileSync(pbxPath, "utf8");

/** Build-configuration ids of a target, from its XCConfigurationList. */
function configIds(target) {
  const list = pbx.match(
    new RegExp(`/\\* Build configuration list for PBXNativeTarget "${target}" \\*/ = \\{[^}]*?buildConfigurations = \\(([^)]*)\\)`),
  );
  return list ? [...list[1].matchAll(/([0-9A-F]{24})/g)].map((m) => m[1]) : [];
}

/** The `buildSettings = { ... };` block of a configuration (no nested braces in there). */
function settingsBlock(id) {
  const re = new RegExp(`(${id} /\\* [^*]+ \\*/ = \\{\\s*isa = XCBuildConfiguration;\\s*buildSettings = \\{)([^}]*)(\\};)`);
  const m = pbx.match(re);
  return m ? { re, m } : null;
}

function readTeam(target) {
  for (const id of configIds(target)) {
    const m = settingsBlock(id)?.m[2].match(/\bDEVELOPMENT_TEAM = "?([A-Z0-9]+)"?;/);
    if (m) return m[1];
  }
  return null;
}

function configTeam() {
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
    return conf.bundle?.iOS?.developmentTeam ?? null;
  } catch {
    return null;
  }
}

const appTarget = proj.replace(/\.xcodeproj$/, "") + "_iOS";
const team = process.env.APPLE_DEVELOPMENT_TEAM || configTeam() || readTeam(appTarget);
if (!team) {
  console.error(
    "No Apple development team found. Set it in src-tauri/tauri.conf.json under\n" +
      '  "bundle": { "iOS": { "developmentTeam": "ABCDE12345" } }\n' +
      "or export APPLE_DEVELOPMENT_TEAM. (Find your team ID with `npm run tauri info`\n" +
      "or at https://developer.apple.com/account under Membership details.)",
  );
  process.exit(1);
}

const ids = configIds(WIDGET);
if (!ids.length) {
  console.error(`Target ${WIDGET} not found in ${proj}. Delete src-tauri/gen/apple and run \`npm run ios:init\`.`);
  process.exit(1);
}

let changed = 0;
for (const id of ids) {
  const block = settingsBlock(id);
  if (!block) continue;
  const [, head, body, tail] = block.m;
  let next;
  if (/\bDEVELOPMENT_TEAM = [^;]*;/.test(body)) {
    next = body.replace(/\bDEVELOPMENT_TEAM = [^;]*;/, `DEVELOPMENT_TEAM = ${team};`);
  } else {
    const indent = body.match(/\n(\s+)\S/)?.[1] ?? "\t\t\t\t";
    next = `\n${indent}DEVELOPMENT_TEAM = ${team};` + body;
  }
  if (next !== body) {
    pbx = pbx.replace(block.re, () => head + next + tail);
    changed++;
  }
}

if (changed) {
  fs.writeFileSync(pbxPath, pbx);
  console.log(`${WIDGET}: development team set to ${team} (${changed} configuration${changed > 1 ? "s" : ""}).`);
} else {
  console.log(`${WIDGET}: development team already ${team}.`);
}
