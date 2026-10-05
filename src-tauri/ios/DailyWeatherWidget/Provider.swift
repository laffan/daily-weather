import WidgetKit

struct WeatherEntry: TimelineEntry {
    let date: Date
    let location: SavedLocation?
    let forecast: Forecast?
    let units: String

    var conditions: Conditions? { forecast.flatMap { Conditions($0, at: date) } }

    static let placeholder = WeatherEntry(date: Date(), location: nil, forecast: nil, units: "f")
}

struct Provider: AppIntentTimelineProvider {
    /// Try to download fresh data when what we have is older than this.
    private let staleAfter: TimeInterval = 30 * 60

    func placeholder(in context: Context) -> WeatherEntry { .placeholder }

    func snapshot(for configuration: SelectPlaceIntent, in context: Context) async -> WeatherEntry {
        let (loc, forecast, units) = load(configuration)
        return WeatherEntry(date: Date(), location: loc, forecast: forecast, units: units)
    }

    func timeline(for configuration: SelectPlaceIntent, in context: Context) async -> Timeline<WeatherEntry> {
        let state = SharedStore.state()
        let (loc, cached, units) = load(configuration, state: state)
        var forecast = cached
        let now = Date()

        // Refresh from the network when possible; on failure (offline) keep the cached forecast.
        if let loc, forecast.map({ now.timeIntervalSince($0.fetchedDate) > staleAfter }) ?? true {
            if let fresh = try? await WeatherAPI.fetch(loc) {
                forecast = fresh
                SharedStore.saveWidgetForecast(fresh, for: loc.id, keeping: Set(state?.locations.map(\.id) ?? []))
            }
        }

        // The cached hourly forecast lets the widget keep advancing "now"
        // (and the "updated … ago" label) for hours without a connection.
        let entries = (0..<48).map { k in
            WeatherEntry(date: now.addingTimeInterval(Double(k) * 15 * 60), location: loc, forecast: forecast, units: units)
        }
        return Timeline(entries: entries, policy: .after(now.addingTimeInterval(staleAfter)))
    }

    private func load(_ configuration: SelectPlaceIntent, state: AppState? = SharedStore.state())
        -> (SavedLocation?, Forecast?, String)
    {
        let locations = state?.locations ?? []
        let loc = locations.first { $0.id == configuration.place?.id } ?? locations.first
        let forecast = loc.flatMap { SharedStore.forecast(for: $0.id, state: state) }
        return (loc, forecast, state?.units ?? "f")
    }
}
