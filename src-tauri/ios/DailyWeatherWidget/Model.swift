import Foundation

// MARK: - Shared data model (mirrors src/types.ts)

struct TideStation: Codable, Hashable {
    let id: String
    let name: String
}

struct SavedLocation: Codable, Hashable {
    let id: String
    let name: String
    let detail: String
    let lat: Double
    let lon: Double
    /// Nearest NOAA tide station, looked up by the app (nil = none or not yet known).
    let tideStation: TideStation?
}

struct Tide: Codable {
    let time: Double
    let kind: String // "high" | "low"
    let height: Double
}

struct Forecast: Codable {
    struct Hourly: Codable {
        let time: [Double]
        let temp: [Double?]
        let pop: [Double?]
    }
    struct Daily: Codable {
        let time: [Double]
        let sunrise: [Double]
        let sunset: [Double]
        let max: [Double?]
        let min: [Double?]
    }
    struct Swell: Codable {
        let time: [Double]
        let height: [Double?]
        let period: [Double?]
        let source: String
    }
    let fetchedAt: Double
    let tz: String
    let hourly: Hourly
    let daily: Daily
    let tides: [Tide]?
    let tideDatum: String?
    let tideSource: String?
    let swell: Swell?

    var fetchedDate: Date { Date(timeIntervalSince1970: fetchedAt) }
    var timeZone: TimeZone { TimeZone(identifier: tz) ?? .current }
}

struct AppState: Codable {
    var version: Int
    var units: String
    var locations: [SavedLocation]
    var forecasts: [String: Forecast]
}

/// Forecasts the widget downloaded itself. The app adopts any that are newer than its own.
struct WidgetCache: Codable {
    var forecasts: [String: Forecast]
}

// MARK: - App Group storage

enum SharedStore {
    private static var directory: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "DWAppGroup") as? String else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }

    private static func read<T: Decodable>(_ type: T.Type, _ file: String) -> T? {
        guard let url = directory?.appendingPathComponent(file),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func state() -> AppState? { read(AppState.self, "state.json") }

    static func widgetCache() -> WidgetCache { read(WidgetCache.self, "widget.json") ?? WidgetCache(forecasts: [:]) }

    /// The newest forecast for a place, whether the app or the widget fetched it.
    static func forecast(for id: String, state: AppState?) -> Forecast? {
        let fromApp = state?.forecasts[id]
        let fromWidget = widgetCache().forecasts[id]
        switch (fromApp, fromWidget) {
        case let (a?, w?): return w.fetchedAt > a.fetchedAt ? w : a
        case let (a, w): return a ?? w
        }
    }

    static func saveWidgetForecast(_ forecast: Forecast, for id: String, keeping ids: Set<String>) {
        guard let url = directory?.appendingPathComponent("widget.json") else { return }
        var cache = widgetCache()
        cache.forecasts[id] = forecast
        cache.forecasts = cache.forecasts.filter { ids.contains($0.key) } // drop removed places
        if let data = try? JSONEncoder().encode(cache) {
            try? data.write(to: url, options: .atomic)
        }
    }
}

// MARK: - Fetching (Swift port of src/api.ts)

enum WeatherAPI {
    private static let forecastDays = 7
    private static let coastMaxKm = 25.0
    private static let swellMaxKm = 50.0
    private static let minTidalRange = 0.1

    private struct OMForecast: Decodable {
        struct H: Decodable {
            let time: [Double]
            let temperature_2m: [Double?]
            let precipitation_probability: [Double?]
        }
        struct D: Decodable {
            let time: [Double]
            let sunrise: [Double]
            let sunset: [Double]
            let temperature_2m_max: [Double?]
            let temperature_2m_min: [Double?]
        }
        let timezone: String
        let hourly: H
        let daily: D
    }

    private struct OMMarine: Decodable {
        struct H: Decodable {
            let time: [Double]
            let sea_level_height_msl: [Double?]?
            let swell_wave_height: [Double?]?
            let swell_wave_period: [Double?]?
        }
        let latitude: Double
        let longitude: Double
        let hourly: H?
    }

