#!/usr/bin/env python3
"""Picture prototype P2: word pictures from the Gemini image model (Nano Banana).

Generates the 12 prototype words in three styles and a contact sheet to
compare them. Every word request carries a style reference image, so the
pictures of one style look like one set. The reference of a style is
generated once from text (an object outside the word list) and reused; put
your own picture at <out>/<style>/reference.png to steer a style instead.

Images stay out of git: they go to prototypes-out/p2-gemini/ (ignored).

    scripts/prototypes/gemini_pictures.py generate          # all styles, all words
    scripts/prototypes/gemini_pictures.py generate --style sticker --word hund --force
    scripts/prototypes/gemini_pictures.py sheet ~/demos/leserina-p2-gemini

The API key comes from GEMINI_API_KEY, else ~/.config/leserina/gemini.key.
Standard library only.
"""

import argparse
import base64
import concurrent.futures
import html
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

MODEL = "gemini-nano-banana-2.1"
# Standard-tier prices from ai.google.dev/gemini-api/docs/pricing, read on 2026-10-18.
PRICE_INPUT_PER_TOKEN = 0.50 / 1e6
PRICE_OUTPUT_IMAGE_PER_TOKEN = 30.00 / 1e6
PRICE_OUTPUT_TEXT_PER_TOKEN = 3.00 / 1e6
IMAGE_SIZE = "1K"

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "prototypes-out" / "p2-gemini"
KEY_FILE = Path.home() / ".config" / "leserina" / "gemini.key"
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# (id, German word, English subject for the prompt)
WORDS = [
    ("ball", "Ball", "a ball"),
    ("auto", "Auto", "a car"),
    ("hut", "Hut", "a hat"),
    ("maus", "Maus", "a mouse (the animal)"),
    ("hund", "Hund", "a dog"),
    ("sonne", "Sonne", "the sun"),
    ("apfel", "Apfel", "an apple"),
    ("fisch", "Fisch", "a fish"),
    ("baum", "Baum", "a tree"),
    ("schrank", "Schrank", "a wardrobe (a cupboard for clothes)"),
    ("schmetterling", "Schmetterling", "a butterfly"),
    ("eichhoernchen", "Eichhörnchen", "a squirrel"),
]

STYLES = {
    "sticker": ("Sticker",
                "flat sticker style with thick dark outlines, bold flat colours, no gradients"),
    "watercolour": ("Watercolour",
                    "soft watercolour picture-book illustration, gentle washes, delicate lines"),
    "clay": ("Clay 3D",
             "round 3D clay figure, soft plasticine look, rounded shapes, soft studio light"),
}

COMMON = ("One single object, centred, filling about two thirds of a square picture, "
          "on a plain light background with nothing else: no text, no letters, no frame, "
          "no scenery, no other objects. Friendly and instantly recognisable for a "
          "four-year-old child.")

REFERENCE_SUBJECT = "a teapot"


def api_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit(f"No API key: set GEMINI_API_KEY or create {KEY_FILE} (mode 600).")
    return key


def request_image(key, prompt, reference=None):
    """One generateContent call. Returns (png bytes, usage metadata)."""
    parts = [{"text": prompt}]
    if reference is not None:
        parts.append({"inline_data": {"mime_type": "image/png",
                                      "data": base64.b64encode(reference).decode()}})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "1:1", "imageSize": IMAGE_SIZE},
        },
    }
    req = urllib.request.Request(
        ENDPOINT.format(model=MODEL), data=json.dumps(body).encode(),
        headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.load(resp)
            break
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:500]
            if e.code in (429, 500, 503) and attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code}: {detail}") from None
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline:
                return to_png(base64.b64decode(inline["data"])), data.get("usageMetadata", {})
    raise RuntimeError(f"no image in response: {json.dumps(data)[:500]}")


def to_png(raw):
    if raw.startswith(b"\x89PNG"):
        return raw
    tmp = Path(os.environ.get("TMPDIR", "/tmp")) / f"leserina-{threading.get_ident()}"
    tmp.with_suffix(".img").write_bytes(raw)
    subprocess.run(["sips", "-s", "format", "png", str(tmp.with_suffix(".img")),
                    "--out", str(tmp.with_suffix(".png"))], check=True, capture_output=True)
    png = tmp.with_suffix(".png").read_bytes()
    tmp.with_suffix(".img").unlink()
    tmp.with_suffix(".png").unlink()
    return png


def cost(usage):
    """Dollars for one call, from its token counts."""
    out_image = sum(d.get("tokenCount", 0) for d in usage.get("candidatesTokensDetails", [])
                    if d.get("modality") == "IMAGE")
    out_total = usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
    return (usage.get("promptTokenCount", 0) * PRICE_INPUT_PER_TOKEN
            + out_image * PRICE_OUTPUT_IMAGE_PER_TOKEN
            + (out_total - out_image) * PRICE_OUTPUT_TEXT_PER_TOKEN)


log_lock = threading.Lock()


def log(entry):
    with log_lock:
        with open(OUT / "log.jsonl", "a") as f:
            f.write(json.dumps(entry) + "\n")


def reference_for(key, style):
    path = OUT / style / "reference.png"
    if not path.exists():
        prompt = (f"A picture of {REFERENCE_SUBJECT} for a children's picture dictionary, "
                  f"drawn as {STYLES[style][1]}. {COMMON}")
        png, usage = request_image(key, prompt)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png)
        log({"style": style, "id": "reference", "model": MODEL, "usage": usage,
             "cost": cost(usage), "prompt": prompt})
        print(f"{style}/reference  ${cost(usage):.4f}")
    return path.read_bytes()


