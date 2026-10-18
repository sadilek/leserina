# Leserina

A reading game for young children, made by a parent for their own kids and published as is.
It runs in the browser and installs as a full-screen app on a tablet or phone:
**https://sadilek.github.io/leserina/**. The words and the interface are German.

Pictures and words lie scattered on a mat; the child drags a word onto its picture (or the picture
onto its word). Each pair fills an arm of a gold star, and a full star goes into the child's
jar of night sky, where the stars collected so far form a constellation. Tapping a picture or a word reads the word aloud, in a parent's own voice. Words
start easy and get harder per child, and the ones a child gets wrong come back, as with flashcards.

Everything runs on the device: no account, no tracking. Progress lives in the browser's local
storage. Optionally, a family's devices (say an iPad and a phone) share it through a small server,
so a child can carry on from any of them; see "Syncing between devices".

## Running it

```bash
npm install
npm run dev        # http://localhost:5180/leserina/, also on the LAN address Vite prints
npm run check      # type check and unit tests
npm run build      # static site in dist/, with a service worker for offline use
npm run preview    # serves dist/ on http://localhost:5181/leserina/
```

While `npm run dev` runs, the app syncs with a local worker at port 8787 of the same host, so
testing never touches the families' real data: `cd worker && npm install && npm run dev`.
Two origins make two devices on one machine, e.g. `http://localhost:5180/leserina/` and the LAN
address Vite prints. `VITE_SYNC_URL` overrides the worker's address.

## Publishing and updating

A push to `main` publishes the app: the GitHub Actions workflow (`.github/workflows/pages.yml`)
runs `npm ci`, `npm run check` and `npm run build` and deploys `dist/` to GitHub Pages. Installed
apps update themselves: the service worker (`registerType: 'autoUpdate'`) fetches the new version
in the background, and the next start of the app runs it.

The address must never change. An installed app keeps its data (profiles, stars, learning state)
in `localStorage`, which belongs to its origin, `https://sadilek.github.io`, and the app is
installed for the path `/leserina/`. Under a new address it would start empty. Hence:

- The repository stays `sadilek/leserina`, and Vite's `base` stays `/leserina/`.
- `sadilek.github.io` must never get a custom domain. GitHub would then redirect every project
  page of the account to that domain, the origin would change, and every installed app would
  lose its data.

## Installing

- iPad (Safari): open https://sadilek.github.io/leserina/, then "Teilen → Zum Home-Bildschirm".
- Android (Chrome): open the address, then the menu (⋮) → "App installieren".

Chrome on Android installs the app as part of Chrome: the app and a Chrome tab at the address
share their data. Clearing Chrome's data or browsing history for `sadilek.github.io` therefore
also wipes the app's progress. On a device connected to the family (see below), entering the
family code again brings everything back.

The installed app starts full-screen and works offline: every picture and clip is cached on
install. On the iPad this also protects the data: iOS may wipe a website's storage after 7 days
without use, but not that of a home-screen app. The game works in both orientations, on a phone
too; on Android the back gesture during a round only returns to the start screen.

## Syncing between devices

