#!/usr/bin/env python3
# /// script
# dependencies = ["numpy"]
# ///
"""Render each word read stretched, sound by sound ("Mmm-auuu-sss"), into audio/stretched/<id>.mp3.

The game plays this clip after a match and lights up each grapheme as its sound starts, then the
word's own clip. One clip per word, spoken by the owner's ElevenLabs voice: within a word, the
voice gets sounds right that it gets wrong alone (b, d, t come out as "Be", "De", "Te" alone).

The text is one piece per grapheme of the word's sounds in words.json (`scripts/phonics.py`),
joined with dashes: sounds that can be held are written three times ("mmm", "aaa"), the others
once ("t", "r"), so the voice holds the one and not the other. With dashes the sounds came out
held and continuous; written together they ran into each other, and with "…" between them they
fell apart with long gaps. "rrr" came out as a rolled r, and "www" was read as an abbreviation,
letter by letter and with the dashes spoken ("Weh Weh Weh Bindestrich …"), so r and w stay single.

When each grapheme lights up: ElevenLabs returns when each character starts, but those times
often lag the sound by 0.1-0.25 s and are coarse. So each grapheme's time is where the spectrum
changes most between the end of the piece before it and just after its own start in ElevenLabs'
times; a change of sound is a change of spectrum. src/stretched.json keeps these times per word,
with the graphemes and the text they belong to. A word whose graphemes or text change needs its
clip rendered again; this script does so by default, and the tests fail until it has.

    KF="$(git rev-parse --path-format=absolute --git-common-dir)/../.secrets/elevenlabs.key"
    ELEVENLABS_KEY_FILE="$KF" uv run scripts/render_stretched.py             # missing or outdated
    ELEVENLABS_KEY_FILE="$KF" uv run scripts/render_stretched.py --only hut  # these again

Then `uv run scripts/check_stretched.py` lists the clips to listen to first.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tts_elevenlabs as tts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORDS = ROOT / "words.json"
AUDIO = ROOT / "audio" / "stretched"
TIMES = ROOT / "src" / "stretched.json"

# What the voice is given for each sound (codes in scripts/phonics.py). Short vowels are held like
# long ones: in first grade every sound that can be held is ("gedehntes Sprechen").
PIECES = {
    **{v: v * 3 for v in "aeiouäöü"},
    **{v + ":": v * 3 for v in "aeiouäöü"},
    "au": "auuu", "ei": "eiii", "eu": "euuu", "ə": "e", "ɐ": "er",
    "m": "mmm", "n": "nnn", "l": "lll", "f": "fff", "w": "w", "s": "sss", "z": "sss",
    "sch": "schhh", "ch": "chhh", "r": "r", "ng": "ng", "j": "j", "h": "h",
    "b": "b", "d": "d", "g": "g", "p": "p", "t": "t", "k": "k",
    "ts": "ts", "pf": "pf", "ks": "ks", "kw": "kw",
}
# Trailing silence goes; the start stays, because the times count from the clip's first sample.
FILTER = (
    "areverse,silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB:start_silence=0.1,"
    "areverse,loudnorm=I=-16:TP=-1.5:LRA=11"
)
HOP = 0.005  # s between spectra
SPAN = 6  # spectra averaged on each side of a point, 30 ms
BEFORE, AFTER = 0.1, 0.06  # s searched before the piece's dash and after its start
GAP = 0.08  # s at least between two graphemes lighting up


def spell(sounds: list[list[str]]) -> tuple[str, list[int]]:
    """The text to speak, and where in it each grapheme's piece starts."""
    text, starts = "", []
    for i, (_, code) in enumerate(sounds):
        piece = PIECES[code]
        if i:
            text += "-"
        else:
            piece = piece[0].upper() + piece[1:]
        starts.append(len(text))
        text += piece
    return text, starts


