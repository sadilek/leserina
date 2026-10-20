"""How a German word is sounded out: its graphemes as written, and the sound each stands for.

    sounds("Hund")  ->  [("H", "h"), ("u", "u"), ("n", "n"), ("d", "t")]

A grapheme is what lights up as one while its sound plays, and later one tile to lay: a letter,
or several letters for one sound (sch, ch, ck, ng, au, ei, ie, a doubled consonant, a vowel with
its lengthening h as in "Kuh", the -er of "Tiger"). The sound codes:

  vowels      a e i o u ä ö ü short, a: e: i: o: u: ä: ö: ü: long, au ei eu, ə (the e of
              "Nase"), ɐ (the -er of "Tiger")
  consonants  b d g p t k m n l r f w h j s z sch ch ng ts pf ks kw, where s is the sharp s of
              "Bus", z the soft s of "Hase" (IPA, not the German letter z) and ts the German z

The rules cover regular spellings: final devoicing ("Hund" ends in t), sp/st at the start,
v spoken f, the soft s before a vowel, schwa in unstressed endings and the "Ge-" prefix, and the
vowel's length from what follows it. Compounds and loan words break them, so a word's row in
data/words-source.csv may spell its graphemes out in the column "sounds": units separated by
"|", each either as written ("H") or with its sound ("d=t"). Units without a sound take the one
the rules give them, in that segmentation.

    python3 scripts/phonics.py          # prints every word's sounds, overrides marked with *
"""

from __future__ import annotations

VOWELS = set("aeiouäöüy")
# Graphemes of several letters, longest first. Vowel + h and doubled consonants are found apart.
MULTI = ["sch", "chs", "ch", "ck", "ng", "pf", "ph", "qu", "tz", "ei", "ie", "eu", "äu", "au", "aa", "ee", "oo"]
# Consonants that start a syllable together with a following l or r ("Brot", "Zebra").
ONSET = set("bdgkptf")
DEVOICED = {"b": "p", "d": "t", "g": "k"}
CONSONANT_SOUND = {
    "ß": "s", "ss": "s", "z": "ts", "tz": "ts", "zz": "ts", "ck": "k", "ph": "f", "v": "f",
    "qu": "kw", "x": "ks", "chs": "ks", "äu": "eu", "c": "k", "y": "j",
}
DIPHTHONGS = {"au", "ei", "eu", "äu"}

CODES = {
    *"aeiouäöü", *(v + ":" for v in "aeiouäöü"), "au", "ei", "eu", "ə", "ɐ",
    *"bdgptkmnlrfwhjsz", "sch", "ch", "ng", "ts", "pf", "ks", "kw",
}


def split(word: str) -> list[str]:
    """The word's graphemes, as written (case kept)."""
    w = word.lower()
    units, i = [], 0
    while i < len(w):
        size = next((len(g) for g in MULTI if w.startswith(g, i)), 1)
        if size == 1:
            nxt = w[i + 1] if i + 1 < len(w) else ""
            after = w[i + 2] if i + 2 < len(w) else ""
            if w[i] in VOWELS and nxt == "h" and after not in VOWELS:
                size = 2  # the lengthening h: "Kuh", "Zahn", "Ohr"
            elif w[i] not in VOWELS and nxt == w[i]:
                size = 2  # a doubled consonant is one sound: "Ball", "Affe"
        units.append(word[i:i + size])
        i += size
    # The -er at the end of a word of several syllables is one vowel: "Tiger", "Feuer".
    if len(units) > 2 and [u.lower() for u in units[-2:]] == ["e", "r"] and vowel_count(units[:-2]):
        units[-2:] = [units[-2] + units[-1]]
    return units


def is_vowel(unit: str) -> bool:
    return unit[0].lower() in VOWELS


def vowel_count(units: list[str]) -> int:
    return sum(1 for u in units if is_vowel(u))


