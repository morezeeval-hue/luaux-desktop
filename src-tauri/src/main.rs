// LuauX Desktop — main process.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
async fn open_discord_auth(app: tauri::AppHandle) -> Result<(), String> {
    let url: tauri::Url = "https://luau.prestigex.space/api/auth/discord"
        .parse()
        .map_err(|e| format!("{e}"))?;

    if let Some(win) = app.get_webview_window("discord-oauth") {
        let _ = win.set_focus();
        return Ok(());
    }

    let app_handle = app.clone();

    WebviewWindowBuilder::new(&app, "discord-oauth", WebviewUrl::External(url))
        .title("Sign in with Discord")
        .inner_size(600.0, 700.0)
        .center()
        .resizable(true)
        .on_navigation(move |nav_url| {
            let url_s = nav_url.as_str();
            if let Some(idx) = url_s.find("oauth=") {
                let rest = &url_s[idx + 6..];
                let raw_token = rest.split('&').next().unwrap_or("");
                let token: String = raw_token.chars().filter(|c| c.is_alphanumeric()).collect();
                if !token.is_empty() {
                    let _ = app_handle.emit("oauth-callback", serde_json::json!({ "token": token }));
                    if let Some(win) = app_handle.get_webview_window("discord-oauth") {
                        let _ = win.close();
                    }
                    return false;
                }
            } else if url_s.contains("oauth-error=") {
                let _ = app_handle.emit("oauth-callback", serde_json::json!({ "error": "auth_failed" }));
                if let Some(win) = app_handle.get_webview_window("discord-oauth") {
                    let _ = win.close();
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![open_discord_auth])
        .run(tauri::generate_context!())
        .expect("error while running LuauX Desktop");
}