def speak(text: str) -> dict:
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{tts.VOICE}/with-timestamps?output_format=pcm_{tts.RATE}",
        json.dumps({"text": text, "model_id": tts.MODEL, "language_code": "de",
                    "previous_text": tts.BEFORE, "voice_settings": {"speed": tts.SPEED}}).encode(),
        {"xi-api-key": tts.api_key(), "Content-Type": "application/json"},
    )
    try:
        return json.load(urllib.request.urlopen(request, timeout=90))
    except urllib.error.HTTPError as exc:
        sys.exit(f"ElevenLabs answered {exc.code}: {exc.read()[:300].decode(errors='replace')}")


def change(x: np.ndarray, rate: int) -> np.ndarray:
    """How much the spectrum changes at each point (every HOP s): the distance between the mean
    log spectra (32 bands, 100 Hz-8 kHz) just before and just after it."""
    n, hop = int(0.025 * rate), int(HOP * rate)
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(x, (n // 2, n)), n)[::hop] * np.hanning(n)
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(n, 1 / rate)
    edges = np.geomspace(100, 8000, 33)
    bands = np.log(np.stack([power[:, (freqs >= a) & (freqs < b)].sum(1) for a, b in zip(edges[:-1], edges[1:])], 1) + 1e-6)
    sums = np.vstack([np.zeros(bands.shape[1]), np.cumsum(bands, 0)])
    out = np.zeros(len(bands))
    for t in range(SPAN, len(bands) - SPAN):
        out[t] = np.linalg.norm((sums[t + SPAN] - sums[t]) - (sums[t] - sums[t - SPAN])) / SPAN
    return out


def marks(x: np.ndarray, rate: int, alignment: dict, starts: list[int]) -> list[float]:
    """When each grapheme's sound starts: the strongest change of spectrum near ElevenLabs' time."""
    c = change(x, rate)
    times = alignment["character_start_times_seconds"]
    out = [0.0]
    for s in starts[1:]:
        lo = max(times[s - 1] - BEFORE, out[-1] + GAP)  # times[s - 1] is the dash before the piece
        hi = max(times[s] + AFTER, lo + HOP)
        a, b = int(lo / HOP), min(int(hi / HOP) + 1, len(c))
        out.append(round((a + int(np.argmax(c[a:b]))) * HOP if b > a else times[s], 3))
    return out


def render(word: dict, target: Path) -> dict:
    """Render one word's clip to `target` (an MP3) and return its entry for src/stretched.json."""
    text, starts = spell(word["sounds"])
    data = speak(text)
    pcm = base64.b64decode(data["audio_base64"])
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
    raw = target.with_suffix(".pcm")
    raw.write_bytes(pcm)
    try:
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(tts.RATE), "-ac", "1",
                        "-i", str(raw), "-af", FILTER, "-ar", "44100", "-b:a", "64k", str(target)], check=True)
    finally:
        raw.unlink()
    return {
        "graphemes": "|".join(g for g, _ in word["sounds"]),
        "text": text,
        "marks": marks(x, tts.RATE, data["alignment"], starts),
    }


def outdated(word: dict, entry: dict | None) -> bool:
    return (not entry or not (AUDIO / f"{word['id']}.mp3").exists()
            or entry.get("graphemes") != "|".join(g for g, _ in word["sounds"])
            or entry.get("text") != spell(word["sounds"])[0])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated word ids to render again")
    args = parser.parse_args()
    words = json.loads(WORDS.read_text(encoding="utf-8"))
    times = json.loads(TIMES.read_text(encoding="utf-8")) if TIMES.exists() else {}
    only = set(args.only.split(",")) if args.only else None
    jobs = [w for w in words if (w["id"] in only if only else outdated(w, times.get(w["id"])))]
    AUDIO.mkdir(parents=True, exist_ok=True)
    for i, word in enumerate(jobs, 1):
        times[word["id"]] = render(word, AUDIO / f"{word['id']}.mp3")
        # Written after every word, so an interrupted run keeps what it rendered.
        ordered = {w["id"]: times[w["id"]] for w in words if w["id"] in times}
        TIMES.write_text("{\n" + ",\n".join(f" {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}"
                                             for k, v in ordered.items()) + "\n}\n", encoding="utf-8")
        print(f"[{i}/{len(jobs)}] {word['word']:14} {times[word['id']]['text']}", flush=True)


if __name__ == "__main__":
    main()
