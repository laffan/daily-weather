use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Written by the app: saved places, units and the latest forecasts.
const STATE_FILE: &str = "state.json";
/// Written by the iOS widget when it refreshes on its own.
const WIDGET_FILE: &str = "widget.json";

/// Directory shared with the widget. On iOS that is the App Group container
/// (resolved by `ios/App/SharedContainer.swift`); elsewhere the app data dir.
fn shared_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "ios")]
    if let Some(dir) = ios::app_group_dir() {
        return Ok(dir);
    }
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct StoredFiles {
    state: Option<String>,
    widget: Option<String>,
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<StoredFiles, String> {
    let dir = shared_dir(&app)?;
    Ok(StoredFiles {
        state: fs::read_to_string(dir.join(STATE_FILE)).ok(),
        widget: fs::read_to_string(dir.join(WIDGET_FILE)).ok(),
    })
}

#[tauri::command]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    let dir = shared_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Write-then-rename so the widget never reads a half-written file.
    let tmp = dir.join(format!("{STATE_FILE}.tmp"));
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(STATE_FILE)).map_err(|e| e.to_string())?;

    #[cfg(target_os = "ios")]
    ios::reload_widgets();
    Ok(())
}

#[cfg(target_os = "ios")]
mod ios {
    use std::ffi::{c_char, CStr};
    use std::path::PathBuf;

    // Implemented in Swift: src-tauri/ios/App/SharedContainer.swift
    extern "C" {
        fn dw_app_group_path() -> *mut c_char;
        fn dw_free_string(ptr: *mut c_char);
        fn dw_reload_widgets();
    }

    pub fn app_group_dir() -> Option<PathBuf> {
        unsafe {
            let ptr = dw_app_group_path();
            if ptr.is_null() {
                return None;
            }
            let path = CStr::from_ptr(ptr).to_string_lossy().into_owned();
            dw_free_string(ptr);
            Some(PathBuf::from(path))
        }
    }

    pub fn reload_widgets() {
        unsafe { dw_reload_widgets() }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![load_state, save_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
