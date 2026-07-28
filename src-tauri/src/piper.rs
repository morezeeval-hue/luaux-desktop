//! Local neural speech for the guided tutor.
//!
//! Piper runs in this process: no companion executable is downloaded and
//! nothing is sent anywhere while a lesson plays. The only network use is
//! fetching a voice the first time it is chosen, from a pinned revision,
//! checked against a recorded SHA-256 before it is ever loaded.
//!
//! Two facts shape the code below:
//!
//!   * espeak-ng, which turns text into phonemes, keeps its data path in a
//!     fixed 160 byte buffer and aborts the process on overflow. So the
//!     path is measured before use and a short copy is made when the real
//!     one is too long. An abort here would take the whole app down.
//!   * Loading a voice costs a third of a second, synthesis a tenth. So the
//!     loaded voice is kept and reused; only switching voices reloads.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

/// Pinned commit of `rhasspy/piper-voices`. Together with the hashes below
/// this makes a download reproducible: the same bytes or nothing.
const REVISION: &str = "0d907f158acc877ddeebcbf827659ee13bea8bcd";

/// espeak-ng's `N_PATH_HOME` is 160 bytes and it appends `/espeak-ng-data`,
/// so keep a margin rather than finding the edge experimentally.
const MAX_ESPEAK_DIR: usize = 128;

pub struct Voice {
    pub id: &'static str,
    pub label: &'static str,
    accent: &'static str,
    gender: &'static str,
    path: &'static str,
    model_bytes: u64,
    model_sha: &'static str,
    config_bytes: u64,
    config_sha: &'static str,
}

pub const VOICES: &[Voice] = &[
    Voice {
        id: "en_US-amy-medium",
        label: "Amy",
        accent: "American",
        gender: "female",
        path: "en/en_US/amy/medium",
        model_bytes: 63_201_294,
        model_sha: "b3a6e47b57b8c7fbe6a0ce2518161a50f59a9cdd8a50835c02cb02bdd6206c18",
        config_bytes: 4_882,
        config_sha: "95a23eb4d42909d38df73bb9ac7f45f597dbfcde2d1bf9526fdeaf5466977d77",
    },
    Voice {
        id: "en_US-ryan-high",
        label: "Ryan",
        accent: "American",
        gender: "male",
        path: "en/en_US/ryan/high",
        model_bytes: 120_786_792,
        model_sha: "b3990d7606e183ec8dbfba70a4607074f162de1a0c412e0180d1ff60bb154eca",
        config_bytes: 4_166,
        config_sha: "c6d3b98f08315cb4bebf0d49d50fc4ff491b503c64b940cd3d5ca28543b48011",
    },
    Voice {
        id: "en_GB-jenny_dioco-medium",
        label: "Jenny",
        accent: "British",
        gender: "female",
        path: "en/en_GB/jenny_dioco/medium",
        model_bytes: 63_201_294,
        model_sha: "469c630d209e139dd392a66bf4abde4ab86390a0269c1e47b4e5d7ce81526b01",
        config_bytes: 4_895,
        config_sha: "a9a7a93a317c9a3cb6563e37eb057df9ef09c06188a8a4341b0fcb58cba54dd4",
    },
    Voice {
        id: "en_GB-alan-medium",
        label: "Alan",
        accent: "British",
        gender: "male",
        path: "en/en_GB/alan/medium",
        model_bytes: 63_201_294,
        model_sha: "0a309668932205e762801f1efc2736cd4b0120329622adf62be09e56339d3330",
        config_bytes: 4_888,
        config_sha: "c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e",
    },
];

pub fn voice(id: &str) -> Option<&'static Voice> {
    VOICES.iter().find(|v| v.id == id)
}

/// Where a voice's two files live inside `dir`.
pub fn files_in(dir: &Path, v: &Voice) -> (PathBuf, PathBuf) {
    (
        dir.join(format!("{}.onnx", v.id)),
        dir.join(format!("{}.onnx.json", v.id)),
    )
}

/// A voice counts as present only at its exact recorded size, so a download
/// cut off halfway is retried rather than loaded.
pub fn is_installed(dir: &Path, v: &Voice) -> bool {
    let (model, config) = files_in(dir, v);
    std::fs::metadata(&model).map(|f| f.len()).ok() == Some(v.model_bytes)
        && std::fs::metadata(&config).is_ok()
}

/* ------------------------------------------------------------------ state */

