#!/usr/bin/env python3
"""Copy the rendered variants into the app: audio/stretch-<id>.<variant>.mp3 and src/stretched.json.

The JSON holds, per word, the variant the game plays by default and, per variant, each
grapheme with the time (s) its sound starts in the clip. `?dehnen=<variant>` in the address
plays another variant, to compare them by ear.
"""
import json, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "prototypes-out" / "stretched"
DEFAULT = "dash"
data = {}
for meta_path in sorted(OUT.glob("*.*.json")):
    wid, variant = meta_path.stem.split(".")
    meta = json.loads(meta_path.read_text())
    shutil.copy(OUT / f"{wid}.{variant}.mp3", ROOT / "audio" / f"stretch-{wid}.{variant}.mp3")
    word = data.setdefault(wid, {"default": DEFAULT, "variants": {}})
    word["variants"][variant] = {
        "text": meta["text"],
        "marks": [[m["g"], round(m["start"], 3)] for m in meta["marks"]],
        "end": round(meta["duration"], 3),
    }
(ROOT / "src" / "stretched.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
print(f"{len(data)} words")
