#!/usr/bin/env python3
"""Transcribe every clip in audio/ with Whisper and list those that do not say their word.

A machine check before listening: it catches clips where the voice clone mumbled, added a
syllable or said something else. Whisper runs from the stimmzwilling project's environment:

    uv run --project ~/dev/stimmzwilling python scripts/check_audio.py

Flagged words can be re-rendered with: python3 scripts/render_audio.py --only id1,id2
"""

from __future__ import annotations

import argparse
import csv
import re
import subprocess
import tempfile
from pathlib import Path

import mlx_whisper

ROOT = Path(__file__).resolve().parent.parent
MODEL = "mlx-community/whisper-large-v3-turbo"


def norm(text: str) -> str:
    return re.sub(r"[^a-zäöüß]", "", text.lower())


def padded(clip: Path, tmp: Path) -> str:
    """The clip with a second of silence around it: Whisper invents text for very short audio."""
    out = tmp / f"{clip.stem}.wav"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", str(clip), "-af", "adelay=1000,apad=pad_dur=1",
         "-ar", "16000", "-ac", "1", str(out)],
        check=True,
    )
    return str(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="comma-separated word ids to check")
    args = parser.parse_args()
    tmp = Path(tempfile.mkdtemp())
    with (ROOT / "data" / "words-source.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if args.only:
        only = set(args.only.split(","))
        rows = [r for r in rows if r["id"] in only]
    flagged = []
    for row in rows:
        clip = ROOT / "audio" / f"{row['id']}.mp3"
        if not clip.exists():
            flagged.append((row["id"], row["word"], "(no clip)"))
            continue
        heard = mlx_whisper.transcribe(
            padded(clip, tmp), path_or_hf_repo=MODEL, language="de",
            initial_prompt="Ein Wort:", condition_on_previous_text=False,
        )["text"].strip()
        ok = norm(heard) == norm(row["word"])
        print(f"{'  ' if ok else '!!'} {row['word']:<16} heard: {heard}", flush=True)
        if not ok:
            flagged.append((row["id"], row["word"], heard))
    print(f"\n{len(flagged)} of {len(rows)} clips to check:")
    for id_, word, heard in flagged:
        print(f"  {id_:<16} {word:<16} heard: {heard}")
    if flagged:
        print("\nRe-render: python3 scripts/render_audio.py --only " + ",".join(f[0] for f in flagged))


if __name__ == "__main__":
    main()
