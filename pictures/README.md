# Pictures

One folder per picture style, with one picture per word, named after the word's `id` in
`words.json` (`watercolour/baer.webp` for "Bär"): `webp`, `png` or `jpg`, square, the object centred
on a plain light background. The styles are `watercolour` (the default) and `clay`, listed in
`PICTURE_STYLES` in `src/assets.ts`; each child's profile picks one in the parents' corner. The app
shows each picture on a rounded white card. A word without a picture in the child's style takes
the one from another style, and without any, a placeholder (its emoji on a coloured card), so
pictures can be added one by one.

Avatars for the children's profiles go here too, as `<style>/avatar-<animal>.webp`
(`watercolour/avatar-fuchs.webp`); the animals are listed in `src/avatars.ts`.

`scripts/render_pictures.py` renders all of them with Nano Banana 2.1 (Gemini API): what each
picture shows is in `data/picture-prompts.csv`, the look of each style comes from its reference
picture in `data/picture-styles/`. A new word needs a row in the CSV, then a run of the script.

The app picks up whatever lies here at build time; run `npm run build` (or restart `npm run dev`)
after adding pictures.
