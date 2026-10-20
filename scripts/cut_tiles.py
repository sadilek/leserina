#!/usr/bin/env python3
# /// script
# dependencies = ["numpy"]
# ///
"""Find each grapheme's sound in its word's stretched clip, for the tiles of "Wörter legen".

A tile plays its own piece of the stretched clip (scripts/render_stretched.py) of its word, so it
sounds as it does in that word: the d of "Hund" plays a t. The game cuts the pieces out at run
time; src/tiles.json keeps where each one lies, as [start, end] in seconds of the clip.

Where a piece lies: src/stretched.json has when each grapheme starts (its "mark"), near the
strongest change of spectrum. The dash between two pieces of the spoken text often leaves a
short pause; where there is one just before a mark, the cut lies in its quietest point, else at
the mark. Within its stretch, a piece keeps its loudest run of sound and drops the silence around
it. Where a sound runs straight into the next one, both keep 30 ms off the seam, so neither
brings a trace of the other.

Stops (b d g p t k) are bursts of a few milliseconds: their piece starts where the energy above
2.5 kHz jumps, and lasts 130 ms, which brings the start of the vowel after a stop at the start
of a word ("bə", not "Be").

A piece that comes out shorter than 0.1 s (apart from a stop) has lost its sound to a neighbour,
mostly because its mark lies late, and a piece whose spectrum lies far from that of the other
pieces with its sound has something else in it. These borrow the piece of another word with the
same sound, the one most like the others: [start, end, "<id>"]. The script lists them; they are
the first to listen to (in the parents' corner, "Alle Wörter anhören" in "Plättchen" mode).

Each entry keeps its graphemes, the text of its clip and a hash of the clip: the tests fail when
a clip has been rendered again since, until this script has been run again.

    uv run scripts/cut_tiles.py
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WORDS = ROOT / "words.json"
AUDIO = ROOT / "audio" / "stretched"
TIMES = ROOT / "src" / "stretched.json"
TILES = ROOT / "src" / "tiles.json"

RATE = 16000
HOP = 0.005  # s between frames
STOPS = {"b", "d", "g", "p", "t", "k"}
DIP = 10  # dB a pause lies below the sound on both sides
FLOOR = 30  # dB below the loudest frame of a stretch that still counts as its sound
SEAM = 0.03  # s kept off a seam with a neighbour
STOP = 0.13  # s of a stop's piece
SHORT = 0.1  # s, below which a piece other than a stop has lost its sound
ODD = 2.5  # times the usual distance from its sound's spectrum that makes a piece odd


def clip_hash(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()[:10]


def decode(path: Path) -> np.ndarray:
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-nostdin", "-i", str(path), "-f", "s16le", "-ac", "1",
                          "-ar", str(RATE), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float64) / 32768


def frames(x: np.ndarray) -> np.ndarray:
    n, hop = int(0.02 * RATE), int(HOP * RATE)
    return np.lib.stride_tricks.sliding_window_view(np.pad(x, (n // 2, n)), n)[::hop]


def levels(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each frame's energy and its energy above 2.5 kHz, in dB."""
    fr = frames(x)
    power = np.abs(np.fft.rfft(fr * np.hanning(fr.shape[1]), axis=1)) ** 2
    freqs = np.fft.rfftfreq(fr.shape[1], 1 / RATE)
    return 10 * np.log10((fr ** 2).mean(1) + 1e-10), 10 * np.log10(power[:, freqs >= 2500].sum(1) + 1e-10)


def spectrum(x: np.ndarray) -> np.ndarray | None:
    """The shape of a piece's mean log spectrum (24 bands, 100 Hz-8 kHz), loudness taken out."""
    if len(x) < 400:
        return None
    fr = np.lib.stride_tricks.sliding_window_view(x, 400)[::80] * np.hanning(400)
    power = np.abs(np.fft.rfft(fr, axis=1)) ** 2
    freqs = np.fft.rfftfreq(400, 1 / RATE)
    edges = np.geomspace(100, 8000, 25)
    bands = np.log(np.stack([power[:, (freqs >= a) & (freqs < b)].sum(1) for a, b in zip(edges[:-1], edges[1:])], 1) + 1e-8)
    total = bands.sum(1)
    mean = bands[total >= np.percentile(total, 30)].mean(0)
    return mean - mean.mean()


def loudest_run(e: np.ndarray) -> tuple[int, int] | None:
    """The frames of the run of sound with the most energy, gaps below 30 ms bridged."""
    if not len(e):
        return None
    on = e > max(e.max() - FLOOR, -55)
    runs: list[list[int]] = []
    for i, loud in enumerate(on):
        if not loud:
            continue
        if runs and (i - runs[-1][1]) * HOP < 0.03:
            runs[-1][1] = i + 1
        else:
            runs.append([i, i + 1])
    if not runs:
        return None
    a, b = max(runs, key=lambda r: (10 ** (e[r[0]:r[1]] / 10)).sum())
    return a, b


