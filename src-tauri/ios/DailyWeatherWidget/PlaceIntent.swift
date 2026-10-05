import AppIntents
import WidgetKit

/// A saved place, as offered in the widget's "Edit Widget" picker.
struct PlaceEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Place"
    static var defaultQuery = PlaceQuery()

    let id: String
    let name: String
    let detail: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: "\(detail)")
    }

    init(_ loc: SavedLocation) {
        id = loc.id
        name = loc.name
        detail = loc.detail
    }
}

struct PlaceQuery: EntityQuery {
    private func all() -> [PlaceEntity] {
        (SharedStore.state()?.locations ?? []).map(PlaceEntity.init)
    }

    func entities(for identifiers: [PlaceEntity.ID]) async throws -> [PlaceEntity] {
        all().filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [PlaceEntity] {
        all()
    }

    func defaultResult() async -> PlaceEntity? {
        all().first
    }
}

struct SelectPlaceIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Place"
    static var description = IntentDescription("Choose which saved place this widget shows.")

    @Parameter(title: "Place")
    var place: PlaceEntity?
}
