# Picture prototype P1: local generation with mflux

Renders the 12 prototype words in three styles (flat sticker, watercolour, 3D clay) on this Mac
with [mflux](https://github.com/filipstrand/mflux) 0.23 (MLX), and builds a contact sheet.

    G=scripts/prototypes/p1_local/generate.py
    uv run $G --generator klein --quantize 8      # FLUX.2 klein 4B, style prompt only
    uv run $G --generator klein-ref --quantize 8  # klein + style reference (needs the klein run)
    uv run $G --generator zimage --quantize 8     # Z-Image-Turbo
    uv run scripts/prototypes/p1_local/contact_sheet.py --out ~/demos/leserina-p1

Images go to `prototypes-out/p1/<generator>/<style>/<id>.png` (git-ignored), with the time per
image in `timings.json`. Weights (~16 GB klein, ~33 GB Z-Image) land in the Hugging Face cache.
`--quantize 8` quantizes on load; bf16 needs more memory than this Mac has free while other
work runs.
