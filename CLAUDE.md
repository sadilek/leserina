# Leserina

See README.md for what the app is, how to run it and how the learning logic works.

- Check before committing: `npm run check` (tsc and vitest).
- File names for clips and pictures use the word's ASCII `id` (Bär → `baer`); `src/slug.ts` and
  `slug()` in `scripts/render_audio.py` must stay identical.
- `words.json` is generated: edit `data/words-source.csv` or `scripts/score_words.py`, then run
  `npm run words`. The tests check that the list has unique ids and words and is sorted by level.
- Clips and pictures are picked up at build time via `import.meta.glob` (`src/assets.ts`); while
  `npm run dev` runs, every new file in `audio/` or `pictures/` reloads the page.
- UI text is German (the children and parents are German speakers); code and docs are English.
