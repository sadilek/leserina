# Pictures

One picture per word, named after the word's `id` in `words.json` (`baer.png` for "Bär"):
`png`, `webp` or `jpg`, square, the object centred on a plain light background. The app shows
each on a rounded white card. A word without a picture here gets a placeholder (its emoji on a
coloured card), so pictures can be added one by one.

Avatars for the children's profiles go here too, as `avatar-<animal>.png` (`avatar-fuchs.png`);
the animals are listed in `src/avatars.ts`.

The app picks up whatever lies here at build time; run `npm run build` (or restart `npm run dev`)
after adding pictures.
