#!/usr/bin/env python3
# /// script
# dependencies = ["matplotlib", "numpy"]
# ///
"""One spectrogram per word and variant, with the ElevenLabs letter starts as lines over it."""
import json, sys, wave
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

OUT = Path(__file__).resolve().parents[3] / "prototypes-out" / "stretched"
WORDS = ["oma", "mama", "maus", "hase", "hut", "bus", "igel", "hund"]
VARIANTS = ["dash", "joined", "pause"]
COLS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231"]
fig, axes = plt.subplots(len(WORDS), len(VARIANTS), figsize=(15, 2.1 * len(WORDS)))
for r, w in enumerate(WORDS):
    for c, v in enumerate(VARIANTS):
        ax = axes[r][c]
        meta = json.loads((OUT / f"{w}.{v}.json").read_text())
        with wave.open(str(OUT / f"{w}.{v}.wav")) as fh:
            x = np.frombuffer(fh.readframes(fh.getnframes()), dtype=np.int16).astype(float)
        ax.specgram(x, NFFT=512, Fs=16000, noverlap=384, cmap="magma", vmin=-20)
        ax.set_ylim(0, 6000)
        ax.set_xlim(0, 4.8)
        for i, m in enumerate(meta["marks"]):
            ax.axvline(m["start"], color=COLS[i % 4], lw=2)
            ax.text(m["start"] + 0.02, 5300, m["g"], color="white", fontsize=12, weight="bold",
                    bbox=dict(facecolor=COLS[i % 4], pad=1, lw=0))
        ax.set_title(f"{w} · {v} · {meta['text']}", fontsize=10)
        ax.set_yticks([])
fig.tight_layout()
fig.savefig(sys.argv[1] if len(sys.argv) > 1 else OUT / "sheet.png", dpi=70)
