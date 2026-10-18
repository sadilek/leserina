# Leserina

See README.md for what the app is, how to run it and how the learning logic works.

- Check before committing: `npm run check` (tsc and vitest); for changes in `worker/` (the sync
  server, its own package) also `cd worker && npm run check`.
- Synced documents (`src/merge.ts`) are read by every installed app of a family, old versions
  included: change their shape only so that older apps still read them, or bump `v` (older apps
  skip documents they cannot read).
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
- The repository is public: children's names (`audio/name-*`, gitignored) never go into it.
