"""The 12 prototype words, their picture ids and the English subject the models draw."""

WORDS = [
    # (German word, English subject for the prompt)
    ("Ball", "a colourful children's play ball"),
    ("Auto", "a small red car"),
    ("Hut", "a brown felt hat with a ribbon (a hat to wear on the head)"),
    ("Maus", "a little grey mouse (the animal)"),
    ("Hund", "a friendly brown dog"),
    ("Sonne", "a bright yellow sun with short rays"),
    ("Apfel", "a red apple with a green leaf"),
    ("Fisch", "an orange fish"),
    ("Baum", "a leafy green tree"),
    ("Schrank", "a wooden wardrobe with two doors"),
    ("Schmetterling", "a butterfly with colourful wings"),
    ("Eichhörnchen", "a red squirrel with a bushy tail"),
]

import re

_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


def slug(word: str) -> str:
    """ASCII id of a word, as the app expects it in pictures/<id>.png (Eichhörnchen -> eichhoernchen).

    The same as src/slug.ts and slug() in scripts/render_audio.py.
    """
    s = word.strip().lower().translate(_UMLAUTS)
    return re.sub(r"[^a-z0-9]", "-", s).strip("-")