def cut(x: np.ndarray, marks: list[float], codes: list[str]) -> tuple[list[list[float]], list[str]]:
    """Where each grapheme's sound lies in the clip, and why a piece looks wrong, by index."""
    e, high = levels(x)
    dur = len(x) / RATE
    at = lambda t: int(round(t / HOP))  # noqa: E731
    # A mark past the clip's end: the clip's trailing silence was cut into that sound.
    marks = [min(m, dur - 0.05) for m in marks]
    bounds, pauses = [0.0], [True]
    for m in marks[1:]:
        lo, hi = at(max(bounds[-1] + 0.03, m - 0.1)), at(m + 0.02)
        hi = max(hi, lo + 1)
        i = lo + int(np.argmin(e[lo:hi]))
        before = e[max(at(bounds[-1]), at(m - 0.3)):i + 1].max()
        after = e[i:at(m + 0.1)].max()
        pause = min(before, after) - e[i] >= DIP
        bounds.append(i * HOP if pause else m)
        pauses.append(pause)
    bounds.append(dur)
    pauses.append(True)

    pieces, wrong = [], []
    for k, code in enumerate(codes):
        s, t = bounds[k], bounds[k + 1]
        run = loudest_run(e[at(s):at(t)])
        a, b = (max(s, s + run[0] * HOP - 0.015), min(t, s + run[1] * HOP + 0.025)) if run else (s, t)
        if code in STOPS:
            onset = next((q * HOP for q in range(max(at(s - 0.05), 1), max(at(t) - 6, at(s) + 1))
                          if high[q] - high[max(0, q - 10):q].min() >= 12), marks[k])
            a = max(0.0, onset - 0.015)
            b = min(a + STOP, dur) if k + 1 < len(codes) else max(b, min(a + 0.06, dur))
        else:
            if not pauses[k] and k and b - a > 0.25:
                a += SEAM
            if not pauses[k + 1] and b - a > 0.25:
                b -= SEAM
            if b - a < SHORT:
                wrong.append(f"{k}: only {b - a:.2f} s")
        pieces.append([round(a, 3), round(b, 3)])
    return pieces, wrong


def main() -> None:
    words = json.loads(WORDS.read_text(encoding="utf-8"))
    times = json.loads(TIMES.read_text(encoding="utf-8"))
    entries, clips, notes = {}, {}, {}
    for w in words:
        s = times.get(w["id"])
        path = AUDIO / f"{w['id']}.mp3"
        if not s or not path.exists() or s["graphemes"] != "|".join(g for g, _ in w["sounds"]):
            print(f"{w['word']}: no stretched clip for its graphemes, skipped")
            continue
        clips[w["id"]] = decode(path)
        pieces, wrong = cut(clips[w["id"]], s["marks"], [c for _, c in w["sounds"]])
        entries[w["id"]] = {"graphemes": s["graphemes"], "text": s["text"], "clip": clip_hash(path), "cuts": pieces}
        notes[w["id"]] = {int(n.split(":")[0]): n.split(": ")[1] for n in wrong}

    # Each sound's pieces against their median spectrum: an odd one has something else in it.
    by_code: dict[str, list[tuple[str, int, np.ndarray]]] = {}
    for w in words:
        if w["id"] not in entries:
            continue
        for k, ((_, code), (a, b)) in enumerate(zip(w["sounds"], entries[w["id"]]["cuts"])):
            sp = spectrum(clips[w["id"]][int(a * RATE):int(b * RATE)])
            if sp is not None and k not in notes[w["id"]]:
                by_code.setdefault(code, []).append((w["id"], k, sp))
    donors = {}
    for code, items in by_code.items():
        median = np.median([sp for *_, sp in items], 0)
        dist = [float(np.linalg.norm(sp - median)) for *_, sp in items]
        usual = float(np.median(dist))
        for (wid, k, _), d in zip(items, dist):
            if code not in STOPS and len(items) >= 4 and d > ODD * usual:
                notes[wid][k] = f"spectrum {d / usual:.1f} times as far from its sound's as usual"
        good = [(d, wid, k) for (wid, k, _), d in zip(items, dist) if k not in notes[wid]]
        if good:
            donors[code] = min(good)[1:]

    print("Borrowed from another word (listen to these first):")
    for w in words:
        for k, why in sorted(notes.get(w["id"], {}).items()):
            g, code = w["sounds"][k]
            donor = donors.get(code)
            if donor:
                a, b = entries[donor[0]]["cuts"][donor[1]][:2]
                entries[w["id"]]["cuts"][k] = [a, b, donor[0]]
            print(f"  {w['word']:14} {g:4} {code:4} {why}; " + (f"from {donor[0]}" if donor else "kept, no other word has it"))

    TILES.write_text("{\n" + ",\n".join(f" {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}"
                                         for k, v in entries.items()) + "\n}\n", encoding="utf-8")
    print(f"{len(entries)} words written to {TILES.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
