#!/usr/bin/env python3
# /// script
# dependencies = ["fonttools", "brotli", "shapely"]
# ///
"""Build the rune font for the rune mode: src/fonts/runes.woff2.

With "Runen" on in a profile's settings, the game shows every letter as a rune (README, "Rune
mode"). The font maps each Latin letter, capital and small alike, to one rune, so the app keeps
its text as it is and only the font changes.

Each rune is a few strokes on a stave, drawn as polylines in a box 700 high (y up) and stroked
round. Where a rune of the Elder Futhark (or the Younger Futhark or the Anglo-Saxon Futhorc) for
the letter's sound does not look like a Latin letter, it is that rune: ᚾ n, ᚼ h, ᛚ l, ᛏ t, ᚴ k,
ᛞ d, ᛈ p, ᛟ o, ᛦ r, ᛘ m. Most of the others look like Latin letters, as the Latin alphabet is where
they came from (ᚱ R, ᛒ B, ᛁ I, ᚠ F, ᛖ M for e, ᚷ X for g), so another rune's shape stands in, or
one drawn in the same style. An umlaut is its vowel's rune with two dots above, as in German.

    uv run scripts/make_runes.py
"""

from __future__ import annotations

import json
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely.geometry import LineString, Point
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "fonts" / "runes.woff2"

H = 700
M = 350


def stave(x: float, a: float = 0, b: float = H):
    return [(x, a), (x, b)]


# Letter -> (where the shape comes from, its strokes).
RUNES: dict[str, tuple[str, list[list[tuple[float, float]]]]] = {
    "a": ("ᛄ ger (Futhorc)", [stave(170), [(170, M + 190), (330, M), (170, M - 190), (10, M), (170, M + 190)]]),
    "b": ("ᛠ ear (Futhorc)", [stave(170), [(0, H - 200), (170, H), (340, H - 200)], [(0, H - 400), (170, H - 200), (340, H - 400)]]),
    "c": ("drawn: a bow tie on a stave", [stave(170), [(0, H), (340, H - 300), (0, H - 300), (340, H)]]),
    "d": ("ᛞ dagaz", [stave(0), stave(420), [(0, 0), (420, H)], [(0, H), (420, 0)]]),
    "e": ("ᛃ jera (j)", [[(170, H), (0, H - 170), (170, H - 340)], [(130, 340), (300, 170), (130, 0)]]),
    "f": ("drawn: two strokes across", [stave(150), [(0, M + 60), (300, M + 260)], [(0, M - 260), (300, M - 60)]]),
    "g": ("ᛤ cealc (Futhorc)", [stave(170, 300, H), [(170, 300), (340, 0), (0, 0), (170, 300)]]),
    "h": ("ᚼ hagall (Younger Futhark)", [stave(170), [(0, M + 170), (340, M - 170)], [(0, M - 170), (340, M + 170)]]),
    "i": ("ᛜ ingwaz (ng)", [[(170, 0), (340, M), (170, H), (0, M), (170, 0)]]),
    "j": ("drawn: a hanging triangle", [stave(170), [(170, H - 120), (340, H - 300), (0, H - 300), (170, H - 120)]]),
    "k": ("ᚴ kaun (Younger Futhark)", [stave(0), [(0, M), (260, M + 260)]]),
    "l": ("ᛚ laguz", [stave(0), [(0, H), (240, H - 220)]]),
    "m": ("ᛘ madr (Younger Futhark)", [stave(170), [(0, H - 40), (170, M - 80), (340, H - 40)]]),
    "n": ("ᚾ naudiz", [stave(150), [(0, M + 130), (300, M - 130)]]),
    "o": ("ᛟ othala", [[(0, 0), (340, 340), (170, H), (0, 340), (340, 0)]]),
    "p": ("ᛈ perth", [[(260, H), (80, H - 180), (80, 180), (260, 0)], [(80, H - 180), (0, H - 260)], [(80, 180), (0, 260)]]),
    "q": ("drawn: a ladder", [stave(0), stave(300), [(0, H - 120), (300, H - 280)], [(0, M - 80), (300, M - 240)]]),
    "r": ("ᛦ yr (Younger Futhark, final R)", [stave(170), [(0, 0), (170, M), (340, 0)]]),
    "s": ("ᛡ ior (Futhorc)", [stave(150), [(0, H), (150, H - 180), (300, H)], [(0, 0), (150, 180), (300, 0)]]),
    "t": ("ᛏ tiwaz", [stave(170), [(0, H - 240), (170, H), (340, H - 240)]]),
    "u": ("ᛇ eihwaz", [stave(130), [(130, H), (260, H - 160)], [(130, 0), (0, 160)]]),
    "v": ("drawn: a broom", [stave(170), [(0, H), (340, H - 340)], [(0, H - 340), (340, H)]]),
    "w": ("ᛆ short-twig a (Younger Futhark)", [stave(240), [(240, M + 100), (0, M - 120)]]),
    "x": ("drawn: two hooks", [[(0, H), (170, H - 170), (0, H - 340)], [(340, 340), (170, 170), (340, 0)]]),
    "y": ("drawn: a fir", [stave(170), [(0, M), (170, M + 200), (340, M)], [(0, M - 260), (170, M - 60), (340, M - 260)]]),
    "z": ("drawn: a hanging diamond", [stave(170, 340, H), [(170, 0), (340, 170), (170, 340), (0, 170), (170, 0)]]),
    "ß": ("ᛥ stan (Futhorc, st)", [stave(0), stave(360), [(0, H), (360, M)], [(0, M), (360, H)], [(0, M), (360, 0)], [(0, 0), (360, M)]]),
}
UMLAUTS = {"ä": "a", "ö": "o", "ü": "u"}

