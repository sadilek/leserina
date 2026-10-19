#!/usr/bin/env python3
"""Speak German text in the owner's ElevenLabs voice: text on stdin, WAV to $DEMO_WAV.

The voice command `render_audio.py` uses by default. The key comes from ELEVENLABS_API_KEY or
from the file named in ELEVENLABS_KEY_FILE; ELEVENLABS_VOICE_ID names another voice,
ELEVENLABS_MODEL another model and ELEVENLABS_SPEED another pace.

Spoken alone, many words come out English, whatever the model and `language_code`: Rose as
"rouz", Giraffe with an English "dsch", Igel as "Eagle". A row of German words sent as
`previous_text` makes them German: the model speaks the word as if it came after that row,
without speaking the row. One German sentence there was not enough for Rose and Giraffe; a row as
`next_text` as well made the model start the next word at the end of the clip ("Igel ab");
speaking several words at once and cutting them apart either let the next word's first sound into
a clip or, with pauses between the words, lost the German again.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path

VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "AJX546nEWdCoekjOePfl")
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
# 1.0 is the voice's own pace; ElevenLabs takes 0.7 to 1.2.
SPEED = float(os.environ.get("ELEVENLABS_SPEED", "1.0"))
BEFORE = "Haus. Baum. Sonne. Hund. Katze. Apfel. Brot. Mond."
RATE = 24000


def api_key() -> str:
    if key := os.environ.get("ELEVENLABS_API_KEY"):
        return key.strip()
    if path := os.environ.get("ELEVENLABS_KEY_FILE"):
        return Path(path).expanduser().read_text().strip()
    sys.exit("no ElevenLabs key: set ELEVENLABS_API_KEY or ELEVENLABS_KEY_FILE")


def main() -> None:
    target = os.environ.get("DEMO_WAV")
    if not target:
        sys.exit("DEMO_WAV names the WAV file to write")
    text = sys.stdin.read().strip()
    if not text:
        sys.exit("no text on stdin")
    request = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=pcm_{RATE}",
        json.dumps({"text": text, "model_id": MODEL, "language_code": "de",
                    "previous_text": BEFORE, "voice_settings": {"speed": SPEED}}).encode(),
        {"xi-api-key": api_key(), "Content-Type": "application/json"},
    )
    try:
        pcm = urllib.request.urlopen(request, timeout=60).read()
    except urllib.error.HTTPError as exc:
        sys.exit(f"ElevenLabs answered {exc.code}: {exc.read()[:300].decode(errors='replace')}")
    with wave.open(target, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(RATE)
        fh.writeframes(pcm)


if __name__ == "__main__":
    main()
