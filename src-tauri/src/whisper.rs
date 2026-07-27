//! Local speech-to-text through faster-whisper's `small.en` model.
//!
//! The Python environment and model are created only after the learner asks
//! for spoken answers. Audio is written to a short-lived local temp file and
//! passed to the local interpreter; neither audio nor transcripts leave the
//! device.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const MODEL: &str = "small.en";

#[derive(Serialize)]
pub struct Status {
    pub available: bool,
    pub installed: bool,
    pub model: &'static str,
    pub reason: String,
}

fn whisper_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?
        .join("whisper");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn script(app: &AppHandle) -> Result<PathBuf, String> {
    let file = app
        .path()
        .resource_dir()
        .map_err(|e| format!("no resource directory: {e}"))?
        .join("whisper_input.py");
    if file.is_file() { Ok(file) } else { Err("the Whisper helper is missing from this build".into()) }
}

fn venv_python(dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        dir.join("venv").join("Scripts").join("python.exe")
    } else {
        dir.join("venv").join("bin").join("python")
    }
}

fn system_python() -> Option<PathBuf> {
    let candidates: &[&str] = if cfg!(target_os = "windows") { &["python", "python3"] } else { &["python3", "python"] };
    candidates.iter().find_map(|candidate| {
        Command::new(candidate).arg("--version").output().ok()
            .filter(|out| out.status.success())
            .map(|_| PathBuf::from(candidate))
    })
}

fn runner(dir: &Path) -> Result<PathBuf, String> {
    let installed = venv_python(dir);
    if installed.is_file() { return Ok(installed); }
    system_python().ok_or_else(|| "Python 3 is required to install local Whisper speech input".into())
}

fn marker(dir: &Path) -> PathBuf { dir.join("small.en.ready.json") }

fn command_output(app: &AppHandle, extra: &[&str]) -> Result<String, String> {
    let dir = whisper_dir(app)?;
    let script = script(app)?;
    let python = runner(&dir)?;
    let mut command = Command::new(python);
    command.arg(script).arg("--home").arg(&dir);
    for argument in extra { command.arg(argument); }
    let output = command.output().map_err(|e| format!("could not start local Whisper: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr);
        Err(format!("Whisper setup failed: {}", detail.trim().chars().take(500).collect::<String>()))
    }
}

#[tauri::command]
pub fn whisper_status(app: AppHandle) -> Status {
    let dir = match whisper_dir(&app) {
        Ok(dir) => dir,
        Err(reason) => return Status { available: false, installed: false, model: MODEL, reason },
    };
    let installed = marker(&dir).is_file();
    let available = installed || system_python().is_some() || venv_python(&dir).is_file();
    let reason = if available { String::new() } else { "Python 3 is required for local Whisper speech input".into() };
    Status { available, installed, model: MODEL, reason }
}

#[tauri::command]
pub fn whisper_install(app: AppHandle) -> Result<(), String> {
    command_output(&app, &["--install"])?;
    Ok(())
}

#[tauri::command]
pub fn whisper_transcribe(app: AppHandle, audio: Vec<u8>) -> Result<String, String> {
    if audio.is_empty() || audio.len() > 12 * 1024 * 1024 {
        return Err("recording must be between 1 byte and 12 MB".into());
    }
    let dir = whisper_dir(&app)?;
    if !marker(&dir).is_file() { return Err("install Whisper small.en before speaking an answer".into()); }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let file = std::env::temp_dir().join(format!("luaux-whisper-{}-{stamp}.webm", std::process::id()));
    std::fs::write(&file, audio).map_err(|e| format!("could not save local recording: {e}"))?;
    let file_arg = file.to_string_lossy().to_string();
    let result = command_output(&app, &["--transcribe", &file_arg]);
    let _ = std::fs::remove_file(&file);
    let json = result?;
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("Whisper returned invalid data: {e}"))?;
    value.get("text").and_then(|text| text.as_str()).map(str::to_owned)
        .ok_or_else(|| "Whisper returned no transcript".into())
}
