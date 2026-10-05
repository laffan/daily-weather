# Daily Weather

A minimal weather app for a phone that is usually offline. It downloads a
7-day hourly forecast whenever a connection is available and keeps showing
it — in the app and in iOS widgets — when there isn't one, always with the
time the data was captured.

Built with [Tauri 2](https://v2.tauri.app) (TypeScript UI, Rust shell) plus a
native SwiftUI WidgetKit extension. All data sources are free and need no API key:

| Data | Source |
|---|---|
| Temperature, rain chance, sunrise/sunset | [Open-Meteo forecast API](https://open-meteo.com/en/docs) |
| Tides (US) | [NOAA CO-OPS](https://api.tidesandcurrents.noaa.gov/api/prod/) high/low predictions from the nearest station within 30 km |
| Tides (elsewhere) | Open-Meteo marine model (`sea_level_height_msl`); coarse, not for navigation |
| Swell | NOAA GFS-Wave (WAVEWATCH III) via the [Open-Meteo marine API](https://open-meteo.com/en/docs/marine-weather-api) (`models=ncep_gfswave025`), falling back to Open-Meteo's default wave model |

## What it does

- **Saved places.** Tap **+** to search by name, or type coordinates
  (`36.97, -122.03`; this works offline). **Edit** shows ↑/↓ to reorder and a
  **Remove** button under each card (tap it twice to confirm).
- **One card per place**: current temperature, today's high/low, and two
  stacked charts covering today (local midnight to midnight, noon centred)
  that share a time axis:
  1. **Weather**: a temperature line over hourly rain-chance bars.
  2. **Sea** (coastal places only): the tide curve with high and low tides
     marked and timed, with the rising tide lightly tinted, over hourly
     swell bars. Swell uses a fixed 0–5 ft scale, and each bar is a stack of
     short gray lines worth half a foot each (taller swell fills the stack, and
     the peak is labelled with its real height).

  Hour numbers (12-hour clock) sit between the two charts, with a faint grid
  line for every hour and noon/midnight emphasised. A red line marks the
  current time, and dotted sunrise and sunset lines run through both charts.
  One-line summaries ("Rain likely from 9a", "Tide rising · Swell 2–4 ft @ 13s")
  sit under the charts. Drag across either chart to read that hour's
  temperature, rain chance, tide height and direction, and swell height and
  period in place of the card header.
- **Five-day outlook** under the charts: each of the next five days with its
  high, low and peak hourly rain chance (shown when 20% or more).
- **Coastal detection**: a place counts as coastal when it has a NOAA tide
  station within 30 km, or when Open-Meteo's marine model has a sea grid cell
  within 25 km. The tide station is looked up once per place.
- **Automatic refresh**: on launch, when the app comes to the foreground, when
  the device comes back online, and every minute while open, any place whose
  data is older than 30 minutes is re-downloaded. Failures are silent, and the
  cached forecast stays on screen. Every card shows "Updated 3h ago · 9:41a".
  The **↻** button forces a refresh.
- **Widgets** (iOS 17+), in two kinds:
  - *Daily Weather*: small and medium home-screen widgets, plus rectangular,
    circular and inline lock-screen widgets.
  - *Daily Weather Forecast*: a medium widget with now plus the five-day
    outlook, a large widget that adds the hourly chart, and a rectangular
    lock-screen widget with the next three days. Each one shows a place
  you choose (long-press → Edit Widget). Widgets display how old their data is,
  and they keep showing the current hour from the cached hourly forecast while
  offline. They also download fresh data on their own about every 30 minutes
  when a connection is available.

## Layout

```
src/                         UI (vanilla TypeScript + SVG, no framework)
  api.ts                     Open-Meteo forecast/marine/geocoding, NOAA tides
  chart.ts                   stacked 24-hour weather + sea charts
  store.ts                   persistence (Tauri file, or localStorage in a browser)
src-tauri/
  src/lib.rs                 load_state / save_state commands
  ios/project.yml            Xcode project template (Tauri's stock one + widget + App Group)
  ios/App/                   Swift bridge: App Group path, WidgetCenter reload
  ios/DailyWeatherWidget/    WidgetKit extension (SwiftUI + Swift Charts)
```

The app writes `state.json` (places, units, forecasts) into an App Group
container that the widget can also read. The widget writes whatever it
downloads to `widget.json` in the same container, and the app picks up those
forecasts when they are newer than its own. The JSON shape is defined in
`src/types.ts` and mirrored in `Model.swift`.

## Running it

UI only, in a browser (uses localStorage):

```sh
npm install
npm run dev            # http://localhost:1420
```

Desktop window: `npm run tauri dev`.

### iPhone

You need macOS, Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen)
(`brew install xcodegen`), Rust with the iOS targets, and the
[Tauri iOS prerequisites](https://v2.tauri.app/start/prerequisites/#ios).

1. **Set your identifiers.** In `src-tauri/tauri.conf.json`, change
   `identifier` (`com.laffan.dailyweather`) to something you own, and add
   your team ID under `bundle.iOS.developmentTeam`. You can also export
   `APPLE_DEVELOPMENT_TEAM` instead. The widget gets `<identifier>.widget`,
   and the shared App Group is `group.<identifier>`.
2. **Generate the Xcode project** from the repo root:
   ```sh
   npm install
   npm run ios:init       # tauri ios init (uses src-tauri/ios/project.yml) + app icons
   ```
3. **Run on a device**: `npm run ios:dev`, or open the project with
   `npm run tauri ios dev -- --open` and run it from Xcode. For a release
   build, use `npm run ios:build`.
4. **Add widgets**: long-press the home screen or lock screen, tap **+**, and
   search for "Daily Weather".

Use the `npm run ios:*` scripts rather than `npm run tauri ios …` directly.
Tauri only writes your development team into the app target, so these scripts
first run `scripts/ios-widget-team.mjs`, which copies the team onto the widget
target. Without it, Xcode fails with *Signing for "DailyWeatherWidget" requires a
development team*. You can also run it on its own with `npm run ios:team`, for
example before building from Xcode.

**Xcode 27:** `swift-rs` 1.0.8, which Tauri uses, fails to link on Xcode 27
([swift-rs#81](https://github.com/Brendonovich/swift-rs/issues/81)).
`src-tauri/Cargo.toml` pins a fork with the fix, and `.cargo/config.toml` turns it
on. Remove both once a fixed `swift-rs` is released.

`src-tauri/gen/` is generated and git-ignored. If you change the identifier,
the team, or `src-tauri/ios/project.yml`, delete `src-tauri/gen/apple` and run
`npm run ios:init` again.

**App Groups and signing.** Widgets can only see the app's data through the
App Group. App Groups are normally only available with a paid Apple Developer
Program membership, and Xcode's automatic signing registers the group the
first time you build. Without the group, the app still works on its own and
saves to its private data directory, but the widgets will show "Add a place in
Daily Weather".