def generate_one(key, style, word, reference, force):
    wid, _, subject = word
    path = OUT / style / "pictures" / f"{wid}.png"
    if path.exists() and not force:
        return
    prompt = (f"A picture of {subject} for a children's picture dictionary, drawn as "
              f"{STYLES[style][1]}. Match the attached reference image exactly in drawing "
              f"style, line weight, colour palette, lighting and background, but draw "
              f"{subject} instead of its subject. {COMMON}")
    t0 = time.time()
    png, usage = request_image(key, prompt, reference)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    log({"style": style, "id": wid, "model": MODEL, "usage": usage, "cost": cost(usage),
         "seconds": round(time.time() - t0, 1), "prompt": prompt})
    print(f"{style}/{wid}  ${cost(usage):.4f}  {time.time() - t0:.0f}s")


def generate(args):
    key = api_key()
    OUT.mkdir(parents=True, exist_ok=True)
    styles = [args.style] if args.style else list(STYLES)
    words = [w for w in WORDS if not args.word or w[0] == args.word]
    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        refs = dict(zip(styles, pool.map(lambda s: reference_for(key, s), styles)))
        for style in styles:
            for word in words:
                jobs.append(pool.submit(generate_one, key, style, word, refs[style], args.force))
        failed = 0
        for job in concurrent.futures.as_completed(jobs):
            try:
                job.result()
            except Exception as e:  # keep going; rerun fills the gaps
                failed += 1
                print(f"failed: {e}", file=sys.stderr)
    total, n = spent()
    print(f"spent so far: ${total:.2f} for {n} images ({MODEL})")
    if failed:
        sys.exit(f"{failed} pictures failed; run again to retry them")


def spent():
    entries = []
    if (OUT / "log.jsonl").exists():
        entries = [json.loads(l) for l in (OUT / "log.jsonl").read_text().splitlines() if l]
    return sum(e["cost"] for e in entries), len(entries)


def latest_costs():
    """Cost of the picture currently on disk, per (style, id): the last log entry wins."""
    costs = {}
    if (OUT / "log.jsonl").exists():
        for line in (OUT / "log.jsonl").read_text().splitlines():
            e = json.loads(line)
            costs[(e["style"], e["id"])] = e
    return costs


def sheet(args):
    dest = Path(args.dest).expanduser()
    (dest / "img").mkdir(parents=True, exist_ok=True)
    costs = latest_costs()
    per_image = [e["cost"] for k, e in costs.items() if k[1] != "reference"]
    avg = sum(per_image) / len(per_image) if per_image else 0
    total, n = spent()

    def cell(style, wid):
        src = OUT / style / ("reference.png" if wid == "reference" else f"pictures/{wid}.png")
        if not src.exists():
            return '<td class="missing">missing</td>'
        name = f"{style}-{wid}.png"
        shutil.copy(src, dest / "img" / name)
        e = costs.get((style, wid), {})
        note = f"${e['cost']:.3f}" if "cost" in e else ""
        return f'<td><img src="img/{name}" loading="lazy" alt=""><small>{note}</small></td>'

    head = "".join(f"<th>{html.escape(label)}<br><small>{html.escape(desc)}</small></th>"
                   for label, desc in STYLES.values())
    rows = [f'<tr class="ref"><th>Style reference<br><small>{REFERENCE_SUBJECT}, sent with '
            f'every request</small></th>{"".join(cell(s, "reference") for s in STYLES)}</tr>']
    for wid, german, _ in WORDS:
        rows.append(f"<tr><th>{html.escape(german)}</th>"
                    f"{''.join(cell(s, wid) for s in STYLES)}</tr>")
    page = f"""<!doctype html>
<html lang="en"><meta charset="utf-8">
<title>Picture prototype P2: {MODEL}</title>
<style>
  body {{ font: 15px/1.4 system-ui, sans-serif; margin: 16px; color: #222; background: #fafafa; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  p {{ margin: 4px 0 12px; color: #555; }}
  table {{ border-collapse: collapse; width: 100%; table-layout: fixed; }}
  th, td {{ border: 1px solid #ddd; padding: 6px; text-align: center; vertical-align: middle; background: #fff; }}
  thead th {{ position: sticky; top: 0; background: #f0f0f0; z-index: 1; }}
  tbody th {{ width: 110px; font-size: 17px; }}
  th small {{ display: block; font-weight: normal; color: #777; font-size: 11px; }}
  td img {{ width: 100%; max-width: 220px; aspect-ratio: 1; display: block; margin: 0 auto; }}
  td small {{ color: #999; font-size: 10px; }}
  tr.ref td, tr.ref th {{ background: #f6f3ea; }}
  td.missing {{ color: #c00; }}
</style>
<h1>Picture prototype P2: Gemini image model</h1>
<p>Model <b>{MODEL}</b> via the Gemini API, {IMAGE_SIZE} square, standard tier.
Average ${avg:.3f} per picture; ${total:.2f} spent in total for {n} generated images
(including the 3 style references and any reruns).</p>
<table>
<thead><tr><th>Word</th>{head}</tr></thead>
<tbody>
{chr(10).join(rows)}
</tbody>
</table>
</html>
"""
    (dest / "index.html").write_text(page)
    print(dest / "index.html")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="generate missing pictures")
    g.add_argument("--style", choices=list(STYLES))
    g.add_argument("--word", choices=[w[0] for w in WORDS])
    g.add_argument("--force", action="store_true", help="regenerate existing pictures")
    g.add_argument("--parallel", type=int, default=4)
    g.set_defaults(fn=generate)
    s = sub.add_parser("sheet", help="write the contact sheet (HTML) with its images")
    s.add_argument("dest", help="directory for index.html and img/")
    s.set_defaults(fn=sheet)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
