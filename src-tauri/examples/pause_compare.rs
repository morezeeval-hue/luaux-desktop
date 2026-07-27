//! Writes the same beat at several sentence-pause lengths, so the right one
//! can be chosen by ear instead of argued about.
//!
//!   cargo run --release --example pause_compare -- <resource_dir> <voice_dir> <voice_id> <out_dir>

#[path = "../src/piper.rs"]
mod piper;

use std::path::Path;

const BEAT: &str = "Everyone in a multiplayer game sees the same world, even though they are \
on different computers. Picture the world as a shared storybook. The server is the author. \
It writes down everything that happens.";

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let resources = Path::new(&a[1]);
    let voices = Path::new(&a[2]);
    let id = &a[3];
    let out = Path::new(&a[4]);

    piper::resolve_espeak(resources).expect("espeak data");
    let v = piper::voice(id).expect("known voice");
    let (model, config) = piper::files_in(voices, v);
    std::fs::create_dir_all(out).unwrap();

    for ms in [0usize, 180, 300, 450] {
        let wav = piper::synthesize_with(id, &model, &config, BEAT, ms).expect("synth");
        let secs = (wav.len() - 44) as f32 / 2.0 / 22050.0;
        let name = if ms == 0 {
            "pause_0_wie_bisher.wav".to_string()
        } else {
            format!("pause_{ms}ms.wav")
        };
        std::fs::write(out.join(&name), &wav).unwrap();
        println!("{name}: {secs:.2}s");
    }
}