/// The currently loaded voice. Held across calls so a lesson does not pay
/// the load cost on every beat.
static LOADED: Mutex<Option<(String, piper_rs::Piper)>> = Mutex::new(None);

/// Where espeak-ng's data ended up, once decided. `None` means speech is
/// unavailable and the caller should fall back to the system voice.
static ESPEAK_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Serialize)]
pub struct VoiceInfo {
    id: String,
    label: String,
    accent: String,
    gender: String,
    installed: bool,
    bytes: u64,
}

#[derive(Serialize)]
pub struct Status {
    available: bool,
    reason: String,
    /// Where the speech engine is reading its data from. Shown when speech
    /// fails, because the machine that breaks is usually not the machine
    /// the fix is written on.
    data_dir: String,
    voices: Vec<VoiceInfo>,
}

/* ------------------------------------------------------------------ paths */

fn voice_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?
        .join("voices");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn model_paths(app: &tauri::AppHandle, v: &Voice) -> Result<(PathBuf, PathBuf), String> {
    Ok(files_in(&voice_dir(app)?, v))
}

fn installed(app: &tauri::AppHandle, v: &Voice) -> bool {
    voice_dir(app).map(|d| is_installed(&d, v)).unwrap_or(false)
}

fn espeak_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| format!("no resource directory: {e}"))?;
    // Keep the working copy outside the bundle: an update replaces the whole
    // bundle, and a running app that then reaches for its speech data finds
    // the files gone. See `resolve_espeak`.
    let stable = app.path().app_data_dir().ok();
    resolve_espeak_into(&bundled, stable.as_deref())
}

/// Convenience for tests and tools: resolve using only the bundled copy.
pub fn resolve_espeak(bundled: &Path) -> Result<PathBuf, String> {
    resolve_espeak_into(bundled, None)
}

/// Settles on a directory holding `espeak-ng-data` that espeak-ng can still
/// read at any point in the app's life.
///
/// Two constraints, both learned the hard way:
///
///   * espeak-ng keeps its data path in a fixed 160 byte buffer and aborts
///     the process on overflow, so the path is measured before use.
///   * espeak-ng opens its data lazily, at the first phonemization, not when
///     the path is set. Pointing it inside the app bundle therefore breaks as
///     soon as an update replaces that bundle underneath a running app: the
///     first thing spoken afterwards fails with "Failed to initialize
///     eSpeak-ng", permanently, because the engine only initializes once per
///     process. So the working copy lives outside the bundle, in app data,
///     and the bundled copy is only ever the source to refresh it from.
pub fn resolve_espeak_into(bundled: &Path, stable_root: Option<&Path>) -> Result<PathBuf, String> {
    // A cached path is only good while its data is still readable.
    if let Some(dir) = ESPEAK_DIR.lock().map_err(|_| "speech lock poisoned")?.clone() {
        if dir.join("espeak-ng-data").join("phontab").is_file() {
            return Ok(dir);
        }
    }

    let source = bundled.join("espeak-ng-data");
    if !source.is_dir() {
        return Err("the speech data is missing from this build".into());
    }

    // Candidates in order of preference: app data, a short temp path, and
    // failing both, the bundle itself.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(root) = stable_root {
        candidates.push(root.to_path_buf());
    }
    candidates.push(std::env::temp_dir().join("luaux-speech"));

    let mut chosen: Option<PathBuf> = None;
    for candidate in candidates {
        if candidate.as_os_str().len() > MAX_ESPEAK_DIR {
            continue;
        }
        let target = candidate.join("espeak-ng-data");
        if !target.join("phontab").is_file() {
            if copy_tree(&source, &target).is_err() {
                continue;
            }
        }
        chosen = Some(candidate);
        break;
    }

    let chosen = match chosen {
        Some(dir) => dir,
        // Nowhere writable and short enough. The bundle still works until the
        // app is updated, which beats not speaking at all.
        None if bundled.as_os_str().len() <= MAX_ESPEAK_DIR => bundled.to_path_buf(),
        None => return Err("the install path is too long for the speech engine".into()),
    };

    // espeak-rs reads this once, on first use, so it must be set first.
    std::env::set_var("PIPER_ESPEAKNG_DATA_DIRECTORY", &chosen);
    *ESPEAK_DIR.lock().map_err(|_| "speech lock poisoned")? = Some(chosen.clone());
    Ok(chosen)
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("cannot create {}: {e}", to.display()))?;
    let entries = std::fs::read_dir(from).map_err(|e| format!("cannot read {}: {e}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("{e}"))?;
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| format!("{e}"))?;
        }
    }
    Ok(())
}

