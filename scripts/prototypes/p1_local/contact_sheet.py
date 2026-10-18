# /// script
# requires-python = "==3.13.*"
# dependencies = ["pillow<13"]
# ///
"""Build the P1 contact sheet: 12 words x 3 styles per generator, with time per image.

Reads what generate.py wrote to prototypes-out/p1/ and writes a self-contained directory
(index.html plus downscaled JPEGs) for the owner to compare.

  uv run scripts/prototypes/p1_local/contact_sheet.py --out ~/demos/leserina-p1
"""

import argparse
import html
import json
import statistics
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from generate import GENERATORS, REPO, STYLES  # noqa: E402
from words import WORDS, slug  # noqa: E402

STYLE_NAMES = {"sticker": "Flat sticker", "watercolour": "Watercolour", "clay": "3D clay"}
NOTES = {
    "klein-ref": "Apache 2.0. Ball is the plain klein picture; it is the style reference image for the other eleven words.",
    "klein": "Apache 2.0. Style prompt only, no reference image.",
    "zimage": "Apache 2.0. Style prompt only; the model takes no reference images.",
}
THUMB = 360


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, default=REPO / "prototypes-out" / "p1")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    sections, summary = [], []
    for gen, label in GENERATORS.items():
        timings_path = args.src / gen / "timings.json"
        if not timings_path.exists():
            continue
        timings = json.loads(timings_path.read_text())
        meta = timings["_meta"]
        rows, seconds = [], []
        for word, _ in WORDS:
            pid = slug(word)
            cells = []
            for style in STYLES:
                src = args.src / gen / style / f"{pid}.png"
                entry = timings.get(style, {}).get(pid)
                if not src.exists() or not entry:
                    cells.append('<td class="missing">–</td>')
                    continue
                rel = Path("img") / gen / style / f"{pid}.jpg"
                (args.out / rel).parent.mkdir(parents=True, exist_ok=True)
                with Image.open(src) as im:
                    im.convert("RGB").resize((THUMB, THUMB), Image.LANCZOS).save(args.out / rel, quality=88)
                seconds.append(entry["seconds"])
                ref = " · ref" if entry.get("reference") else ""
                cells.append(
                    f'<td><div class="card"><img src="{rel}" alt="{html.escape(word)}" loading="lazy"></div>'
                    f'<div class="t">{entry["seconds"]:.1f} s{ref}</div></td>'
                )
            rows.append(f'<tr><th class="word">{html.escape(word)}<span>{pid}</span></th>{"".join(cells)}</tr>')
        median = statistics.median(seconds) if seconds else 0
        quant = f"{meta['quantize']}-bit" if meta.get("quantize") else "bf16"
        facts = f"{meta['steps']} steps · {meta['size']}×{meta['size']} px · {quant} · seed {meta['seed']} · peak memory {meta.get('peak_memory_gb', 0):.1f} GB"
        summary.append(
            f'<tr><td><a href="#{gen}">{html.escape(label)}</a></td><td>{median:.1f} s</td>'
            f"<td>{min(seconds):.1f}–{max(seconds):.1f} s</td><td>{len(seconds)}</td></tr>"
        )
        head = "".join(f"<th>{STYLE_NAMES[s]}</th>" for s in STYLES)
        sections.append(
            f'<section id="{gen}"><h2>{html.escape(label)}</h2>'
            f'<p class="meta">{facts}<br>{html.escape(NOTES[gen])} Median {median:.1f} s per image.</p>'
            f'<table class="grid"><thead><tr><th></th>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></section>'
        )

    page = TEMPLATE.replace("{summary}", "".join(summary)).replace("{sections}", "".join(sections))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "index.html").write_text(page)
    print(args.out / "index.html")


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leserina · Picture prototype P1 (local)</title>
<style>
  :root { --ink:#2b2a33; --muted:#77737f; --line:#e6e2dc; --bg:#f6f3ee; }
  * { box-sizing:border-box; }
  body { margin:0; padding:24px 18px 48px; font:15px/1.45 -apple-system, "Segoe UI", sans-serif; color:var(--ink); background:var(--bg); }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:18px; margin:36px 0 2px; }
  .lede, .meta { color:var(--muted); margin:0 0 14px; font-size:13.5px; }
  table.sum { border-collapse:collapse; margin:10px 0 0; font-size:14px; }
  table.sum td, table.sum th { padding:5px 14px 5px 0; text-align:left; border-bottom:1px solid var(--line); }
  table.sum a { color:var(--ink); }
  table.grid { width:100%; border-collapse:separate; border-spacing:8px 10px; table-layout:fixed; margin-left:-8px; }
  table.grid thead th { position:sticky; top:0; background:var(--bg); padding:8px 0 4px; font-size:14px; z-index:1; }
  table.grid th:first-child { width:96px; }
  th.word { text-align:left; font-size:15px; vertical-align:middle; }
  th.word span { display:block; font-weight:400; color:var(--muted); font-size:12px; }
  .card { background:#fff; border-radius:18px; padding:8px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .card img { display:block; width:100%; aspect-ratio:1; border-radius:12px; }
  .t { text-align:center; color:var(--muted); font-size:12px; margin-top:3px; }
  td.missing { text-align:center; color:var(--muted); }
</style></head>
<body>
<h1>Picture prototype P1: local generation on the Mac</h1>
<p class="lede">12 words × 3 styles, generated with mflux 0.23 (MLX) on an M4 Pro with 48 GB.
One fixed style prompt per style, same seed for every picture. Each picture sits on a rounded white card as in the app.
Times are per image with the model loaded, 8-bit weights, measured while other agents' work shared the Mac's GPU and memory; on an idle Mac they would be shorter.</p>
<table class="sum"><thead><tr><th>Generator</th><th>Median</th><th>Range</th><th>Images</th></tr></thead><tbody>{summary}</tbody></table>
{sections}
</body></html>
"""

if __name__ == "__main__":
    main()
