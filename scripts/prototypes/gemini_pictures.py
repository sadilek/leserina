#!/usr/bin/env python3
"""Picture prototype P2: word pictures from the Gemini image model (Nano Banana).

Generates the 12 prototype words in three styles and a contact sheet to
compare them. Three backends reach the same model family:

  openrouter (default)  google/gemini-nano-banana-2.1 through OpenRouter, billed per
                 image to the OpenRouter credit. The key comes from
                 OPENROUTER_API_KEY, else ~/.config/leserina/openrouter.key.
  api            gemini-nano-banana-2.1 through the Gemini API (generateContent),
                 billed per image; needs billing on the Google project (image models
                 have no free tier). The key comes from GEMINI_API_KEY, else
                 ~/.config/leserina/gemini.key.
  agy            the generate_image tool of the Antigravity CLI (`agy -p`), on the
                 Google AI Pro subscription. agy does not say which image model it
                 runs, and its image quota ran out after 3 pictures per 5 hours
                 (2026-10-18), so it only suits single pictures.

Every word request carries a style reference image, so the pictures of one
style look like one set. The reference of a style is
generated once from text (an object outside the word list) and reused; put
your own picture at <out>/<style>/reference.png to steer a style instead.

Images stay out of git: they go to prototypes-out/p2-gemini/ (ignored).

    scripts/prototypes/gemini_pictures.py generate          # all styles, all words
    scripts/prototypes/gemini_pictures.py generate --style sticker --word hund --force
    scripts/prototypes/gemini_pictures.py generate --backend agy
    scripts/prototypes/gemini_pictures.py sheet ~/demos/leserina-p2-gemini

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
import tempfile
import threading
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

API_MODEL = "gemini-nano-banana-2.1"
OPENROUTER_MODEL = "google/gemini-nano-banana-2.1"
OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
AGY_MODEL = "Gemini image model via agy generate_image (Google AI Pro)"
AGY_BRAIN = Path.home() / ".gemini" / "antigravity-cli" / "brain"
# Standard-tier prices from ai.google.dev/gemini-api/docs/pricing, read on 2026-10-18.
PRICE_INPUT_PER_TOKEN = 0.50 / 1e6
PRICE_OUTPUT_IMAGE_PER_TOKEN = 30.00 / 1e6
PRICE_OUTPUT_TEXT_PER_TOKEN = 3.00 / 1e6
IMAGE_SIZE = "1K"

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "prototypes-out" / "p2-gemini"
KEY_FILE = Path.home() / ".config" / "leserina" / "gemini.key"
OPENROUTER_KEY_FILE = Path.home() / ".config" / "leserina" / "openrouter.key"
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


def model_name(backend):
    return {"api": API_MODEL, "openrouter": f"{OPENROUTER_MODEL} (OpenRouter)",
            "agy": AGY_MODEL}[backend]


def make_image(backend, prompt, reference, name):
    """One picture. Returns (png bytes, log fields)."""
    if backend == "agy":
        return agy_image(prompt, reference, name)
    if backend == "openrouter":
        return openrouter_image(prompt, reference)
    png, usage = request_image(api_key(), prompt, reference and reference.read_bytes())
    return png, {"usage": usage, "cost": cost(usage)}


def agy_image(prompt, reference, name):
    """Ask agy to call its generate_image tool once, then pick the file from its brain dir.

    Only agy's image-generator subagent has the tool, so the main agent delegates."""
    name = f"leserina_{name}_{uuid.uuid4().hex[:8]}"
    paths = f"ImagePaths: [{json.dumps(str(reference))}]" if reference else "ImagePaths: none"
    instruction = (
        "Have the image-generator subagent call generate_image exactly once with exactly "
        "these arguments. Prompt goes verbatim: tell the subagent not to rewrite, shorten "
        "or extend it.\n"
        f"Prompt: {json.dumps(prompt)}\nImageName: {name}\nAspectRatio: 1:1\n{paths}\n"
        "Do nothing else. Reply with only the path of the generated file.")
    cmd = ["agy", "-p", instruction, "--output-format", "stream-json", "--print-timeout", "8m"]
    if reference:
        cmd += ["--add-dir", str(reference.parent)]
    with tempfile.TemporaryDirectory() as cwd:
        run = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600)
    events = [json.loads(l) for l in run.stdout.splitlines() if l.startswith("{")]
    calls = [e["step_update"]["tool_info"]["parameters"] for e in events
             if e.get("event") == "step_update"
             and e["step_update"].get("tool_name") == "generate_image"
             and e["step_update"].get("state") == "DONE"
             and (e["step_update"].get("tool_info") or {}).get("parameters")]
    files = sorted(AGY_BRAIN.glob(f"*/{name}*.*"), key=lambda f: f.stat().st_mtime)
    if not files:
        result = next((e["result"] for e in events if e.get("event") == "result"), {})
        raise RuntimeError(f"agy made no image: {result.get('status')} "
                           f"{(result.get('response') or '')[:300]} {run.stderr[-300:]}")
    sent = calls[-1].get("Prompt") if calls else None
    return to_png(files[-1].read_bytes()), {"cost": 0.0, "prompt_sent": sent}


def openrouter_key():
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key and OPENROUTER_KEY_FILE.exists():
        key = OPENROUTER_KEY_FILE.read_text().strip()
    if not key:
        sys.exit(f"No OpenRouter key: set OPENROUTER_API_KEY or create "
                 f"{OPENROUTER_KEY_FILE} (mode 600).")
    return key