def sound_of(units: list[str], i: int) -> str:
    """The sound of the i-th grapheme, from the graphemes around it."""
    u = units[i].lower()
    prev = units[i - 1].lower() if i else ""
    nxt = units[i + 1].lower() if i + 1 < len(units) else ""
    if is_vowel(u):
        return vowel_sound(units, i)
    if len(u) == 2 and u[0] == u[1]:
        return CONSONANT_SOUND.get(u, u[0])  # "Ball", "Tasse", "Pizza"
    if u in ("b", "d", "g"):
        # Final devoicing: at the end of a syllable, before another consonant than l or r.
        if not nxt or (not is_vowel(nxt) and nxt not in ("l", "r")):
            return DEVOICED[u]
        return u
    if u == "s":
        if i == 0 and nxt in ("p", "t"):
            return "sch"  # "Spinne", "Stern"
        if nxt and is_vowel(nxt) and (i == 0 or is_vowel(prev) or prev in ("l", "m", "n", "r")):
            return "z"  # the soft s of "Sofa", "Hase"
        return "s"
    if u == "n" and nxt in ("k", "ck"):
        return "ng"  # "Geschenk", "Krankenwagen"
    return CONSONANT_SOUND.get(u, u)


def vowel_sound(units: list[str], i: int) -> str:
    u = units[i].lower()
    if u == "er":
        return "ɐ"
    if u in DIPHTHONGS:
        return "eu" if u == "äu" else u
    if u == "ie":
        return "i:"
    v = u[0]
    if len(u) == 2:
        return v + ":"  # "aa", "ee", "oo", or a vowel with its lengthening h
    first = vowel_count(units[:i]) == 0
    several = vowel_count(units) > 1
    follow = []
    for x in units[i + 1:]:
        if is_vowel(x):
            break
        follow.append(x.lower())
    ends = i + 1 + len(follow) == len(units)
    if v == "e" and several and not first:
        if ends and len(follow) <= 1:
            return "ə"  # "Nase", "Igel", "Kuchen"
        if len(follow) >= 2 and follow[0] in ("n", "l", "r") and not ends:
            return "ə"  # inside a compound: "Regenbogen", "Schmetterling"
    if v == "e" and i == 1 and units[0].lower() == "g" and several:
        return "ə"  # the prefix "Ge-": "Geschenk"
    if not follow:
        return v + ":"
    if len(follow) == 1:
        f = follow[0]
        if f == "ß":
            return v + ":"
        if (len(f) == 2 and f[0] == f[1]) or f in ("ck", "tz", "sch", "ch", "chs", "ng", "pf", "x"):
            return v
        return v + ":"  # an open syllable ("Hase") or one consonant at the end ("Hut")
    if len(follow) == 2 and not ends and follow[0] in ONSET and follow[1] in ("l", "r"):
        return v + ":"  # "Zebra": the b starts the next syllable
    return v


def parse(word: str, spelled: str) -> list[tuple[str, str]]:
    """A hand-written spelling from the CSV ("H|u|n|d=t"), checked against the word."""
    pieces = [p.split("=", 1) for p in spelled.split("|")]
    units = [p[0] for p in pieces]
    if "".join(units) != word:
        raise ValueError(f"{word}: the graphemes in {spelled!r} do not spell the word")
    out = []
    for i, p in enumerate(pieces):
        code = p[1] if len(p) == 2 else sound_of(units, i)
        if code not in CODES:
            raise ValueError(f"{word}: unknown sound {code!r} in {spelled!r}")
        out.append((units[i], code))
    return out


def sounds(word: str, spelled: str = "") -> list[tuple[str, str]]:
    if spelled:
        return parse(word, spelled)
    units = split(word)
    return [(u, sound_of(units, i)) for i, u in enumerate(units)]


def show(pairs: list[tuple[str, str]]) -> str:
    return "|".join(g if g.lower() == c else f"{g}={c}" for g, c in pairs)


if __name__ == "__main__":
    import csv
    from pathlib import Path

    with (Path(__file__).resolve().parent.parent / "data" / "words-source.csv").open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            spelled = row.get("sounds") or ""
            print(f"{'*' if spelled else ' '} {row['word']:16} {show(sounds(row['word'], spelled))}")
