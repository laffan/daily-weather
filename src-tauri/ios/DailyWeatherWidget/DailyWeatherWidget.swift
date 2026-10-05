import SwiftUI
import WidgetKit

@main
struct DailyWeatherWidgets: WidgetBundle {
    var body: some Widget {
        DailyWeatherWidget()
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
