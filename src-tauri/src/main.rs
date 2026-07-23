// LuauX Desktop — a plain window over the bundled offline course (dist/).
// No network calls, no accounts, no telemetry: everything the app needs
// ships inside the binary and progress lives in the OS's local storage
// for the app's origin (see progress.js).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running LuauX Desktop");
}
