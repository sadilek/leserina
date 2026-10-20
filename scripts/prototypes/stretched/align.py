#!/usr/bin/env python3
"""Where each grapheme's sound really starts in a clip: CTC forced alignment of the known
phonemes (wav2vec2 espeak), beside the ElevenLabs timestamps. Prints the offset per mark."""
import json, sys, wave
from pathlib import Path
import numpy as np
import torch
from huggingface_hub import hf_hub_download
from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

OUT = Path(__file__).resolve().parents[3] / "prototypes-out" / "stretched"
NAME = "facebook/wav2vec2-lv-60-espeak-cv-ft"
PHONES = {
    "oma": ["oː", "m", "aː"], "mama": ["m", "aː", "m", "aː"], "maus": ["m", "aʊ", "s"],
    "hase": ["h", "aː", "s", "ə"], "hut": ["h", "uː", "t"], "bus": ["b", "uː", "s"],
    "igel": ["iː", "ɡ", "ə", "l"], "hund": ["h", "uː", "n", "t"],
}
fe = Wav2Vec2FeatureExtractor.from_pretrained(NAME)
model = Wav2Vec2ForCTC.from_pretrained(NAME).eval()
vocab = json.loads(Path(hf_hub_download(NAME, "vocab.json")).read_text())
BLANK = vocab["<pad>"]


def align(logp: np.ndarray, tokens: list[int]) -> list[int]:
    """First frame of each token on the best CTC path (Viterbi over blank-interleaved states)."""
    S = [BLANK]
    for t in tokens:
        S += [t, BLANK]
    T, N = len(logp), len(S)
    dp = np.full((T, N), -np.inf)
    bp = np.zeros((T, N), dtype=int)
    dp[0, 0], dp[0, 1] = logp[0, S[0]], logp[0, S[1]]
    for t in range(1, T):
        for s in range(N):
            cands = [(dp[t - 1, s], s)]
            if s >= 1:
                cands.append((dp[t - 1, s - 1], s - 1))
            if s >= 2 and S[s] != BLANK and S[s] != S[s - 2]:
                cands.append((dp[t - 1, s - 2], s - 2))
            best, arg = max(cands)
            dp[t, s], bp[t, s] = best + logp[t, S[s]], arg
    s = N - 1 if dp[-1, N - 1] > dp[-1, N - 2] else N - 2
    path = [0] * T
    for t in range(T - 1, -1, -1):
        path[t] = s
        s = bp[t, s]
    firsts = {}
    for t, s in enumerate(path):
        if S[s] != BLANK:
            firsts.setdefault(s, t)
    return [firsts[2 * i + 1] for i in range(len(tokens))]


variants = sys.argv[1:] or ["dash"]
diffs = []
for wid, phones in PHONES.items():
    for v in variants:
        meta = json.loads((OUT / f"{wid}.{v}.json").read_text())
        with wave.open(str(OUT / f"{wid}.{v}.wav")) as fh:
            x = np.frombuffer(fh.readframes(fh.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        with torch.no_grad():
            logits = model(fe(x, sampling_rate=16000, return_tensors="pt").input_values).logits[0]
        logp = torch.log_softmax(logits, -1).numpy()
        step = len(x) / 16000 / len(logp)
        frames = align(logp, [vocab[p] for p in phones])
        real = [f * step for f in frames]
        row = []
        for m, r in zip(meta["marks"], real):
            row.append(f"{m['g']}:{m['start']:.2f}/{r:.2f}")
            if m is not meta["marks"][0]:
                diffs.append(m["start"] - r)
        print(f"{wid:5} {v:6} " + "  ".join(row))
d = np.array(diffs)
print(f"\nElevenLabs minus aligned onset (s), all marks but the first: mean {d.mean():+.3f}, median {np.median(d):+.3f}, "
      f"min {d.min():+.3f}, max {d.max():+.3f}")
