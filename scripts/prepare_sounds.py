#!/usr/bin/env python3
# /// script
# dependencies = ["numpy"]
# ///
"""Turn the recorded sounds into clips for the game: audio/sounds/raw/<file>.wav -> audio/sounds/<file>.mp3.

The recording page (record.html under `npm run dev`, see the README, "Recording the sounds")
saves one take per sound of src/sound-list.json, with some silence around it: it keeps 0.3 s
from before the key went down and after it came up. This script

- cuts the silence at both ends: it keeps the run of sound around the take's loudest 10 ms, of
  frames above its noise floor (and no more than 25 dB below the loudest), bridging dips of up
  to 80 ms (the closure before a burst), plus 20 ms before and 50 ms after, with short fades.
  The clicks of the space bar going down and up lie apart from the sound and are left out;
- levels the sound to the word clips in audio/: their median loudness, measured over the frames
  within 30 dB of each clip's loudest (silence and pauses do not count), and no peak above -1 dBFS;
- writes it as MP3, 44.1 kHz mono at 64 kbit/s like the word clips;
- lists the sounds that are missing, and those that are suspiciously short, long or quiet, to
  listen to and record again.

    uv run scripts/prepare_sounds.py
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
LIST = ROOT / "src" / "sound-list.json"
RAW = ROOT / "audio" / "sounds" / "raw"
OUT = ROOT / "audio" / "sounds"

RATE = 44100
FRAME = 0.01  # s
SPAN = 30  # dB below the loudest frame that still counts as sound when measuring loudness
DEPTH = 25  # dB below the loudest frame that the cut may reach at most
ABOVE_FLOOR = 10  # dB above the noise floor that counts as sound when cutting
BRIDGE = 0.08  # s, the longest dip within a sound
BEFORE, AFTER = 0.02, 0.05  # s kept before the first and after the last frame of sound
FADE_IN, FADE_OUT = 0.005, 0.02  # s
PEAK = -1.0  # dBFS
# Plausible lengths in s after the cut: a held sound or vowel is about 1 s, a stop a burst.
SHORT = {"held": 0.4, "vowel": 0.4, "stop": 0.02}
LONG = {"held": 2.5, "vowel": 2.5, "stop": 0.4}
BRIEF = {"h", "ə", "ɐ"}  # spoken for about half a second
QUIET = -40  # dBFS, the raw take's loudness below which it is too quiet to level well
CLIPPED = -0.1  # dBFS, a raw peak at or above it has clipped


def decode(path: Path) -> np.ndarray:
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(RATE), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32).copy()


def frames_db(x: np.ndarray) -> np.ndarray:
    n = int(FRAME * RATE)
    count = max(1, len(x) // n)
    power = (x[:count * n].reshape(count, n) ** 2).mean(axis=1) if len(x) >= n else np.array([np.mean(x ** 2)])
    return 10 * np.log10(power + 1e-12)


def loudness(x: np.ndarray) -> float:
    """dBFS over the frames within SPAN dB of the loudest: the level of the sound, not its pauses."""
    db = frames_db(x)
    active = db[db > db.max() - SPAN]
    return float(10 * np.log10(np.mean(10 ** (active / 10))))


def trim(x: np.ndarray) -> np.ndarray:
    db = frames_db(x)
    floor = np.percentile(db, 10)
    loud = np.flatnonzero(db > max(db.max() - DEPTH, floor + ABOVE_FLOOR))
    if not len(loud):
        return x[:0]
    # The run of loud frames around the loudest, across dips of up to BRIDGE.
    runs = np.split(loud, np.flatnonzero(np.diff(loud) > BRIDGE / FRAME + 1) + 1)
    run = next(r for r in runs if r[0] <= np.argmax(db) <= r[-1])
    n = int(FRAME * RATE)
    a = max(0, run[0] * n - int(BEFORE * RATE))
    b = min(len(x), (run[-1] + 1) * n + int(AFTER * RATE))
    y = x[a:b].copy()
    fi, fo = min(len(y), int(FADE_IN * RATE)), min(len(y), int(FADE_OUT * RATE))
    y[:fi] *= np.linspace(0, 1, fi)
    y[len(y) - fo:] *= np.linspace(1, 0, fo)
    return y


def encode(x: np.ndarray, target: Path) -> None:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-",
                    "-b:a", "64k", str(target)], input=x.astype(np.float32).tobytes(), check=True)


def main() -> None:
    sounds = json.loads(LIST.read_text(encoding="utf-8"))
    clips = [p for p in sorted((ROOT / "audio").glob("*.mp3")) if not p.name.startswith("name-")]
    target = float(np.median([loudness(decode(p)) for p in clips]))
    print(f"Word clips: {len(clips)}, median loudness {target:.1f} dBFS")

    missing, odd = [], []
    for s in sounds:
        raw = RAW / f"{s['file']}.wav"
        name = f"{s['code']} ({s['word']})"
        if not raw.exists():
            missing.append(name)
            continue
        x = decode(raw)
        peak_raw = 20 * np.log10(np.abs(x).max() + 1e-12)
        y = trim(x)
        if not len(y):
            odd.append(f"{name}: silent")
            continue
        level = loudness(y)
        gain = target - level
        peak = 20 * np.log10(np.abs(y).max() + 1e-12)
        limited = peak + gain > PEAK
        gain = min(gain, PEAK - peak)
        encode(y * 10 ** (gain / 20), OUT / f"{s['file']}.mp3")

        seconds = len(y) / RATE
        short = SHORT[s["kind"]] / (2 if s["code"] in BRIEF else 1)
        why = []
        if seconds < short:
            why.append(f"short, {seconds:.2f} s")
        if seconds > LONG[s["kind"]]:
            why.append(f"long, {seconds:.2f} s" + (" (an e after the stop?)" if s["kind"] == "stop" else ""))
        if level < QUIET:
            why.append(f"quiet, {level:.0f} dBFS")
        if peak_raw >= CLIPPED:
            why.append("clipped")
        if limited:
            why.append(f"{target - level - gain:.1f} dB below the word clips, held back by its peak")
        if why:
            odd.append(f"{name}: " + "; ".join(why))
        print(f"  {s['file']:10} {seconds:5.2f} s  {level:6.1f} dBFS {gain:+6.1f} dB")

    print(f"{len(sounds) - len(missing)} of {len(sounds)} sounds written to audio/sounds/")
    if missing:
        print("Missing (record them on record.html):\n  " + ", ".join(missing))
    if odd:
        print("Listen to these first:\n  " + "\n  ".join(odd))


if __name__ == "__main__":
    main()