    private struct NOAAPredictions: Decodable {
        struct P: Decodable {
            let t: String
            let v: String
            let type: String
        }
        let predictions: [P]?
    }

    private static func get<T: Decodable>(_ type: T.Type, _ base: String, _ query: [String: String]) async throws -> T {
        var comps = URLComponents(string: base)!
        comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        let request = URLRequest(url: comps.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(type, from: data)
    }

    static func fetch(_ loc: SavedLocation) async throws -> Forecast {
        let common = [
            "latitude": String(loc.lat),
            "longitude": String(loc.lon),
            "timezone": "auto",
            "timeformat": "unixtime",
            "forecast_days": String(forecastDays),
        ]
        let marineURL = "https://marine-api.open-meteo.com/v1/marine"
        async let weather = get(OMForecast.self, "https://api.open-meteo.com/v1/forecast", common.merging([
            "hourly": "temperature_2m,precipitation_probability",
            "daily": "sunrise,sunset,temperature_2m_max,temperature_2m_min",
        ]) { $1 })
        async let model = try? get(OMMarine.self, marineURL, common.merging([
            "hourly": "sea_level_height_msl,swell_wave_height,swell_wave_period",
            "cell_selection": "sea",
            "past_days": "1",
        ]) { $1 })
        async let gfsWave = try? get(OMMarine.self, marineURL, common.merging([
            "hourly": "swell_wave_height,swell_wave_period",
            "models": "ncep_gfswave025",
            "cell_selection": "sea",
            "past_days": "1",
        ]) { $1 })
        async let noaa = noaaTides(loc.tideStation?.id)

        let w = try await weather
        let m = await model
        let g = await gfsWave
        let n = await noaa

        func near(_ x: OMMarine?, _ km: Double) -> OMMarine.H? {
            guard let x, let h = x.hourly, distanceKm(loc.lat, loc.lon, x.latitude, x.longitude) <= km else { return nil }
            return h
        }
        func hasValues(_ a: [Double?]??) -> Bool { (a ?? nil)?.contains { $0 != nil } ?? false }

        var tides: [Tide]? = nil
        var datum: String? = nil
        var tideSource: String? = nil
        if let n, !n.isEmpty, let station = loc.tideStation {
            tides = n
            datum = "MLLW"
            tideSource = "NOAA · \(station.name)"
        } else if let h = near(m, coastMaxKm), let level = h.sea_level_height_msl ?? nil,
                  let found = findTides(time: h.time, level: level) {
            tides = found
            datum = "MSL"
            tideSource = "Open-Meteo model"
        }

        var swell: Forecast.Swell? = nil
        let coastal = tides != nil || near(m, coastMaxKm) != nil
        if coastal, let h = near(g, swellMaxKm), hasValues(h.swell_wave_height) {
            swell = .init(time: h.time, height: h.swell_wave_height ?? [], period: h.swell_wave_period ?? [], source: "NOAA GFS-Wave")
        } else if let h = near(m, coastMaxKm), hasValues(h.swell_wave_height) {
            swell = .init(time: h.time, height: h.swell_wave_height ?? [], period: h.swell_wave_period ?? [], source: "Open-Meteo")
        }

        return Forecast(
            fetchedAt: Date().timeIntervalSince1970.rounded(.down),
            tz: w.timezone,
            hourly: .init(time: w.hourly.time, temp: w.hourly.temperature_2m, pop: w.hourly.precipitation_probability),
            daily: .init(time: w.daily.time, sunrise: w.daily.sunrise, sunset: w.daily.sunset,
                         max: w.daily.temperature_2m_max, min: w.daily.temperature_2m_min),
            tides: tides,
            tideDatum: datum,
            tideSource: tideSource,
            swell: swell
        )
    }

    /// NOAA CO-OPS high/low predictions (metres above MLLW), starting a day back.
    private static func noaaTides(_ station: String?) async -> [Tide]? {
        guard let station else { return nil }
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(identifier: "UTC")
        day.dateFormat = "yyyyMMdd"
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.timeZone = TimeZone(identifier: "UTC")
        stamp.dateFormat = "yyyy-MM-dd HH:mm"

        guard let data = try? await get(NOAAPredictions.self, "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter", [
            "begin_date": day.string(from: Date().addingTimeInterval(-86400)),
            "range": String((forecastDays + 2) * 24),
            "station": station,
            "product": "predictions",
            "datum": "MLLW",
            "interval": "hilo",
            "units": "metric",
            "time_zone": "gmt",
            "format": "json",
            "application": "daily-weather",
        ]), let predictions = data.predictions else { return nil }

        return predictions.compactMap { p in
            guard let date = stamp.date(from: p.t), let v = Double(p.v) else { return nil }
            return Tide(time: date.timeIntervalSince1970, kind: p.type == "H" ? "high" : "low", height: v)
        }
    }

    static func findTides(time: [Double], level: [Double?]) -> [Tide]? {
        let valid = level.compactMap { $0 }
        guard valid.count >= 24, let hi = valid.max(), let lo = valid.min(), hi - lo >= minTidalRange else { return nil }
        var tides: [Tide] = []
        guard level.count >= 3 else { return tides }
        for i in 1..<(level.count - 1) {
            guard let a = level[i - 1], let b = level[i], let c = level[i + 1] else { continue }
            let isHigh = b > a && b >= c
            let isLow = b < a && b <= c
            guard isHigh || isLow else { continue }
            let denom = a - 2 * b + c
            let offset = denom == 0 ? 0 : 0.5 * (a - c) / denom
            let step = time[i + 1] - time[i]
            tides.append(Tide(time: (time[i] + offset * step).rounded(),
                              kind: isHigh ? "high" : "low",
                              height: b - 0.25 * (a - c) * offset))
        }
        return tides
    }

    private static func distanceKm(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let rad = Double.pi / 180
        let dLat = (lat2 - lat1) * rad
        let dLon = (lon2 - lon1) * rad
        let h = pow(sin(dLat / 2), 2) + cos(lat1 * rad) * cos(lat2 * rad) * pow(sin(dLon / 2), 2)
        return 12742 * asin(sqrt(h))
    }
}

// MARK: - Reading a forecast at a moment in time

/// One day of the five-day outlook.
struct DayOutlook {
    let date: Date // local midnight
    let high: Double?
    let low: Double?
    /// Highest hourly rain chance that day, 0–100.
    let pop: Double
}

struct Conditions {
    /// Days in the outlook (after today), as in the app.
    static let outlookDays = 5

