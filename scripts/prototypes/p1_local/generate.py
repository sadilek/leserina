# /// script
# requires-python = "==3.13.*"
# dependencies = ["mflux==0.23.0", "pillow<13"]
# ///
"""Picture prototype P1: render the 12 words in three styles locally with mflux (MLX).

Generators:
  klein       FLUX.2 klein 4B, style prompt only.
  klein-ref   FLUX.2 klein 4B with a style reference image: the Ball that "klein" drew for a
              style is the reference for that style's other eleven words (run "klein" first).
  zimage      Z-Image-Turbo, style prompt only (it takes no reference images).

Output: <out>/<generator>/<style>/<id>.png plus <out>/<generator>/timings.json.
Weights land in the Hugging Face cache (~/.cache/huggingface), never in the repo.

  uv run scripts/prototypes/p1_local/generate.py --generator klein-ref
"""

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from words import WORDS, slug  # noqa: E402

REPO = Path(__file__).resolve().parents[3]

STYLES = {
    "sticker": (
        "Flat vector sticker illustration of {subject}. Bold thick dark outlines, flat solid colours, "
        "no gradients, simple friendly shapes, children's app style. One single object, centred, "
        "fully visible with space around it, on a plain very light cream background. No text."
    ),
    "watercolour": (
        "Soft watercolour illustration of {subject} from a children's picture book. Gentle pastel "
        "washes, delicate pencil outlines, light paper texture. One single object, centred, fully "
        "visible with space around it, on a plain very light off-white background. No text."
    ),
    "clay": (
        "Cute round 3D clay figure of {subject}, handmade plasticine look, soft rounded shapes, soft "
        "studio lighting, gentle shadow. One single object, centred, fully visible with space around "
        "it, on a plain very light pastel background. No text."
    ),
}

REFERENCE_PROMPT = (
    "Image 1 shows the art style. Draw a new picture of {subject} in exactly the same art style as "
    "image 1: same technique, line weight, colour palette, lighting and plain background. Show only "
    "{subject}, nothing of the object in image 1. "
)

SEED = 42
SIZE = 1024
GENERATORS = {"klein-ref": "FLUX.2 klein 4B + style reference", "klein": "FLUX.2 klein 4B", "zimage": "Z-Image-Turbo"}
STEPS = {"klein-ref": 4, "klein": 4, "zimage": 9}


def load(generator: str, quantize: int | None):
    from mflux.models.common.config import ModelConfig

    if generator == "klein":
        from mflux.models.flux2.variants import Flux2Klein

        return Flux2Klein(model_config=ModelConfig.flux2_klein_4b(), quantize=quantize)
    if generator == "klein-ref":
        from mflux.models.flux2.variants import Flux2KleinEdit

        return Flux2KleinEdit(model_config=ModelConfig.flux2_klein_4b(), quantize=quantize)
    from mflux.models.z_image.variants.z_image import ZImage

    return ZImage(model_config=ModelConfig.z_image_turbo(), quantize=quantize)


def render(model, generator: str, prompt: str, reference: Path | None):
    if generator == "klein-ref":
        return model.generate_image(
            seed=SEED,
            prompt=prompt,
            num_inference_steps=STEPS[generator],
            width=SIZE,
            height=SIZE,
            image_paths=[reference],
        )
    return model.generate_image(seed=SEED, prompt=prompt, num_inference_steps=STEPS[generator], width=SIZE, height=SIZE)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--generator", choices=GENERATORS, required=True)
    parser.add_argument("--styles", nargs="*", choices=STYLES, default=list(STYLES))
    parser.add_argument("--words", nargs="*", help="ids to render (default: all 12)")
    parser.add_argument("--quantize", type=int, choices=[4, 8], default=None)
    parser.add_argument("--out", type=Path, default=REPO / "prototypes-out" / "p1")
    args = parser.parse_args()

    out = args.out / args.generator
    timings_path = out / "timings.json"
    timings = json.loads(timings_path.read_text()) if timings_path.exists() else {}

    started = time.perf_counter()
    model = load(args.generator, args.quantize)
    timings["_meta"] = {
        "generator": GENERATORS[args.generator],
        "steps": STEPS[args.generator],
        "size": SIZE,
        "seed": SEED,
        "quantize": args.quantize,
        "load_seconds": round(time.perf_counter() - started, 1),
    }

    for style in args.styles:
        (out / style).mkdir(parents=True, exist_ok=True)
        for i, (word, subject) in enumerate(WORDS):
            pid = slug(word)
            if args.words and pid not in args.words:
                continue
            prompt = STYLES[style].format(subject=subject)
            reference = None
            if args.generator == "klein-ref":
                # The style reference is the plain klein picture of the first word.
                anchor = args.out / "klein" / style / f"{pid}.png"
                if i == 0:
                    shutil.copy(anchor, out / style / f"{pid}.png")
                    klein = json.loads((args.out / "klein" / "timings.json").read_text())
                    timings.setdefault(style, {})[pid] = klein[style][pid]
                    continue
                reference = args.out / "klein" / style / f"{slug(WORDS[0][0])}.png"
                prompt = REFERENCE_PROMPT.format(subject=subject) + prompt
            t0 = time.perf_counter()
            image = render(model, args.generator, prompt, reference)
            seconds = round(time.perf_counter() - t0, 1)
            image.save(path=out / style / f"{pid}.png", overwrite=True)
            timings.setdefault(style, {})[pid] = {"seconds": seconds, "reference": reference is not None}
            print(f"{args.generator} {style} {pid}: {seconds}s", flush=True)
            timings_path.write_text(json.dumps(timings, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
