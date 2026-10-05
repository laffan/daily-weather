import Charts
import SwiftUI
import WidgetKit

let rainBlue = Color(red: 0.165, green: 0.471, blue: 0.839) // #2a78d6, same as the app

struct WeatherWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WeatherEntry

    var body: some View {
        content.containerBackground(for: .widget) {
            switch family {
            case .accessoryCircular, .accessoryRectangular, .accessoryInline: Color.clear
            default: Color(uiColor: .systemBackground)
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let loc = entry.location, let f = entry.forecast, let c = entry.conditions {
            switch family {
            case .systemSmall: SmallView(loc: loc, f: f, c: c, entry: entry)
            case .systemMedium: MediumView(loc: loc, f: f, c: c, entry: entry)
            case .accessoryRectangular: RectangularView(loc: loc, f: f, c: c, entry: entry)
            case .accessoryCircular: CircularView(f: f, c: c, entry: entry)
            case .accessoryInline: InlineView(loc: loc, f: f, c: c, entry: entry)
            default: SmallView(loc: loc, f: f, c: c, entry: entry)
            }
        } else {
            EmptyStateView(entry: entry)
        }
    }
}

// MARK: - Home screen

private struct SmallView: View {
    let loc: SavedLocation, f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(loc.name).font(.footnote.weight(.semibold)).lineLimit(1)
            Text(Fmt.temp(c.temp, entry.units))
                .font(.system(size: 44, weight: .light))
                .minimumScaleFactor(0.6)
                .padding(.top, 2)
            Text("H \(Fmt.temp(c.high, entry.units))  L \(Fmt.temp(c.low, entry.units))")
                .font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(detailLine(c, f)).font(.caption2).lineLimit(1)
            AgeLabel(f: f, entry: entry).padding(.top, 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct MediumView: View {
    let loc: SavedLocation, f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text(loc.name).font(.footnote.weight(.semibold)).lineLimit(1)
                Text(Fmt.temp(c.temp, entry.units))
                    .font(.system(size: 40, weight: .light))
                    .minimumScaleFactor(0.6)
                    .padding(.top, 2)
                Text("H \(Fmt.temp(c.high, entry.units))  L \(Fmt.temp(c.low, entry.units))")
                    .font(.caption2).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                AgeLabel(f: f, entry: entry)
            }
            .frame(width: 92, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                HourlyChart(c: c, tz: f.timeZone)
                Text(detailLine(c, f)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Temperature line over rain-chance bars. Each lives in its own band of the
/// plot (temperature on top, rain below) so neither needs a y-axis.
struct HourlyChart: View {
    let c: Conditions
    let tz: TimeZone

    private let rainBand = 0.32
    private let tempBand = 0.42 ... 1.0

    var body: some View {
        let temps = c.hours.compactMap(\.temp)
        let lo = temps.min() ?? 0, hi = temps.max() ?? 1
        let span = max(hi - lo, 4), mid = (hi + lo) / 2
        let y: (Double) -> Double = { v in
            tempBand.lowerBound + (v - (mid - span / 2)) / span * (tempBand.upperBound - tempBand.lowerBound)
        }
        let start = c.hours.first?.date ?? Date()
        let end = start.addingTimeInterval(Double(max(c.hours.count - 1, 1)) * 3600)

        Chart {
            ForEach(Array(c.nights.enumerated()), id: \.offset) { _, n in
                RectangleMark(xStart: .value("t", n.start), xEnd: .value("t", n.end), yStart: .value("y", 0.0), yEnd: .value("y", 1.0))
                    .foregroundStyle(Color.primary.opacity(0.06))
            }
            ForEach(Array(c.hours.dropLast().enumerated()), id: \.offset) { _, h in
                if let p = h.pop, p > 0 {
                    RectangleMark(
                        xStart: .value("t", h.date.addingTimeInterval(240)),
                        xEnd: .value("t", h.date.addingTimeInterval(3600 - 240)),
                        yStart: .value("y", 0.0),
                        yEnd: .value("y", max(0.015, p / 100 * rainBand))
                    )
                    .foregroundStyle(rainBlue)
                }
            }
            ForEach(Array(c.hours.enumerated()), id: \.offset) { _, h in
                if let t = h.temp {
                    LineMark(x: .value("t", h.date), y: .value("y", y(t)))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                        .foregroundStyle(Color.primary)
                }
            }
        }
        .chartXScale(domain: start ... end)
        .chartYScale(domain: 0.0 ... 1.0)
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: .stride(by: .hour, count: 4)) { value in
                AxisValueLabel {
                    Text(value.as(Date.self).map { Fmt.hour($0, tz) } ?? "")
                }
            }
        }
        .chartLegend(.hidden)
    }
}

// MARK: - Lock screen

private struct RectangularView: View {
    let loc: SavedLocation, f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text(loc.name).lineLimit(1)
                Spacer(minLength: 2)
                Text(Fmt.temp(c.temp, entry.units))
            }
            .font(.headline)
            Text("H \(Fmt.temp(c.high, entry.units)) L \(Fmt.temp(c.low, entry.units)) · \(Int(c.pop ?? 0))% rain")
                .font(.caption).lineLimit(1)
            Text(Fmt.age(f.fetchedDate, now: entry.date))
                .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CircularView: View {
    let f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        let toUnits = { (v: Double) in entry.units == "f" ? v * 1.8 + 32 : v }
        let lo = toUnits(c.low ?? c.temp ?? 0)
        let hi = toUnits(c.high ?? c.temp ?? 1)
        let now = toUnits(c.temp ?? lo)
        Gauge(value: min(max(now, lo), max(hi, lo + 1)), in: lo ... max(hi, lo + 1)) {
            Text(Fmt.shortAge(f.fetchedDate, now: entry.date))
        } currentValueLabel: {
            Text(Fmt.temp(c.temp, entry.units))
        }
        .gaugeStyle(.accessoryCircular)
    }
}

private struct InlineView: View {
    let loc: SavedLocation, f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        Text("\(Fmt.temp(c.temp, entry.units)) \(loc.name) · \(Fmt.shortAge(f.fetchedDate, now: entry.date))")
    }
}

// MARK: - Shared bits

struct AgeLabel: View {
    let f: Forecast, entry: WeatherEntry

    var body: some View {
        let stale = entry.date.timeIntervalSince(f.fetchedDate) > 6 * 3600
        Text(Fmt.age(f.fetchedDate, now: entry.date))
            .font(.system(size: 10))
            .foregroundStyle(stale ? Color.primary : Color.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }
}

/// "20% rain · Sunset 6:41p · High tide 4:12a" — whatever is most useful next.
func detailLine(_ c: Conditions, _ f: Forecast) -> String {
    var parts = ["\(Int(c.pop ?? 0))% rain"]
    if let sun = c.nextSun {
        parts.append("\(sun.isSunrise ? "↑" : "↓") \(Fmt.clock(sun.date, f.timeZone))")
    }
    if let tide = c.nextTide {
        parts.append("\(tide.kind == "high" ? "High" : "Low") \(Fmt.clock(Date(timeIntervalSince1970: tide.time), f.timeZone))")
    }
    return parts.joined(separator: " · ")
}

struct EmptyStateView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WeatherEntry

    var body: some View {
        let message = entry.location == nil
            ? "Add a place in Daily Weather"
            : entry.forecast == nil ? "No data yet" : "Forecast expired"
        switch family {
        case .accessoryInline, .accessoryCircular:
            Text(entry.location == nil ? "–" : "No data")
        default:
            VStack(alignment: .leading, spacing: 2) {
                if let loc = entry.location {
                    Text(loc.name).font(.footnote.weight(.semibold)).lineLimit(1)
                }
                Text(message).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - Forecast widget (current conditions + five-day outlook)

/// The "Daily Weather Forecast" widget: now + the five-day outlook.
struct ForecastWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WeatherEntry

    var body: some View {
        content.containerBackground(for: .widget) {
            switch family {
            case .accessoryRectangular: Color.clear
            default: Color(uiColor: .systemBackground)
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let loc = entry.location, let f = entry.forecast, let c = entry.conditions {
            switch family {
            case .systemLarge: ForecastLargeView(loc: loc, f: f, c: c, entry: entry)
            case .accessoryRectangular: ForecastRectangularView(f: f, c: c, entry: entry)
            default: ForecastMediumView(loc: loc, f: f, c: c, entry: entry)
            }
        } else {
            EmptyStateView(entry: entry)
        }
    }
}

/// Name and current temperature on the left; today's high/low and data age on the right.
private struct ForecastHeader: View {
    let loc: SavedLocation, f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 0) {
                Text(loc.name).font(.footnote.weight(.semibold)).lineLimit(1)
                Text(Fmt.temp(c.temp, entry.units))
                    .font(.system(size: 34, weight: .light))
                    .minimumScaleFactor(0.6)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text("H \(Fmt.temp(c.high, entry.units))  L \(Fmt.temp(c.low, entry.units))")
                    .font(.caption2).foregroundStyle(.secondary)
                AgeLabel(f: f, entry: entry)
            }
        }
    }
}

/// Five columns: weekday, high, low, and peak rain chance when it's 20 % or more.
struct OutlookRow: View {
    let days: [DayOutlook]
    let units: String
    let tz: TimeZone

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                VStack(spacing: 1) {
                    Text(Fmt.weekday(day.date, tz)).font(.caption2).foregroundStyle(.secondary)
                    Text(Fmt.temp(day.high, units)).font(.footnote.weight(.medium))
                    Text(Fmt.temp(day.low, units)).font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 2) {
                        if day.pop >= 20 {
                            RoundedRectangle(cornerRadius: 1).fill(rainBlue).frame(width: 4, height: 4)
                            Text("\(Int(day.pop))%")
                        } else {
                            Text(" ")
                        }
                    }
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .monospacedDigit()
    }
}

private struct ForecastMediumView: View {
    let loc: SavedLocation, f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        VStack(spacing: 6) {
            ForecastHeader(loc: loc, f: f, c: c, entry: entry)
            Spacer(minLength: 0)
            OutlookRow(days: c.days, units: entry.units, tz: f.timeZone)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

private struct ForecastLargeView: View {
    let loc: SavedLocation, f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForecastHeader(loc: loc, f: f, c: c, entry: entry)
            HourlyChart(c: c, tz: f.timeZone)
            Text(detailLine(c, f)).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            Divider()
            OutlookRow(days: c.days, units: entry.units, tz: f.timeZone)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// Lock screen: the next three days, plus how old the data is.
private struct ForecastRectangularView: View {
    let f: Forecast, c: Conditions, entry: WeatherEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 0) {
                ForEach(Array(c.days.prefix(3).enumerated()), id: \.offset) { _, day in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(Fmt.weekday(day.date, f.timeZone)).font(.caption2.weight(.semibold))
                        Text("\(Fmt.temp(day.high, entry.units)) \(Fmt.temp(day.low, entry.units))")
                            .font(.caption)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Text(Fmt.age(f.fetchedDate, now: entry.date))
                .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .monospacedDigit()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
