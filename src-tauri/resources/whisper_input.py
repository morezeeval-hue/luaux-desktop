#!/usr/bin/env python3
"""Local faster-whisper installer and one-shot transcriber for LuauX.

The app calls this file through Python. `--install` creates an app-private
virtual environment and downloads `small.en` once. `--transcribe` reads an
audio file and prints one JSON response. No recording is uploaded anywhere.
"""

import argparse
import json
import subprocess
import sys
import venv
from pathlib import Path


MODEL = "small.en"


def venv_python(home: Path) -> Path:
    return home / "venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def ready_file(home: Path) -> Path:
    return home / "small.en.ready.json"


def model(home: Path):
    from faster_whisper import WhisperModel

    return WhisperModel(MODEL, device="cpu", compute_type="int8", download_root=str(home / "models"))


def warm_model(home: Path) -> None:
    model(home)
    ready_file(home).write_text(json.dumps({"model": MODEL}), encoding="utf-8")
    print(json.dumps({"ok": True, "model": MODEL}), flush=True)


def install(home: Path) -> None:
    home.mkdir(parents=True, exist_ok=True)
    interpreter = venv_python(home)
    if not interpreter.exists():
        venv.EnvBuilder(with_pip=True).create(home / "venv")
    if ready_file(home).is_file():
        print(json.dumps({"ok": True, "model": MODEL, "alreadyInstalled": True}), flush=True)
        return
    subprocess.check_call([str(interpreter), "-m", "pip", "install", "--upgrade", "pip", "faster-whisper==1.2.1"])
    subprocess.check_call([str(interpreter), str(Path(__file__).resolve()), "--warm-model", "--home", str(home)])


def transcribe(home: Path, audio: Path) -> None:
    if not ready_file(home).is_file():
        raise RuntimeError("small.en is not installed")
    segments, _info = model(home).transcribe(
        str(audio), language="en", beam_size=1, vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(json.dumps({"text": text}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", required=True, type=Path)
    parser.add_argument("--install", action="store_true")
    parser.add_argument("--warm-model", action="store_true")
    parser.add_argument("--transcribe", type=Path)
    args = parser.parse_args()

    if args.install:
        install(args.home)
    elif args.warm_model:
        warm_model(args.home)
    elif args.transcribe:
        transcribe(args.home, args.transcribe)
    else:
        parser.error("choose --install, --warm-model, or --transcribe")


if __name__ == "__main__":
    main()
