#!/usr/bin/env python3
"""Prototype A2: each word read stretched, sound by sound, in one ElevenLabs clip with timestamps.

For every word and every spelling variant, the text is built from one piece per grapheme
("Mmm", "auuu", "sss"), so the character timestamps ElevenLabs returns map back to the word's
letters. Writes prototypes-out/stretched/<id>.<variant>.mp3 and .json (git-ignored).
`pick.py` then copies the chosen variant into audio/stretch-<id>.mp3 and src/stretched.json.

    KF="$(git rev-parse --path-format=absolute --git-common-dir)/../.secrets/elevenlabs.key"
    ELEVENLABS_KEY_FILE="$KF" python3 scripts/prototypes/stretched/render.py [--only maus,hut]
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "prototypes-out" / "stretched"
VOICE = "AJX546nEWdCoekjOePfl"
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_v4")
BEFORE = "Haus. Baum. Sonne. Hund. Katze. Apfel. Brot. Mond."

# Per word: the graphemes as they are written, and the stretched piece spoken for each.
# Holdable sounds are tripled; stops (and the breath h) stay single. Hund ends in a spoken t.
WORDS: dict[str, list[tuple[str, str]]] = {
    "oma": [("O", "Ooo"), ("m", "mmm"), ("a", "aaa")],
    "mama": [("M", "Mmm"), ("a", "aaa"), ("m", "mmm"), ("a", "aaa")],
    "maus": [("M", "Mmm"), ("au", "auuu"), ("s", "sss")],
    "hase": [("H", "H"), ("a", "aaa"), ("s", "sss"), ("e", "e")],
    "hut": [("H", "H"), ("u", "uuu"), ("t", "t")],
    "bus": [("B", "B"), ("u", "uuu"), ("s", "sss")],
    "igel": [("I", "Iii"), ("g", "g"), ("e", "e"), ("l", "lll")],
    "hund": [("H", "H"), ("u", "uuu"), ("n", "nnn"), ("d", "t")],
}
STOPS = set("bdgkpth")


def spell(pieces: list[str], variant: str) -> tuple[str, list[tuple[int, int]]]:
    """The text to speak and, per grapheme, its character range in that text."""
    text, spans = "", []
    for i, piece in enumerate(pieces):
        if i:
            prev, cur = pieces[i - 1], piece
            short = prev.lower() in STOPS or cur.lower() in STOPS
            if variant == "dash":
                text += "-"
            elif variant == "pause":
                # Stops glued to their neighbour, held sounds apart with a pause.
                text += "" if short else "… "
            # "joined": nothing between the pieces
        if variant == "joined" and i:
            piece = piece.lower()
        spans.append((len(text), len(text) + len(piece)))
        text += piece
    return text, spans


def api_key() -> str:
    path = os.environ.get("ELEVENLABS_KEY_FILE")
    if not path:
        sys.exit("ELEVENLABS_KEY_FILE names the key file")
    return Path(path).expanduser().read_text().strip()


def render(text: str) -> dict:
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=pcm_24000",
        json.dumps({"text": text, "model_id": MODEL, "language_code": "de",
                    "previous_text": BEFORE, "voice_settings": {"speed": 0.9}}).encode(),
        {"xi-api-key": api_key(), "Content-Type": "application/json"},
    )
    try:
        return json.load(urllib.request.urlopen(request, timeout=90))
    except urllib.error.HTTPError as exc:
        sys.exit(f"ElevenLabs answered {exc.code}: {exc.read()[:300].decode(errors='replace')}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only")
    parser.add_argument("--variants", default="dash,joined,pause")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    for wid, graphemes in WORDS.items():
        if only and wid not in only:
            continue
        for variant in args.variants.split(","):
            text, spans = spell([p for _, p in graphemes], variant)
            data = render(text)
            al = data["alignment"]
            starts, ends = al["character_start_times_seconds"], al["character_end_times_seconds"]
            marks = [{"g": g, "piece": text[a:b], "start": starts[a], "end": ends[b - 1]}
                     for (g, _), (a, b) in zip(graphemes, spans)]
            stem = f"{wid}.{variant}"
            path = lambda ext: OUT / f"{stem}.{ext}"
            raw = path("pcm")
            raw.write_bytes(base64.b64decode(data["audio_base64"]))
            # Loudness only, no trimming: the timestamps count from the clip's first sample.
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                            "-i", str(raw), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100",
                            "-b:a", "64k", str(path("mp3"))], check=True)
            path("wav").unlink(missing_ok=True)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", "24000", "-ac", "1",
                            "-i", str(raw), "-ar", "16000", str(path("wav"))], check=True)
            raw.unlink()
            path("json").write_text(json.dumps(
                {"text": text, "marks": marks, "duration": ends[-1]}, ensure_ascii=False, indent=1))
            print(f"{wid:5} {variant:6} {text!r:28} " + " ".join(f"{m['g']}@{m['start']:.2f}" for m in marks))


if __name__ == "__main__":
    main()
