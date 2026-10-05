import SwiftUI
import WidgetKit

@main
struct DailyWeatherWidgets: WidgetBundle {
    var body: some Widget {
        DailyWeatherWidget()
        DailyWeatherForecastWidget()
    }
}

struct DailyWeatherWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "DailyWeather", intent: SelectPlaceIntent.self, provider: Provider()) { entry in
            WeatherWidgetView(entry: entry)
        }
        .configurationDisplayName("Daily Weather")
        .description("Temperature, rain chance and when the data was last updated. Works offline from the last download.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryRectangular,
            .accessoryCircular,
            .accessoryInline,
        ])
    }
}

/// Current conditions plus the five-day outlook (highs, lows, rain chance).
struct DailyWeatherForecastWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "DailyWeatherForecast", intent: SelectPlaceIntent.self, provider: Provider()) { entry in
            ForecastWidgetView(entry: entry)
        }
        .configurationDisplayName("Daily Weather Forecast")
        .description("The next five days' highs, lows and rain chance, with when the data was last updated.")
        .supportedFamilies([
            .systemMedium,
            .systemLarge,
            .accessoryRectangular,
        ])
    }
}
