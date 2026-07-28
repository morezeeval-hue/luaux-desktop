//! Exercises the speech path the app actually uses, without a window.
//!
//! The GUI cannot be driven from a headless run, so this drives the same
//! functions the Tauri commands call: locate the bundled espeak data, fetch
//! and verify a voice, synthesize, and check the audio is real.
//!
//!   cargo run --release --example speech_selftest -- <resource_dir> <voice_dir> [voice_id ...]

#[path = "../src/piper.rs"]
mod piper;

use std::path::Path;

fn rms(wav: &[u8]) -> (f64, i16, f64) {
    let pcm = &wav[44..];
    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    let sum: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    let peak = samples.iter().map(|s| s.abs()).max().unwrap_or(0);
    (
        (sum / samples.len() as f64).sqrt(),
        peak,
        samples.len() as f64 / 22050.0,
    )
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let resources = Path::new(&args[1]);
    let voices = Path::new(&args[2]);
    let wanted: Vec<&str> = if args.len() > 3 {
        args[3..].iter().map(|s| s.as_str()).collect()
    } else {
        vec!["en_US-amy-medium"]
    };

    let mut failures = 0;

    // Sentence splitting decides where the tutor breathes, so check the
    // cases that would sound wrong before touching any audio.
    let split_cases: &[(&str, usize)] = &[
        ("One thing. Two things.", 2),
        ("Only one thing here.", 1),
        ("It takes 1.5 seconds to load. Then it stops.", 2),
        ("Ask yourself: is it fast? It is. But it is not free.", 3),
        ("A trailing thought with no full stop", 1),
        ("", 1),
        // A following lowercase word means an abbreviation far more often
        // than a new sentence, so these stay joined on purpose.
        ("Fine. e.g. this stays joined.", 1),
        ("Use it, e.g. for a part. Then move on.", 2),
    ];
    for (input, want) in split_cases {
        let got = piper::sentences(input).len();
        if got != *want {
            println!("FAIL split {input:?}: wanted {want} pieces, got {got} -> {:?}", piper::sentences(input));
            failures += 1;
        }
    }
    println!("sentence splitting: {} cases checked", split_cases.len());

    // Commas get their own, shorter pause, but only where both halves can
    // carry phrasing, and the comma must stay attached or the fragment lands
    // like a full stop.
    let comma_cases: &[(&str, usize)] = &[
        // Two clauses, both long enough: split.
        ("Everyone in a multiplayer game sees the same world, even though they are on different computers.", 2),
        // Second half too short to stand alone: left whole.
        ("Hello, and welcome.", 1),
        // First half too short: left whole.
        ("It is fast, but it is not free at all here.", 1),
    ];
    for (input, want) in comma_cases {
        let got = piper::segments(input, piper::SENTENCE_PAUSE_MS);
        if got.len() != *want {
            println!("FAIL clause {input:?}: wanted {want}, got {} -> {:?}", got.len(),
                     got.iter().map(|(s, p)| format!("{s} +{p}ms")).collect::<Vec<_>>());
            failures += 1;
        }
        if let Some((first, _)) = got.first() {
            if got.len() > 1 && !(first.ends_with(',') || first.ends_with(';') || first.ends_with(':')) {
                println!("FAIL clause {input:?}: punctuation was stripped from {first:?}");
                failures += 1;
            }
        }
    }
    // The last piece must never carry a trailing pause.
    let tail = piper::segments("One thing. Two things.", piper::SENTENCE_PAUSE_MS);
    if tail.last().map(|(_, p)| *p) != Some(0) {
        println!("FAIL: the final segment carries a pause");
        failures += 1;
    }
    println!("clause splitting: {} cases checked", comma_cases.len());

    // The working copy must live outside the app bundle. An update replaces
    // the bundle wholesale, and espeak-ng opens its data lazily, so a copy
    // inside the bundle disappears under a running app and every later
    // sentence fails permanently. Resolve into a scratch root and check the
    // data was really taken out of the bundle.
    let stable = std::env::temp_dir().join("luaux-espeak-check");
    let _ = std::fs::remove_dir_all(&stable);
    let dir = piper::resolve_espeak_into(resources, Some(&stable)).expect("espeak data");
    println!("espeak data: {} ({} chars)", dir.display(), dir.as_os_str().len());
    if dir.starts_with(resources) {
        println!("FAIL: speech data was left inside the app bundle");
        failures += 1;
    } else if !dir.join("espeak-ng-data").join("phontab").is_file() {
        println!("FAIL: the copied speech data is incomplete");
        failures += 1;
    } else {
        println!("speech data copied out of the bundle, survives an update");
    }
    for id in wanted {
        let v = piper::voice(id).expect("known voice");
        let started = std::time::Instant::now();
        let report = |received: u64, total: u64| {
            if total > 1_000_000 && received % (16 * 1024 * 1024) < 65_536 {
                println!("  {} MB of {} MB", received / 1_000_000, total / 1_000_000);
            }
        };
        if let Err(e) = piper::fetch_voice(voices, v, &report).await {
            println!("FAIL {id}: {e}");
            failures += 1;
            continue;
        }
        println!("{id}: fetched and verified in {:?}", started.elapsed());

        let (model, config) = piper::files_in(voices, v);
        let default_text =
            "Every property access crosses that boundary. It is fast, but it is not free.";
        let owned = std::env::var("LUAUX_TEXT").unwrap_or_else(|_| default_text.to_string());
        let text = owned.as_str();
        let t = std::time::Instant::now();
        match piper::synthesize(id, &model, &config, text) {
            Ok(wav) => {
                let (level, peak, secs) = rms(&wav);
                let _ = std::fs::write(voices.join(format!("{id}.sample.wav")), &wav);
                let ok = wav.starts_with(b"RIFF") && level > 500.0 && secs > 2.0;
                println!(
                    "{id}: {} bytes, {secs:.2}s audio, rms {level:.0}, peak {peak}, synth {:?} -> {}",
                    wav.len(),
                    t.elapsed(),
                    if ok { "ok" } else { "SUSPECT" }
                );
                if !ok {
                    failures += 1;
                }
            }
            Err(e) => {
                println!("FAIL {id}: {e}");
                failures += 1;
            }
        }
    }

    // The failure this guards against: an update replaces the app bundle
    // while the app runs, and every later sentence dies with "Failed to
    // initialize eSpeak-ng", for the life of the process. Reproduce it by
    // deleting the bundle between two sentences in one process.
    //
    // Only ever run against a stand-in under the temp directory; pointing it
    // at a real installation would delete it.
    if std::env::var("LUAUX_SIMULATE_UPDATE").is_ok() {
        if !resources.starts_with(std::env::temp_dir()) {
            println!("refusing to simulate an update against {}", resources.display());
            failures += 1;
        } else {
            std::fs::remove_dir_all(resources).expect("remove the stand-in bundle");
            let v = piper::voice("en_US-ryan-high").unwrap();
            let (model, config) = piper::files_in(voices, v);
            match piper::synthesize("en_US-ryan-high", &model, &config, "The bundle is gone now.") {
                Ok(wav) if wav.len() > 44 => println!("still speaks after the bundle was replaced"),
                Ok(_) => {
                    println!("FAIL: produced no audio after the bundle was replaced");
                    failures += 1;
                }
                Err(e) => {
                    println!("FAIL: speech died after the bundle was replaced: {e}");
                    failures += 1;
                }
            }
        }
    }

    // A truncated file must be rejected rather than loaded.
    let v = piper::voice("en_US-amy-medium").unwrap();
    let (model, _) = piper::files_in(voices, v);
    if model.exists() {
        let broken = voices.join("broken");
        std::fs::create_dir_all(&broken).unwrap();
        let (bm, bc) = piper::files_in(&broken, v);
        std::fs::write(&bm, b"not a model").unwrap();
        std::fs::write(&bc, b"{}").unwrap();
        if piper::is_installed(&broken, v) {
            println!("FAIL: a truncated voice was treated as installed");
            failures += 1;
        } else {
            println!("truncated voice correctly rejected");
        }
        let _ = std::fs::remove_dir_all(&broken);
    }

    println!("{}", if failures == 0 { "ALL OK" } else { "FAILURES" });
    std::process::exit(if failures == 0 { 0 } else { 1 });
}