In the parents' corner, "Geräte verbinden" connects a family's devices. The first device creates
a family code: five words from a German word list (`src/family-words.txt`, 2048 words, CC0, from
[wordlists-de](https://codeberg.org/fossarchive/wordlists-de)), about 55 bits, so nobody guesses
it. Every other device has the code typed in; the first four letters of each word are enough.
The code is the only key to the family's data, so there is no link: on the iPad a link would open
Safari anyway, whose storage is separate from the home-screen app. "Trennen" stops syncing on a
device and keeps what it shows.

What is stored online, under the family code and nothing else: the children's names and animals,
their settings, their learning state and star counts, per device. No accounts, no other data.

How it works (`src/merge.ts`, with tests that play on two devices offline and then sync):

- localStorage stays the working copy; the app works fully offline. Each device keeps its own
  document (what happened on it) and the other devices' documents as last fetched; merging them
  gives what the app shows. Data from before syncing became the device's own document.
- A sync fetches all documents of the family, merges and uploads the device's own: at app start,
  when the app comes back to the foreground, when the device goes online and after each finished
  round. Requests time out after 6 seconds; failures stay silent, and the parents' corner shows
  when the device last synced.
- Each device only ever writes its own document, so nothing conflicts. Name, animal and settings:
  the latest change wins. Stars and rounds: each device counts its own, the total is the sum.
  Word states: the latest wins per word; a word may come up a round early after devices played
  apart, but none is lost. A reset starts a new count on every device; a deleted profile stays
  deleted. The unfinished round stays on its device.
- Two devices that each had a profile for the same child before connecting show both; the
  parents' corner points this out, and the unwanted one is deleted there.

The server is a Cloudflare Worker in `worker/` with one Durable Object per family, stored in the
EU, one row per device. It checks the code's format, the device id, that the body is a JSON
object below 256 KB, and that a family has at most 10 devices (a wiped device comes back under a
new id; its old document keeps counting). It answers only the published app and local dev
servers (CORS). Its address is in `src/sync.ts`. Cloudflare's free plan allows 100,000 requests
a day and 5 GB; past a limit, requests fail until the daily reset, nothing is billed, and the
app syncs later.

Setting it up (once): create a free Cloudflare account, choose its `workers.dev` subdomain in
the dashboard (Workers & Pages), then:

```bash
cd worker
npm install
npx wrangler login     # opens the browser, once per Mac
npm run check          # type check and tests, in the Workers runtime
npx wrangler deploy    # prints https://leserina-sync.<subdomain>.workers.dev
```

Changes to the worker are deployed the same way, by hand. A new address goes into `src/sync.ts`;
installed apps pick it up with the next update.

## The voice

The clips in `audio/` are the owner's own voice, rendered through a voice clone. They are not
under the MIT license of the code: you may use them only with this app. To use another voice,
render your own clips (see below) or delete them; without a clip, the device's own German voice
reads the word.

## How it is built

- `words.json`: the word list, sorted from easy to hard, with a difficulty score and level 1-5
  per word. Generated by `npm run words` (`scripts/score_words.py`) from `data/words-source.csv`;
  the script's docstring explains the score. To move a word, put a number in that row's optional
  `adjust` column (negative = earlier) and rerun.
- `audio/<id>.mp3`: one clip per word, rendered by `npm run render-audio`
  (`scripts/render_audio.py`). A separate voice-clone setup renders the clips: any command that
  reads text on stdin and writes a WAV to `$DEMO_WAV`, set in `LESERINA_TTS_CMD`. `--only`
  re-renders single words, `--names Lena,Max` renders the children's names for the start screen
  as `audio/name-<id>.mp3`. Those stay on the local machine (`.gitignore`), so children's names
  never reach the public repository; the published app reads names with the device's voice.
  `scripts/check_audio.py` transcribes every clip with Whisper (it needs a Python environment
  with Whisper, such as the voice clone's) and lists those that may not say their word. Whisper
  itself cannot tell very short words (Ei, Ohr, Wal) apart, so a person has to listen to those.
  Without a clip, the device's own German voice reads the word.
- `pictures/<id>.png`: one picture per word. Without one, the word's emoji stands in. See
  `pictures/README.md`.
- `src/scheduler.ts`: the learning logic, a Leitner box system counted in rounds, as pure
  functions with tests that simulate children (`src/scheduler.test.ts`).
- `src/game.ts`: the game screen; `src/layout.ts`: scattering the cards on the mat;
  `src/start.ts`: picking a child; `src/parents.ts`: the parents' corner (hold the lock at the
  bottom right of the start screen).
- `src/star.ts`: the round's star (one arm per pair) and the jar. Each star in the jar has a fixed
  place (`jarSpots`), so a new star never moves the old ones; the jar shows up to 50, its badge
  counts them all.
- `src/store.ts`: profiles, stars, learning state and the unfinished rounds in `localStorage`;
  `src/merge.ts`, `src/sync.ts`, `src/familycode.ts` and `worker/`: syncing between devices.
- `mockups/`: static design drafts for themes (space, under the sea, dinosaurs, flower garden,
  building site), not part of the app and not in the published site. With `npm run dev`
  running, open http://localhost:5180/leserina/mockups/.

## The learning logic

Every word a child has seen sits in a box 1-5 and has the round it is due next: box 1 next round,
then 2, 4, 8 and 16 rounds later. Box 5 counts as known.

- Dropped on a wrong partner at least once: back to box 1. The word that was dragged counts as wrong.
- Right on the first try without help: one box up.
- Right, but the child tapped the word first and heard it: stays in its box. Tapping a picture is
  no help.
- The last pair of a round is right by elimination: stays in its box.

A round takes the due words in boxes 1-3 first (most overdue first), then up to 2 new words in
difficulty order while at most 8 words sit in boxes 1-2, then due words in boxes 4-5, then
not-yet-due words from the lowest boxes. Reviews of nearly known words wait behind the new ones
so that a child who gets everything right keeps getting new words. Words below the child's start
level are never introduced.

## License

The code is under the MIT license (`LICENSE`). The voice clips in `audio/` are not; see
"The voice" above.
