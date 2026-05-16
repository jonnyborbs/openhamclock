# Presentations

Reveal.js slide decks about OpenHamClock. Use them, fork them, take them to
your club.

Each deck is a folder with a self-contained `index.html` (no build step, all
assets via CDN), a README explaining how to run and customize it, and
printable speaker notes.

## Decks

| Folder                                             | Audience                 | Length        | Style            |
| -------------------------------------------------- | ------------------------ | ------------- | ---------------- |
| [`dvra-w2zq-2026-05-13/`](./dvra-w2zq-2026-05-13/) | Ham radio club (general) | ~25 min + Q&A | Tour + live demo |

## Using a deck

```bash
cd presentations/<deck>
open index.html   # or just drag onto a browser
```

Then press `F` for fullscreen and `S` for the speaker view. Each deck's
README has the rest of the keybindings and a suggested talk timing.

## Contributing a new deck

If you give a talk and want to share your deck:

1. Copy an existing deck folder as your starting point.
2. Rename it `<event-or-club>-YYYY-MM-DD/`.
3. Edit `index.html` — find-and-replace name, callsign, club, date.
4. Update the deck README with audience notes and a slide-by-slide timing.
5. Add a row to the table above and open a PR against `Staging`.

Decks here are MIT licensed (same as the project). Attribution appreciated
but not required.
