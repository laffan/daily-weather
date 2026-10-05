# Daily Weather

A minimal weather app for a phone that is usually offline. It downloads a
7-day hourly forecast whenever a connection is available and keeps showing
it — in the app and in iOS widgets — when there isn't one, always with the
time the data was captured.

Built with [Tauri 2](https://v2.tauri.app) (TypeScript UI, Rust shell) plus a
native SwiftUI WidgetKit extension. Weather data comes from
[Open-Meteo](https://open-meteo.com) (free, no API key).

## What it does

- **Saved places.** Tap **+** to search by name, or type coordinates
  (`36.97, -122.03`; this works offline). **Edit** reorders or removes them.
- **One card per place**: current temperature, today's high/low, and a
  24-hour chart: temperature line on top, hourly rain-chance bars below,
  night shaded with sunrise/sunset times. Drag across the chart to read
  any hour.
- **Tides** for places near the coast: high/low marks on the chart and the next
  high and low tide times. A place counts as coastal when Open-Meteo's marine
  model has a sea grid cell within 25 km. The tide times come from that model's
  `sea_level_height_msl`, which is coarse and **not suitable for navigation**.
- **Automatic refresh**: on launch, when the app comes to the foreground, when
  the device comes back online, and every minute while open, any place whose
  data is older than 30 minutes is re-downloaded. Failures are silent, and the
  cached forecast stays on screen. Every card shows "Updated 3h ago · 9:41a".
  The **↻** button forces a refresh.
- **Widgets** (iOS 17+): small and medium home-screen widgets plus
  rectangular, circular and inline lock-screen widgets. Each one shows a place
  you choose (long-press → Edit Widget). Widgets display how old their data is,
  and they keep showing the current hour from the cached hourly forecast while
  offline. They also download fresh data on their own about every 30 minutes
  when a connection is available.

## Layout

```
src/                         UI (vanilla TypeScript + SVG, no framework)
  api.ts                     Open-Meteo forecast, marine (tides), geocoding
  chart.ts                   24-hour chart
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

`src-tauri/gen/` is generated and git-ignored. If you change the identifier,
the team, or `src-tauri/ios/project.yml`, delete `src-tauri/gen/apple` and run
`npm run ios:init` again.

**App Groups and signing.** Widgets can only see the app's data through the
App Group. App Groups are normally only available with a paid Apple Developer
Program membership, and Xcode's automatic signing registers the group the
first time you build. Without the group, the app still works on its own and
saves to its private data directory, but the widgets will show "Add a place in
Daily Weather".
