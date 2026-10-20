#!/usr/bin/env python3
"""Recognise the phonemes in each rendered variant (wav2vec2 espeak CTC), with their times.

Shows what the clip really says (a letter name "ɛm", an added "ə") and where each phoneme
starts, beside the ElevenLabs timestamps. Needs torch, transformers and soundfile.
"""
import json, sys, wave
from pathlib import Path
import numpy as np
import torch
from huggingface_hub import hf_hub_download
from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

OUT = Path(__file__).resolve().parents[3] / "prototypes-out" / "stretched"
NAME = "facebook/wav2vec2-lv-60-espeak-cv-ft"
proc = Wav2Vec2FeatureExtractor.from_pretrained(NAME)
vocab = {v: k for k, v in json.loads(Path(hf_hub_download(NAME, "vocab.json")).read_text()).items()}
PAD = 0
model = Wav2Vec2ForCTC.from_pretrained(NAME).eval()
report = {}
for wav in sorted(OUT.glob("*.wav")):
    if len(sys.argv) > 1 and wav.stem.split(".")[0] not in sys.argv[1:]:
        continue
    with wave.open(str(wav)) as fh:
        x = np.frombuffer(fh.readframes(fh.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    inp = proc(x, sampling_rate=16000, return_tensors="pt")
    with torch.no_grad():
        ids = model(inp.input_values).logits.argmax(-1)[0].tolist()
    step = len(x) / 16000 / len(ids)
    segs, prev = [], None
    for i, t in enumerate(ids):
        if t != prev and vocab[t] not in ("<pad>", "<s>", "</s>", "<unk>"):
            segs.append([vocab[t], round(i * step, 2)])
        prev = t
    meta = json.loads(wav.with_suffix(".json").read_text())
    report[wav.stem] = segs
    print(f"{wav.stem:12} {meta['text']:22} " + " ".join(f"{p}@{t:.2f}" for p, t in segs))
    print(f"{'':12} {'':22} " + " ".join(f"{m['g']}@{m['start']:.2f}" for m in meta["marks"]) + f"  end {meta['duration']:.2f}")
(OUT / "phonemes.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
