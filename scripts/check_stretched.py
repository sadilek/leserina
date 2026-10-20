#!/usr/bin/env python3
# /// script
# dependencies = ["torch", "transformers", "numpy"]
# ///
"""Rank the stretched clips (scripts/render_stretched.py) by how likely they miss their sounds,
so a person listens to those first, and flag clips that run unusually long.

A phoneme recogniser (wav2vec2 trained on espeak phonemes, about 1.3 GB on first use) hears
each clip twice: freely, which shows roughly what the clip says ("b uː s", or a letter name
"b eː"), and forced through the sounds the word should have. "fit" is how much less likely the
forced reading is than the free one, per frame: near 0 the clip says what it should, a larger
value means some sound is missing, added or another. The recogniser knows normal speech, not
held sounds, so it often misses a held sound that is there: take its reading as a hint only.
A clip longer than 0.7 s per grapheme (plus 0.4 s) has more in it than the sounds, such as letter
names or a spoken "Bindestrich".

    uv run scripts/check_stretched.py                    # every clip in audio/stretched/
    uv run scripts/check_stretched.py audio/stretched/hund.mp3 ...

A clip passed as <id>.<anything>.mp3 with a <id>.<anything>.json beside it (an entry like those
in src/stretched.json) is checked against that, to compare trial renderings.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch
from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parent.parent
MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"
# Each sound code (scripts/phonics.py) as the recogniser's phonemes. Vowels are held in the clips,
# so short ones are heard as long ones too.
PHONEMES = {
    "a": "aː", "a:": "aː", "e": "eː", "e:": "eː", "i": "iː", "i:": "iː", "o": "oː", "o:": "oː",
    "u": "uː", "u:": "uː", "ä": "ɛː", "ä:": "ɛː", "ö": "øː", "ö:": "øː", "ü": "yː", "ü:": "yː",
    "au": "aʊ", "ei": "aɪ", "eu": "ɔø", "ə": "ə", "ɐ": "ɐ",
    "r": "ʁ", "w": "v", "sch": "ʃ", "ch": "ç", "ng": "ŋ", "g": "ɡ", "ks": "k s", "kw": "k v",
}
FIT, PER_GRAPHEME, EXTRA = 0.25, 0.7, 0.4


def decode(path: Path) -> np.ndarray:
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768


def forced(logp: np.ndarray, tokens: list[int], blank: int) -> tuple[list[int], float]:
    """The first frame of each token on the best CTC path through them, and the path's log-prob."""
    states = [blank]
    for t in tokens:
        states += [t, blank]
    T, N = len(logp), len(states)
    dp = np.full((T, N), -np.inf)
    back = np.zeros((T, N), dtype=int)
    dp[0, 0], dp[0, 1] = logp[0, states[0]], logp[0, states[1]]
    for t in range(1, T):
        for s in range(N):
            best, arg = dp[t - 1, s], s
            if s >= 1 and dp[t - 1, s - 1] > best:
                best, arg = dp[t - 1, s - 1], s - 1
            if s >= 2 and states[s] != blank and states[s] != states[s - 2] and dp[t - 1, s - 2] > best:
                best, arg = dp[t - 1, s - 2], s - 2
            dp[t, s], back[t, s] = best + logp[t, states[s]], arg
    s = N - 1 if dp[-1, N - 1] > dp[-1, N - 2] else N - 2
    score = dp[-1, s]
    path = [0] * T
    for t in range(T - 1, -1, -1):
        path[t] = s
        s = back[t, s]
    first: dict[int, int] = {}
    for t, s in enumerate(path):
        if states[s] != blank:
            first.setdefault(s, t)
    return [first[2 * i + 1] for i in range(len(tokens))], score


def main() -> None:
    words = {w["id"]: w for w in json.loads((ROOT / "words.json").read_text(encoding="utf-8"))}
    times = json.loads((ROOT / "src" / "stretched.json").read_text(encoding="utf-8"))
    clips = [Path(a) for a in sys.argv[1:]] or sorted((ROOT / "audio" / "stretched").glob("*.mp3"))
    fe = Wav2Vec2FeatureExtractor.from_pretrained(MODEL)
    model = Wav2Vec2ForCTC.from_pretrained(MODEL).eval()
    vocab = json.loads(Path(hf_hub_download(MODEL, "vocab.json")).read_text())
    names = {i: p for p, i in vocab.items()}
    blank = vocab["<pad>"]
    rows = []
    for clip in clips:
        wid = clip.name.split(".")[0]
        word = words[wid]
        beside = clip.with_suffix(".json")
        entry = json.loads(beside.read_text()) if beside.exists() else times[wid]
        x = decode(clip)
        with torch.no_grad():
            logits = model(fe(x, sampling_rate=16000, return_tensors="pt").input_values).logits[0]
        logp = torch.log_softmax(logits, -1).numpy()
        ids = logp.argmax(-1)
        heard, prev = [], None
        for i in ids:
            if i != prev and i != blank and names[i] not in ("<s>", "</s>", "<unk>"):
                heard.append(names[i])
            prev = i
        phones = []
        for i, (_, c) in enumerate(word["sounds"]):
            back = i and word["sounds"][i - 1][1].rstrip(":") in ("a", "o", "u", "au")
            phones.append(["x"] if c == "ch" and back else PHONEMES.get(c, c).split())
        tokens = [vocab[p] for ph in phones for p in ph]
        _, score = forced(logp, tokens, blank)
        free = logp.max(-1).sum()
        fit = (free - score) / len(logp)
        seconds = len(x) / 16000
        long = seconds > PER_GRAPHEME * len(phones) + EXTRA
        rows.append((fit, long, clip.name, entry["text"], seconds, heard, phones))
    rows.sort(key=lambda r: (not r[1], -r[0]))
    for fit, long, name, text, seconds, heard, phones in rows:
        bad = long or fit > FIT
        print(f"{'!' if bad else ' '} {name:22} {text:36} {seconds:4.1f} s{' (long)' if long else '       '}  "
              f"fit {fit:4.2f}  heard {' '.join(heard)}  want {' '.join(p for ph in phones for p in ph)}")
    flagged = [r[2] for r in rows if r[1] or r[0] > FIT]
    print(f"\n{len(flagged)} of {len(rows)} to listen to first: {', '.join(flagged)}" if flagged else "\nnothing flagged")


if __name__ == "__main__":
    main()
