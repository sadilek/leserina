#!/usr/bin/env python3
"""Render one spoken clip per word into audio/<id>.mp3, in the owner's cloned voice.

The voice command takes text on stdin and writes a WAV to $DEMO_WAV. By default it is the
local Qwen3-TTS clone in ~/dev/stimmzwilling (the same command Obeya's demos use); set
LESERINA_TTS_CMD to use another one. Each word is spoken as a sentence ("Ball."), because
single words come out with odd intonation more often. ffmpeg trims the silence around the
clip, evens out the loudness and encodes it as MP3.

    python3 scripts/render_audio.py                   # every word without a clip yet
    python3 scripts/render_audio.py --only ball,hut   # re-render these (overwrites)
    python3 scripts/render_audio.py --names Lena,Max  # the children's names, audio/name-<id>.mp3
"""

from __future__ import annotations

import argparse
import csv
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "words-source.csv"
AUDIO = ROOT / "audio"
DEFAULT_CMD = (
    "uv run --quiet --project ~/dev/stimmzwilling "
    "python ~/dev/stimmzwilling/scripts/demo_voice.py"
)
# Trim leading and trailing silence, then normalise loudness so all clips sound equally loud.
FILTER = (
    "silenceremove=start_periods=1:start_duration=0.04:start_threshold=-45dB:start_silence=0.05,"
    "areverse,silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB:start_silence=0.1,areverse,"
    "loudnorm=I=-16:TP=-1.5:LRA=11"
)


def slug(text: str) -> str:
    """The ASCII file name for a word or name, as the app computes it (src/slug.ts)."""
    out = text.strip().lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        out = out.replace(a, b)
    return "".join(c if c.isalnum() else "-" for c in out).strip("-")


def render(text: str, target: Path, command: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "clip.wav"
        env = dict(os.environ, DEMO_WAV=str(wav))
        subprocess.run(command, shell=True, input=text.encode(), env=env, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-af", FILTER,
             "-ar", "44100", "-ac", "1", "-b:a", "64k", str(target)],
            check=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated word ids to (re-)render, overwriting")
    parser.add_argument("--names", help="comma-separated children's names to render")
    parser.add_argument("--force", action="store_true", help="re-render clips that exist")
    args = parser.parse_args()
    command = os.environ.get("LESERINA_TTS_CMD", DEFAULT_CMD)
    AUDIO.mkdir(exist_ok=True)

    jobs: list[tuple[str, Path]] = []
    if args.names:
        for name in [n.strip() for n in args.names.split(",") if n.strip()]:
            jobs.append((f"{name}.", AUDIO / f"name-{slug(name)}.mp3"))
    else:
        only = {s.strip() for s in args.only.split(",")} if args.only else None
        with SOURCE.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if only is not None and row["id"] not in only:
                    continue
                target = AUDIO / f"{row['id']}.mp3"
                if target.exists() and not (args.force or only):
                    continue
                jobs.append((f"{row['word']}.", target))

    for i, (text, target) in enumerate(jobs, 1):
        started = time.monotonic()
        try:
            render(text, target, command)
        except subprocess.CalledProcessError as exc:
            print(f"[{i}/{len(jobs)}] {text} FAILED: {exc}", file=sys.stderr)
            continue
        print(f"[{i}/{len(jobs)}] {text} -> {target.name} ({time.monotonic() - started:.1f} s)", flush=True)


if __name__ == "__main__":
    main()