UPM = 2048
# Andika's line metrics, so that a word card is as tall in runes as in letters.
ASCENT, DESCENT = 2500, -800
SCALE = 2.0  # 700 -> 1400 units, a little below Andika's capitals (1460).
WIDEN = 1.15  # Runes are narrow; a little wider, they read better.
STROKE = 200  # Andika's stems are 200-225 units wide.
SIDE = 160  # Space on each side of a rune.
DOT = 0.62 * STROKE  # Radius of an umlaut dot.


def outline(lines: list[list[tuple[float, float]]], dots: list[tuple[float, float]] = ()):
    """The strokes, stroked round and merged into one shape, in font units."""
    parts = [LineString([(x * SCALE * WIDEN, y * SCALE) for x, y in line]).buffer(STROKE / 2, quad_segs=6) for line in lines]
    parts += [Point(x, y).buffer(DOT, quad_segs=6) for x, y in dots]
    return unary_union(parts)


def draw(shape, dx: float):
    """The shape as a TrueType glyph, moved right by dx: outer contours clockwise, holes counter-clockwise."""
    pen = TTGlyphPen(None)
    polygons = getattr(shape, "geoms", [shape])
    for poly in polygons:
        poly = orient(poly, sign=-1.0)
        for ring in [poly.exterior, *poly.interiors]:
            pts = [(round(x + dx), round(y)) for x, y in ring.coords[:-1]]
            pen.moveTo(pts[0])
            for p in pts[1:]:
                pen.lineTo(p)
            pen.closePath()
    return pen.glyph()


def main():
    letters = {c for w in json.loads((ROOT / "words.json").read_text()) for c in w["word"].lower()}
    missing = sorted(letters - set(RUNES) - set(UMLAUTS))
    if missing:
        raise SystemExit(f"No rune for: {' '.join(missing)}")
    glyphs = {".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (600, 0), "space": (600, 0)}
    cmap = {0x20: "space"}

    def add(name: str, shape):
        minx, _, maxx, _ = shape.bounds
        glyphs[name] = draw(shape, SIDE - minx)
        metrics[name] = (round(maxx - minx + 2 * SIDE), SIDE)

    for letter, (_, lines) in RUNES.items():
        name = f"rune_{ord(letter):04x}"
        add(name, outline(lines))
        cmap[ord(letter)] = name
        if letter.upper() != letter and len(letter.upper()) == 1:
            cmap[ord(letter.upper())] = name
    for umlaut, base in UMLAUTS.items():
        lines = RUNES[base][1]
        xs = [x * SCALE * WIDEN for line in lines for x, _ in line]
        mid = (min(xs) + max(xs)) / 2
        top = H * SCALE + STROKE / 2 + 2.2 * DOT
        name = f"rune_{ord(umlaut):04x}"
        add(name, outline(lines, [(mid - 190, top), (mid + 190, top)]))
        cmap[ord(umlaut)] = cmap[ord(umlaut.upper())] = name

    order = list(glyphs)
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({"familyName": "Leserina Runen", "styleName": "Regular"})
    fb.setupOS2(
        version=4, sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0,
        usWinAscent=ASCENT, usWinDescent=-DESCENT, sCapHeight=round(H * SCALE), sxHeight=round(H * SCALE),
        fsSelection=0b11000000,  # REGULAR | USE_TYPO_METRICS, as Andika
    )
    fb.setupPost()
    fb.font.flavor = "woff2"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fb.save(OUT)
    print(f"{OUT.relative_to(ROOT)}: {len(cmap)} characters, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