    let temp: Double?
    let high: Double?
    let low: Double?
    let pop: Double?
    let nextSun: (date: Date, isSunrise: Bool)?
    let nextTide: Tide?
    /// Hourly points from the current hour onward (for charts).
    let hours: [(date: Date, temp: Double?, pop: Double?)]
    /// Night intervals overlapping the chart window.
    let nights: [(start: Date, end: Date)]
    /// The next days after today (up to `outlookDays`).
    let days: [DayOutlook]

    init?(_ f: Forecast, at date: Date, hours count: Int = 12) {
        let t = date.timeIntervalSince1970
        let hourStart = (t / 3600).rounded(.down) * 3600
        guard let i = f.hourly.time.firstIndex(where: { $0 >= hourStart }) else { return nil }

        let a = f.hourly.temp[i]
        let b = i + 1 < f.hourly.temp.count ? f.hourly.temp[i + 1] : nil
        let frac = min(1, max(0, (t - f.hourly.time[i]) / 3600))
        if let a, let b { temp = a + (b - a) * frac } else { temp = a }
        pop = f.hourly.pop[i]

        let d = f.daily.time.indices.last(where: { f.daily.time[$0] <= t }) ?? 0
        high = f.daily.max.indices.contains(d) ? f.daily.max[d] : nil
        low = f.daily.min.indices.contains(d) ? f.daily.min[d] : nil

        var days: [DayOutlook] = []
        var k = d + 1
        while k < f.daily.time.count, days.count < Self.outlookDays {
            let start = f.daily.time[k]
            let end = k + 1 < f.daily.time.count ? f.daily.time[k + 1] : start + 86400
            let pops = f.hourly.time.indices
                .filter { f.hourly.time[$0] >= start && f.hourly.time[$0] < end }
                .map { f.hourly.pop[$0] ?? 0 }
            days.append(DayOutlook(
                date: Date(timeIntervalSince1970: start),
                high: f.daily.max.indices.contains(k) ? f.daily.max[k] : nil,
                low: f.daily.min.indices.contains(k) ? f.daily.min[k] : nil,
                pop: pops.max() ?? 0
            ))
            k += 1
        }
        self.days = days

        let suns = (f.daily.sunrise.map { ($0, true) } + f.daily.sunset.map { ($0, false) })
            .filter { $0.0 > t }
            .min { $0.0 < $1.0 }
        nextSun = suns.map { (date: Date(timeIntervalSince1970: $0.0), isSunrise: $0.1) }
        nextTide = f.tides?.first { $0.time > t }

        let end = min(f.hourly.time.count, i + count + 1)
        hours = (i..<end).map { k in
            (date: Date(timeIntervalSince1970: f.hourly.time[k]), temp: f.hourly.temp[k], pop: f.hourly.pop[k])
        }

        let windowEnd = hourStart + Double(count) * 3600
        var nights: [(start: Date, end: Date)] = []
        for k in f.daily.time.indices {
            let start = k == 0 ? -Double.infinity : f.daily.sunset[k - 1]
            nights.append(contentsOf: Self.clip(start, f.daily.sunrise[k], hourStart, windowEnd))
        }
        if let lastSunset = f.daily.sunset.last {
            nights.append(contentsOf: Self.clip(lastSunset, .infinity, hourStart, windowEnd))
        }
        self.nights = nights
    }

