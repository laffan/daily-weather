// Compiled into the iOS app target (see ios/project.yml) and called from
// Rust (src/lib.rs, `mod ios`) through these C symbols.

import Foundation
import WidgetKit

/// Path of the App Group container shared with the widget, or NULL if the
/// App Group entitlement is missing. Free the result with `dw_free_string`.
@_cdecl("dw_app_group_path")
public func dwAppGroupPath() -> UnsafeMutablePointer<CChar>? {
    guard
        let group = Bundle.main.object(forInfoDictionaryKey: "DWAppGroup") as? String,
        let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return strdup(url.path)
}

@_cdecl("dw_free_string")
public func dwFreeString(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

/// Ask WidgetKit to rebuild every widget timeline from the freshly saved data.
@_cdecl("dw_reload_widgets")
public func dwReloadWidgets() {
    DispatchQueue.main.async {
        WidgetCenter.shared.reloadAllTimelines()
    }
}