/* -------------------------------------------------------------- downloads */

async fn fetch_verified(
    url: &str,
    to: &Path,
    expect_bytes: u64,
    expect_sha: &str,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(), String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("cannot reach the voice library: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("the voice library answered {}", response.status()));
    }

    let part = to.with_extension("part");
    let mut file =
        std::fs::File::create(&part).map_err(|e| format!("cannot write {}: {e}", part.display()))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut stream = response;

    loop {
        let chunk = stream
            .chunk()
            .await
            .map_err(|e| format!("the download was interrupted: {e}"))?;
        let Some(chunk) = chunk else { break };
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("cannot write {}: {e}", part.display()))?;
        received += chunk.len() as u64;
        on_progress(received, expect_bytes);
    }
    drop(file);

    let digest = format!("{:x}", hasher.finalize());
    if received != expect_bytes || digest != expect_sha {
        let _ = std::fs::remove_file(&part);
        return Err("the downloaded voice did not match what was expected".into());
    }

    std::fs::rename(&part, to).map_err(|e| format!("cannot finish the download: {e}"))?;
    Ok(())
}

/// Fetches both files of a voice into `dir`, verifying each before it is
/// given its real name. Already-present voices are left alone.
pub async fn fetch_voice(
    dir: &Path,
    v: &Voice,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(), String> {
    if is_installed(dir, v) {
        return Ok(());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let (model, config) = files_in(dir, v);
    let base = format!(
        "https://huggingface.co/rhasspy/piper-voices/resolve/{REVISION}/{}/{}",
        v.path, v.id
    );
    fetch_verified(
        &format!("{base}.onnx.json"),
        &config,
        v.config_bytes,
        v.config_sha,
        on_progress,
    )
    .await?;
    fetch_verified(
        &format!("{base}.onnx"),
        &model,
        v.model_bytes,
        v.model_sha,
        on_progress,
    )
    .await
}

/* ------------------------------------------------------------- synthesis */

/// Splits a beat into the units a person would pause between.
///
/// Handed a whole paragraph, the model runs the sentences together: the full
/// stops are audible as barely a breath, which is what makes a long beat
/// exhausting to listen to. Synthesizing sentence by sentence and inserting
/// real silence is what turns reading into speaking.
///
/// The split is deliberately dumb, because the course prose is plain: a full
/// stop, question mark or exclamation mark followed by a space. Decimals and
/// the few abbreviations are protected by requiring the next character to
/// look like the start of a sentence.
pub fn sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut start = 0usize;

    for i in 0..chars.len() {
        if !matches!(chars[i], '.' | '!' | '?') {
            continue;
        }
        // Must be followed by a space, then something that opens a sentence.
        let Some(&next) = chars.get(i + 1) else { continue };
        if next != ' ' {
            continue;
        }
        match chars.get(i + 2) {
            Some(c) if c.is_uppercase() || c.is_numeric() => {}
            _ => continue,
        }
        // "1. The" or "e.g. this" would split badly; require a real word before.
        let ends_word = chars[start..i]
            .iter()
            .rev()
            .take_while(|c| c.is_alphanumeric())
            .count();
        if ends_word < 2 {
            continue;
        }
        let piece: String = chars[start..=i].iter().collect();
        out.push(piece.trim().to_string());
        start = i + 2;
    }

    if start < chars.len() {
        let rest: String = chars[start..].iter().collect();
        let rest = rest.trim();
        if !rest.is_empty() {
            out.push(rest.to_string());
        }
    }
    if out.is_empty() {
        out.push(text.trim().to_string());
    }
    out
}

/// How long a pause at the end of a sentence should last, in milliseconds.
///
/// Adjustable because the right value is a matter of taste and can only be
/// judged by ear, not derived. Chosen by listening to 0, 180, 300 and 450.
pub const SENTENCE_PAUSE_MS: usize = 450;

/// A comma is a shorter breath than a full stop, not the same one. Roughly
/// four tenths of a sentence pause reads as a clause boundary; giving it the
/// full pause makes every sentence sound like several.
pub const CLAUSE_PAUSE_MS: usize = 180;

/// Splitting at a comma is only worth it when both halves are long enough to
/// carry their own phrasing. Below this, the fragment sounds clipped and the
/// comma is better left inside one utterance.
const MIN_CLAUSE_WORDS: usize = 4;

/// Splits a sentence at its commas, keeping each comma attached to the words
/// before it.
///
/// Keeping the punctuation matters more than the split: with the comma still
/// there the model produces the rising, unfinished contour that a clause
/// should have. Strip it and every fragment lands like a full stop, which is
/// worse than not splitting at all.
fn clauses(sentence: &str) -> Vec<String> {
    let chars: Vec<char> = sentence.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut start = 0usize;

    let word_count = |s: &[char]| s.split(|c: &char| c.is_whitespace()).filter(|w| !w.is_empty()).count();

    for i in 0..chars.len() {
        if chars[i] != ',' && chars[i] != ';' && chars[i] != ':' {
            continue;
        }
        if chars.get(i + 1) != Some(&' ') {
            continue;
        }
        let left = &chars[start..=i];
        let right = &chars[i + 1..];
        if word_count(left) < MIN_CLAUSE_WORDS || word_count(right) < MIN_CLAUSE_WORDS {
            continue;
        }
        out.push(left.iter().collect::<String>().trim().to_string());
        start = i + 1;
    }

    if start < chars.len() {
        let rest: String = chars[start..].iter().collect();
        let rest = rest.trim().to_string();
        if !rest.is_empty() {
            out.push(rest);
        }
    }
    if out.is_empty() {
        out.push(sentence.trim().to_string());
    }
    out
}

/// The beat broken into what gets spoken, each with the silence that follows
/// it. The last piece carries no pause.
pub fn segments(text: &str, sentence_pause: usize) -> Vec<(String, usize)> {
    let clause_pause = sentence_pause * CLAUSE_PAUSE_MS / SENTENCE_PAUSE_MS;
    let sentences = sentences(text);
    let mut out: Vec<(String, usize)> = Vec::new();

    for (s_index, sentence) in sentences.iter().enumerate() {
        let parts = clauses(sentence);
        let last_sentence = s_index + 1 == sentences.len();
        for (c_index, part) in parts.iter().enumerate() {
            let last_clause = c_index + 1 == parts.len();
            let pause = match (last_sentence, last_clause) {
                (true, true) => 0,
                (_, true) => sentence_pause,
                _ => clause_pause,
            };
            out.push((part.clone(), pause));
        }
    }
    out
}

/// A touch under one, so the tutor explains rather than announces.
const PACE: f32 = 1.06;

/// Trims the near-silent head and tail of one synthesized sentence, and
/// fades the remaining edges.
///
/// Measuring the model's output showed it leaves almost no silence at a full
/// stop: one 80 ms dip across four sentences. So the pause has to be made,
/// not stretched, which means synthesizing sentence by sentence. The cost of
/// that is a hard cut at each join, audible as a click; trimming to the
/// actual speech and fading a few milliseconds removes it.
fn trim_and_fade(samples: &[f32], rate: u32) -> &[f32] {
    const SILENCE: f32 = 0.006;
    let first = samples.iter().position(|s| s.abs() >= SILENCE).unwrap_or(0);
    let last = samples
        .iter()
        .rposition(|s| s.abs() >= SILENCE)
        .unwrap_or(samples.len().saturating_sub(1));
    // Keep a little air either side so consonants are not clipped.
    let air = rate as usize / 100; // 10 ms
    let start = first.saturating_sub(air);
    let end = (last + air).min(samples.len());
    &samples[start..end]
}

fn fade_edges(buf: &mut [f32], rate: u32) {
    let n = (rate as usize / 200).max(1); // 5 ms
    let len = buf.len();
    if len < n * 2 {
        return;
    }
    for i in 0..n {
        let g = i as f32 / n as f32;
        buf[i] *= g;
        buf[len - 1 - i] *= g;
    }
}

/// Speaks `text` with an already-installed voice, reusing the loaded model
/// when the voice has not changed.
pub fn synthesize(id: &str, model: &Path, config: &Path, text: &str) -> Result<Vec<u8>, String> {
    synthesize_with(id, model, config, text, SENTENCE_PAUSE_MS)
}

/// As `synthesize`, with the sentence pause given explicitly. Separate so the
/// length can be compared by ear without rebuilding the app.
pub fn synthesize_with(
    id: &str,
    model: &Path,
    config: &Path,
    text: &str,
    pause_ms: usize,
) -> Result<Vec<u8>, String> {
    let mut held = LOADED.lock().map_err(|_| "speech lock poisoned")?;
    let reload = held.as_ref().map(|(loaded, _)| loaded != id).unwrap_or(true);
    if reload {
        let piper = piper_rs::Piper::new(model, config)
            .map_err(|e| format!("cannot load that voice: {e}"))?;
        *held = Some((id.to_string(), piper));
    }
    let (_, piper) = held.as_mut().ok_or("no voice loaded")?;

    let mut all: Vec<f32> = Vec::new();
    let mut rate = 22_050u32;

    for (piece, pause) in segments(text, pause_ms) {
        let (samples, r) = piper
            .create(&piece, false, None, Some(PACE), None, None)
            .map_err(|e| format!("cannot speak that: {e}"))?;
        rate = r;
        let mut piece_audio = trim_and_fade(&samples, rate).to_vec();
        fade_edges(&mut piece_audio, rate);
        all.append(&mut piece_audio);
        if pause > 0 {
            all.extend(std::iter::repeat(0.0).take(rate as usize * pause / 1000));
        }
    }

    Ok(wav(&all, rate))
}

fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let bytes = samples.len() * 2;
    let mut out = Vec::with_capacity(44 + bytes);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&((36 + bytes) as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM header length
    out.extend_from_slice(&1u16.to_le_bytes()); // uncompressed
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes()); // bytes per second
    out.extend_from_slice(&2u16.to_le_bytes()); // bytes per frame
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(bytes as u32).to_le_bytes());
    for s in samples {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    out
}