    private static func clip(_ a: Double, _ b: Double, _ lo: Double, _ hi: Double) -> [(start: Date, end: Date)] {
        let s = max(a, lo), e = min(b, hi)
        return e > s ? [(start: Date(timeIntervalSince1970: s), end: Date(timeIntervalSince1970: e))] : []
    }
}

// MARK: - Formatting

enum Fmt {
    static func temp(_ c: Double?, _ units: String) -> String {
        guard let c else { return "–" }
        let v = units == "f" ? c * 1.8 + 32 : c
        return "\(Int(v.rounded()))°"
    }

    static func clock(_ date: Date, _ tz: TimeZone) -> String {
        let f = DateFormatter()
        f.timeZone = tz
        f.dateStyle = .none
        f.timeStyle = .short
        return compact(f.string(from: date))
    }

    static func hour(_ date: Date, _ tz: TimeZone) -> String {
        let f = DateFormatter()
        f.timeZone = tz
        f.setLocalizedDateFormatFromTemplate("j")
        return compact(f.string(from: date))
    }

    /// "Tue" — weekday at the place. Uses midday so DST shifts can't land on the previous day.
    static func weekday(_ dayStart: Date, _ tz: TimeZone) -> String {
        let f = DateFormatter()
        f.timeZone = tz
        f.setLocalizedDateFormatFromTemplate("EEE")
        return f.string(from: dayStart.addingTimeInterval(12 * 3600))
    }

    /// "now", "12m", "3h", "2d"
    static func shortAge(_ fetched: Date, now: Date) -> String {
        let s = max(0, now.timeIntervalSince(fetched))
        if s < 90 { return "now" }
        if s < 3600 { return "\(Int((s / 60).rounded()))m" }
        if s < 86400 * 2 { return "\(Int((s / 3600).rounded()))h" }
        return "\(Int((s / 86400).rounded()))d"
    }

    static func age(_ fetched: Date, now: Date) -> String {
        let a = shortAge(fetched, now: now)
        return a == "now" ? "Updated just now" : "Updated \(a) ago"
    }

    private static func compact(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{202F}", with: " ")
            .replacingOccurrences(of: " AM", with: "a")
            .replacingOccurrences(of: " PM", with: "p")
    }
}
