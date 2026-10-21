# Leserina

See README.md for what the app is, how to run it and how the learning logic works.

- Check before committing: `npm run check` (tsc and vitest); for changes in `worker/` (the sync
  server, its own package) also `cd worker && npm run check`.
- Synced documents (`src/merge.ts`) are read by every installed app of a family, old versions
  included: change their shape only so that older apps still read them, or bump `v` (older apps
  skip documents they cannot read).
- Every sound code in `words.json` (`sounds`, from `scripts/phonics.py` and the CSV column
  `sounds`) needs its clip in `audio/sounds/`, recorded by the owner (README, "Recording the
  sounds"); the tests check it. A word with a new sound needs that sound recorded first.
- File names for clips and pictures use the word's ASCII `id` (Bär → `baer`); `src/slug.ts` and
  `slug()` in `scripts/render_audio.py` must stay identical.
- `words.json` is generated: edit `data/words-source.csv` or `scripts/score_words.py`, then run
  `npm run words`. The tests check that the list has unique ids and words and is sorted by level.
- Clips and pictures are picked up at build time via `import.meta.glob` (`src/assets.ts`); while
  `npm run dev` runs, every new file in `audio/` or `pictures/` reloads the page.
- UI text is German (the children and parents are German speakers); code and docs are English.
- Published at https://sadilek.github.io/leserina/ by every push to `main`. Vite's `base`
  (`/leserina/`) and the repo name must never change, and `sadilek.github.io` must never get a custom
  domain: installed apps would lose their data (README, "Publishing and updating").
- The repository is public: children's names (`audio/name-*`, gitignored) never go into it. The
  one exception, decided by the owner: `name-katharina.mp3` and `name-alexander.mp3` ship with
  the app (listed in `.gitignore`). Any other name needs the owner's say first.
- This file never points to paths outside the repository (other projects, the owner's machine):
  they break for anyone who clones it. Local secrets such as API key files go into the gitignored
  `.secrets/` and are named here by that path.
- Rendering audio with ElevenLabs (`scripts/render_audio.py`, `scripts/tts_elevenlabs.py`) reads the key from `.secrets/elevenlabs.key` in the main checkout (a worktree has none of its own): `ELEVENLABS_KEY_FILE="$(git rev-parse --path-format=absolute --git-common-dir)/../.secrets/elevenlabs.key"`.
  The key itself never goes into the repository.
- Automated browser runs stay silent on the owner's Mac. Obeya's browser and demo skills already
  silence `speechSynthesis`; any other browser tool needs it stubbed in the page, because
  `src/sound.ts` speaks words without a clip (name clips are never in the repo) through the system
  voice, which Chrome's `--mute-audio` misses. Close the test browser when testing is done.