/* ------------------------------------------------------------- commands */

#[tauri::command]
pub fn piper_status(app: tauri::AppHandle) -> Status {
    let (reason, data_dir) = match espeak_dir(&app) {
        Ok(dir) => (String::new(), dir.display().to_string()),
        Err(e) => (e, String::new()),
    };
    Status {
        available: reason.is_empty(),
        reason,
        data_dir,
        voices: VOICES
            .iter()
            .map(|v| VoiceInfo {
                id: v.id.into(),
                label: v.label.into(),
                accent: v.accent.into(),
                gender: v.gender.into(),
                installed: installed(&app, v),
                bytes: v.model_bytes + v.config_bytes,
            })
            .collect(),
    }
}

/// Fetches a voice if it is not already here. Safe to call repeatedly.
#[tauri::command]
pub async fn piper_install(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let v = voice(&id).ok_or_else(|| format!("unknown voice {id}"))?;
    let dir = voice_dir(&app)?;
    let reporter = app.clone();
    let report = move |received: u64, total: u64| {
        let _ = reporter.emit(
            "piper-progress",
            serde_json::json!({
                "voice": v.id, "label": v.label,
                "received": received, "total": total,
            }),
        );
    };
    fetch_voice(&dir, v, &report).await
}

/// Deletes a downloaded voice. A voice is 60 to 120 MB, so being able to
/// take one back off the disk matters on a small machine.
#[tauri::command]
pub fn piper_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let v = voice(&id).ok_or_else(|| format!("unknown voice {id}"))?;
    let (model, config) = model_paths(&app, v)?;

    // Drop it from memory first, or the file goes and the loaded copy stays.
    if let Ok(mut held) = LOADED.lock() {
        if held.as_ref().map(|(loaded, _)| loaded == &id).unwrap_or(false) {
            *held = None;
        }
    }

    for path in [model, config] {
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("cannot remove {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

/// Speaks `text` in `id`, returning a WAV the page can play. The voice must
/// already be installed; the caller decides when to download.
#[tauri::command]
pub async fn piper_speak(
    app: tauri::AppHandle,
    id: String,
    text: String,
) -> Result<tauri::ipc::Response, String> {
    let v = voice(&id).ok_or_else(|| format!("unknown voice {id}"))?;
    if !installed(&app, v) {
        return Err("that voice is not downloaded yet".into());
    }
    espeak_dir(&app)?;
    let (model, config) = model_paths(&app, v)?;

    let audio = tauri::async_runtime::spawn_blocking(move || synthesize(&id, &model, &config, &text))
        .await
        .map_err(|e| format!("speech did not finish: {e}"))??;

    Ok(tauri::ipc::Response::new(audio))
}
