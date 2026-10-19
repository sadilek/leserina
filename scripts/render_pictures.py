#!/usr/bin/env python3
"""Render the pictures of the words and the avatars, in every style, with Nano Banana 2.1.

Each picture is one request to gemini-nano-banana-2.1 through the Gemini API (generateContent),
billed per picture (about $0.04 at 1K, October 2026); the Google project needs billing. The key
comes from GEMINI_API_KEY, else ~/.config/leserina/gemini.key.

What a picture shows comes from data/picture-prompts.csv (id, English subject): one row per word
of words.json and per avatar (`avatar-<animal>`). Each request carries the style's reference
picture, data/picture-styles/<style>.png (a teapot, outside the word list), so that the pictures
of one style look like one set. The styles and their wording are those of picture prototype P2.

The model's 1K PNGs go to pictures-raw/<style>/<id>.png (ignored by git, so re-encoding costs
nothing); the app gets them as 512 px WebP in pictures/<style>/<id>.webp (needs `cwebp`,
`brew install webp`).

    python3 scripts/render_pictures.py                       # every picture not there yet
    python3 scripts/render_pictures.py --only hund,ohr       # redo these, in every style
    python3 scripts/render_pictures.py --only hund --style clay
    python3 scripts/render_pictures.py --encode              # re-encode the WebPs from the PNGs

Standard library only.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import csv
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "data" / "picture-prompts.csv"
REFERENCES = ROOT / "data" / "picture-styles"
RAW = ROOT / "pictures-raw"
PICTURES = ROOT / "pictures"
KEY_FILE = Path.home() / ".config" / "leserina" / "gemini.key"

MODEL = "gemini-nano-banana-2.1"
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
IMAGE_SIZE = "1K"
# What the app gets: plenty for a 184 px card on a 2x screen, about 30 KB each.
WEBP_SIZE = 512
WEBP_QUALITY = 82
# Standard-tier prices from ai.google.dev/gemini-api/docs/pricing, read on 2026-10-18.
PRICE_INPUT_PER_TOKEN = 0.50 / 1e6
PRICE_OUTPUT_IMAGE_PER_TOKEN = 30.00 / 1e6
PRICE_OUTPUT_TEXT_PER_TOKEN = 3.00 / 1e6

# The style names are the app's (src/assets.ts); the descriptions are P2's.
STYLES = {
    "watercolour": "soft watercolour picture-book illustration, gentle washes, delicate lines",
    "clay": "round 3D clay figure, soft plasticine look, rounded shapes, soft studio light",
}

COMMON = ("One single object, centred, filling about two thirds of a square picture, "
          "on a plain light background with nothing else: no text, no letters, no frame, "
          "no scenery, no other objects. Friendly and instantly recognisable for a "
          "four-year-old child.")
# Avatars sit in a circle (object-fit: cover), so the head fills more of the square.
AVATAR = ("One single animal head, centred, filling most of a square picture so that it still "
          "looks whole when cropped to a circle, on a plain light background with nothing else: "
          "no text, no letters, no frame, no scenery, no other objects. Friendly, for a "
          "four-year-old child.")


def prompt(pid: str, subject: str, style: str) -> str:
    kind = "an avatar picture" if pid.startswith("avatar-") else "a children's picture dictionary"
    return (f"A picture of {subject} for {kind}, drawn as {STYLES[style]}. Match the attached "
            f"reference image exactly in drawing style, rendering, line weight, lighting and "
            f"background, but draw {subject} instead of its subject, in the natural colours of "
            f"{subject}. {AVATAR if pid.startswith('avatar-') else COMMON}")


def api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit(f"No API key: set GEMINI_API_KEY or create {KEY_FILE} (mode 600).")
    return key


def post_json(body: dict, key: str) -> dict:
    """POST with retries on rate limits and server errors, for up to ten minutes."""
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    deadline = time.time() + 600
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:500]
            if e.code in (429, 500, 502, 503, 504) and time.time() < deadline:
                attempt += 1
                time.sleep(min(15 * attempt, 60))
                continue
            raise RuntimeError(f"HTTP {e.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            if time.time() < deadline:
                attempt += 1
                time.sleep(min(15 * attempt, 60))
                continue
            raise RuntimeError(str(e)) from None


def request_image(key: str, text: str, reference: bytes) -> tuple[bytes, dict]:
    """One generateContent call. Returns (image bytes, usage metadata)."""
    body = {
        "contents": [{"role": "user", "parts": [
            {"text": text},
            {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(reference).decode()}},
        ]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "1:1", "imageSize": IMAGE_SIZE},
        },
    }
    data = post_json(body, key)
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline:
                return base64.b64decode(inline["data"]), data.get("usageMetadata", {})
    raise RuntimeError(f"no image in response: {json.dumps(data)[:500]}")


def cost(usage: dict) -> float:
    """Dollars for one call, from its token counts."""
    out_image = sum(d.get("tokenCount", 0) for d in usage.get("candidatesTokensDetails", [])
                    if d.get("modality") == "IMAGE")
    out_total = usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)
    return (usage.get("promptTokenCount", 0) * PRICE_INPUT_PER_TOKEN
            + out_image * PRICE_OUTPUT_IMAGE_PER_TOKEN
            + (out_total - out_image) * PRICE_OUTPUT_TEXT_PER_TOKEN)


def encode(style: str, pid: str) -> None:
    """The app's WebP from the model's picture."""
    target = PICTURES / style / f"{pid}.webp"
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cwebp", "-quiet", "-q", str(WEBP_QUALITY), "-resize", str(WEBP_SIZE), "0",
                    "-metadata", "none", str(RAW / style / f"{pid}.png"), "-o", str(target)],
                   check=True)


log_lock = threading.Lock()


def render(key: str, style: str, pid: str, subject: str) -> float:
    text = prompt(pid, subject, style)
    t0 = time.time()
    raw, usage = request_image(key, text, (REFERENCES / f"{style}.png").read_bytes())
    path = RAW / style / f"{pid}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    if raw.startswith(b"\x89PNG"):
        path.write_bytes(raw)
    else:  # the API may answer with JPEG
        tmp = path.with_suffix(".img")
        tmp.write_bytes(raw)
        subprocess.run(["sips", "-s", "format", "png", str(tmp), "--out", str(path)],
                       check=True, capture_output=True)
        tmp.unlink()
    encode(style, pid)
    dollars = cost(usage)
    with log_lock:
        with open(RAW / "log.jsonl", "a") as f:
            f.write(json.dumps({"style": style, "id": pid, "model": MODEL, "prompt": text,
                                "seconds": round(time.time() - t0, 1), "usage": usage,
                                "cost": dollars}) + "\n")
    print(f"{style}/{pid}  ${dollars:.3f}  {time.time() - t0:.0f}s", flush=True)
    return dollars


def subjects() -> dict[str, str]:
    with PROMPTS.open(encoding="utf-8") as fh:
        rows = {r["id"]: r["subject"] for r in csv.DictReader(fh)}
    words = {w["id"] for w in json.loads((ROOT / "words.json").read_text())}
    if missing := sorted(words - rows.keys()):
        sys.exit(f"No subject in {PROMPTS.name} for: {', '.join(missing)}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma-separated ids to (re-)render, overwriting")
    parser.add_argument("--style", choices=list(STYLES), help="only this style")
    parser.add_argument("--encode", action="store_true", help="only re-encode the WebPs")
    parser.add_argument("--parallel", type=int, default=4)
    args = parser.parse_args()

    rows = subjects()
    only = {s.strip() for s in args.only.split(",")} if args.only else None
    if only and (unknown := only - rows.keys()):
        sys.exit(f"Not in {PROMPTS.name}: {', '.join(sorted(unknown))}")
    styles = [args.style] if args.style else list(STYLES)

    if args.encode:
        for style in styles:
            for png in sorted((RAW / style).glob("*.png")):
                if only is None or png.stem in only:
                    encode(style, png.stem)
        return

    def wanted(style: str, pid: str) -> bool:
        return pid in only if only is not None else not (PICTURES / style / f"{pid}.webp").exists()

    jobs = [(style, pid, subject) for style in styles for pid, subject in rows.items()
            if wanted(style, pid)]
    if not jobs:
        print("Every picture is there.")
        return
    key = api_key()
    print(f"{len(jobs)} pictures to render")
    total, failed = 0.0, 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        futures = [pool.submit(render, key, *job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            try:
                total += future.result()
            except Exception as e:  # keep going; a rerun fills the gaps
                failed += 1
                print(f"failed: {e}", file=sys.stderr, flush=True)
    print(f"${total:.2f} for {len(jobs) - failed} pictures")
    if failed:
        sys.exit(f"{failed} pictures failed; run again to retry them")


if __name__ == "__main__":
    main()