def openrouter_image(prompt, reference):
    """One chat completion with image output. OpenRouter reports the cost in usage."""
    content = [{"type": "text", "text": prompt}]
    if reference is not None:
        data = base64.b64encode(reference.read_bytes()).decode()
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{data}"}})
    body = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": content}],
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": "1:1", "image_size": IMAGE_SIZE},
        "usage": {"include": True},
    }
    data = post_json(OPENROUTER_ENDPOINT, body,
                     {"Authorization": f"Bearer {openrouter_key()}",
                      "X-Title": "Leserina picture prototype"})
    message = data["choices"][0]["message"]
    for image in message.get("images", []):
        url = image["image_url"]["url"]
        usage = data.get("usage", {})
        return to_png(base64.b64decode(url.split(",", 1)[1])), {
            "usage": usage, "cost": float(usage.get("cost", 0))}
    raise RuntimeError(f"no image in response: {json.dumps(data)[:500]}")


def post_json(url, body, headers):
    """POST with retries on rate limits and server errors."""
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **headers})
    attempts = 8  # OpenRouter's shared upstream pool for Google rate-limits often
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:500]
            if e.code in (429, 500, 502, 503) and attempt < attempts - 1:
                time.sleep(min(15 * (attempt + 1), 60))
                continue
            raise RuntimeError(f"HTTP {e.code}: {detail}") from None


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
    data = post_json(ENDPOINT.format(model=API_MODEL), body, {"x-goog-api-key": key})
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


def reference_for(backend, style):
    path = OUT / style / "reference.png"
    if not path.exists():
        prompt = (f"A picture of {REFERENCE_SUBJECT} for a children's picture dictionary, "
                  f"drawn as {STYLES[style][1]}. {COMMON}")
        t0 = time.time()
        png, fields = make_image(backend, prompt, None, f"{style}_reference")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png)
        log({"style": style, "id": "reference", "model": model_name(backend), "prompt": prompt,
             "seconds": round(time.time() - t0, 1), **fields})
        print(f"{style}/reference  ${fields['cost']:.4f}  {time.time() - t0:.0f}s")
    return path


def generate_one(backend, style, word, reference, force):
    wid, _, subject = word
    path = OUT / style / "pictures" / f"{wid}.png"
    if path.exists() and not force:
        return
    prompt = (f"A picture of {subject} for a children's picture dictionary, drawn as "
              f"{STYLES[style][1]}. Match the attached reference image exactly in drawing "
              f"style, rendering, line weight, lighting and background, but draw "
              f"{subject} instead of its subject, in the natural colours of "
              f"{subject}. {COMMON}")
    t0 = time.time()
    png, fields = make_image(backend, prompt, reference, f"{style}_{wid}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    log({"style": style, "id": wid, "model": model_name(backend), "prompt": prompt,
         "seconds": round(time.time() - t0, 1), **fields})
    print(f"{style}/{wid}  ${fields['cost']:.4f}  {time.time() - t0:.0f}s")


def generate(args):
    if args.backend == "api":  # fail early without a key
        api_key()
    if args.backend == "openrouter":
        openrouter_key()
    OUT.mkdir(parents=True, exist_ok=True)
    styles = [args.style] if args.style else list(STYLES)
    words = [w for w in WORDS if not args.word or w[0] == args.word]
    jobs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        refs = dict(zip(styles, pool.map(lambda s: reference_for(args.backend, s), styles)))
        for style in styles:
            for word in words:
                jobs.append(pool.submit(generate_one, args.backend, style, word, refs[style],
                                        args.force))
        failed = 0
        for job in concurrent.futures.as_completed(jobs):
            try:
                job.result()
            except Exception as e:  # keep going; rerun fills the gaps
                failed += 1
                print(f"failed: {e}", file=sys.stderr)
    total, n = spent()
    print(f"spent so far: ${total:.2f} for {n} images")
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
    shown = [e for e in costs.values() if (OUT / e["style"]).exists()]
    models = sorted({e["model"] for e in shown})
    secs = [e["seconds"] for e in shown if "seconds" in e]
    total, n = spent()
    if total:
        cost_note = (f"${total:.2f} spent for {n} generated images (including the 3 style "
                     f"references and any reruns), {IMAGE_SIZE} square.")
    else:
        cost_note = ("No per-image cost: billed to the Google AI Pro subscription "
                     "(its daily image quota), 1024×1024.")
    if secs:
        cost_note += f" About {sum(secs) / len(secs):.0f} s per picture."

    def cell(style, wid):
        src = OUT / style / ("reference.png" if wid == "reference" else f"pictures/{wid}.png")
        if not src.exists():
            return '<td class="missing">missing</td>'
        name = f"{style}-{wid}.png"
        shutil.copy(src, dest / "img" / name)
        e = costs.get((style, wid), {})
        note = f"${e['cost']:.3f}" if e.get("cost") else ""
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
<title>Picture prototype P2: Gemini image model</title>
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
<p>Model: <b>{html.escape("; ".join(models) or "none yet")}</b>.
{html.escape(cost_note)} Each picture was made with the style reference in the top row
passed along.</p>
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
    g.add_argument("--backend", choices=["openrouter", "api", "agy"], default="openrouter")
    g.add_argument("--parallel", type=int, default=3)
    g.set_defaults(fn=generate)
    s = sub.add_parser("sheet", help="write the contact sheet (HTML) with its images")
    s.add_argument("dest", help="directory for index.html and img/")
    s.set_defaults(fn=sheet)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
