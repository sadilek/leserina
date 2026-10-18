#!/usr/bin/env python3
"""Build words.json from data/words-source.csv: a difficulty score per word, sorted by it.

The score adds two parts, both "higher is harder":

  reading      how hard the word is to decode for a beginner: letters and syllables, plus
               penalties for multi-letter graphemes (sch, ch, ei, ie, eu, äu, ck, ng, ...),
               consonant clusters, umlauts and ß, rare letters, and spellings that differ from
               the sound (final devoicing as in "Hund", v for f as in "Vogel", sp/st at the
               start, the lengthening h as in "Uhr", -er spoken as a vowel).
  familiarity  how late children know the object: the age-of-acquisition rating
               (Birchenough et al. 2017) and the childLex frequency for ages 6-8.

Level 1 holds only phonetically regular words of 3-4 letters that very young children know.
The other words are split into levels 2-5 of equal size by score. The optional column
"adjust" in the CSV is added to the score, so a word can be moved by hand (negative = earlier).

    python3 scripts/score_words.py          # writes words.json
"""

from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "words-source.csv"
TARGET = ROOT / "words.json"

VOWELS = set("aeiouäöüy")
# Graphemes of several letters that stand for one sound. Longest first.
GRAPHEMES = ["sch", "chs", "ch", "ck", "ng", "ei", "ie", "eu", "äu", "qu", "pf", "ph", "tz"]
# Letters a beginner meets late, or that do not sound as they look.
RARE = set("cqxyjvß")

W_LETTER, W_SYLLABLE = 1.0, 1.0
W_GRAPHEME, W_CLUSTER, W_UMLAUT, W_RARE, W_IRREGULAR = 1.5, 1.0, 1.0, 0.5, 1.5
W_AOA, W_FREQ = 1.5, 0.8


def irregularities(w: str) -> list[str]:
    """Spellings that differ from how the word sounds."""
    found = []
    if re.search(r"[bdg]$|[bdg][st]$", w):
        found.append("final devoicing")
    if "v" in w:
        found.append("v spoken f")
    if re.match(r"s[pt]", w):
        found.append("sp/st spoken schp/scht")
    if re.search(r"[aeiouäöü]h(?![aeiouäöü])", w):
        found.append("lengthening h")
    if re.search(r"er$|er[^aeiouäöü]", w) and not w.startswith("er"):
        found.append("-er spoken as a vowel")
    if re.search(r"(aa|ee|oo)", w):
        found.append("double vowel")
    return found


def reading_parts(word: str, syllables: int) -> dict:
    w = word.lower()
    graphemes = []
    rest = w
    for g in GRAPHEMES:
        n = rest.count(g)
        if n:
            graphemes += [g] * n
            rest = rest.replace(g, "C" if g[-1] not in VOWELS else "V")
    # Doubled consonants (ll, tt, ss) are one sound and easy; collapse them before counting clusters.
    collapsed = re.sub(r"([^aeiouäöüyV])\1", r"\1", rest)
    clusters = sum(len(run) - 1 for run in re.findall(r"[^aeiouäöüyV]{2,}", collapsed))
    umlauts = sum(w.count(c) for c in "äöüß")
    rare = sum(1 for c in w if c in RARE)
    irregular = irregularities(w)
    score = (
        W_LETTER * max(0, len(w) - 3)
        + W_SYLLABLE * (syllables - 1)
        + W_GRAPHEME * len(graphemes)
        + W_CLUSTER * clusters
        + W_UMLAUT * umlauts
        + W_RARE * rare
        + W_IRREGULAR * len(irregular)
    )
    return {
        "score": score,
        "graphemes": graphemes,
        "clusters": clusters,
        "irregular": irregular,
        "regular": not graphemes and not clusters and not umlauts and not rare and not irregular,
    }


def familiarity(aoa: float, per_million: float) -> float:
    return W_AOA * max(0.0, aoa - 2.0) + W_FREQ * max(0.0, 3.0 - math.log10(per_million + 1))


def main() -> None:
    with SOURCE.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    words = []
    for row in rows:
        r = reading_parts(row["word"], int(row["syllables"]))
        aoa = float(row["aoa"])
        freq = float(row["childlex_per_million"] or 1)
        f = familiarity(aoa, freq)
        adjust = float(row.get("adjust") or 0)
        words.append({
            "id": row["id"],
            "word": row["word"],
            "emoji": row["emoji"],
            "score": round(r["score"] + f + adjust, 2),
            "reading": round(r["score"], 2),
            "familiarity": round(f, 2),
            "letters": len(row["word"]),
            "syllables": int(row["syllables"]),
            "aoa": aoa,
            "aoaSource": row["aoa_source"],
            "perMillion": freq,
            "why": r["graphemes"] + r["irregular"] + (["%d cluster" % r["clusters"]] if r["clusters"] else []),
            "_level1": r["regular"] and len(row["word"]) <= 4 and aoa <= 4.0,
        })
    words.sort(key=lambda x: (not x["_level1"], x["score"], x["word"]))
    rest = [w for w in words if not w["_level1"]]
    for w in words:
        if w["_level1"]:
            w["level"] = 1
    for i, w in enumerate(rest):
        w["level"] = 2 + (4 * i) // len(rest)
    for w in words:
        del w["_level1"]
    TARGET.write_text(json.dumps(words, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for level in range(1, 6):
        print(level, " ".join(w["word"] for w in words if w["level"] == level))


if __name__ == "__main__":
    main()
