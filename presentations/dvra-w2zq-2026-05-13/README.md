# OpenHamClock — DVRA / W2ZQ Talk (May 13, 2026)

A ~25-minute Reveal.js deck about OpenHamClock, originally written for the
Delaware Valley Radio Association (W2ZQ). Designed to double as a reusable
template for other club talks.

## Run it

It's a single self-contained HTML file with all assets loaded from CDN. No
build step.

```bash
# From this directory
open index.html              # macOS
xdg-open index.html          # Linux
start index.html             # Windows

# Or just drag index.html onto any modern browser.
```

For projector use, open it in Chrome/Edge/Safari, then `F` for fullscreen.

## Presenting

| Key                 | Action                                                                           |
| ------------------- | -------------------------------------------------------------------------------- |
| `Space` / `→`       | Next slide                                                                       |
| `←` / `Shift+Space` | Previous slide                                                                   |
| `S`                 | Open **speaker view** in a new window (notes + timer + next-slide preview)       |
| `F`                 | Fullscreen                                                                       |
| `Esc`               | Slide overview                                                                   |
| `B` / `.`           | Black out the screen                                                             |
| `L`                 | Open **openhamclock.com** in a new tab (handy if the embedded iframe is blocked) |
| `?`                 | Reveal.js help                                                                   |

The deck has speaker notes on every slide — press `S` once you're on a slide
and a second window opens with the notes and a clock. Pop that on a laptop the
audience can't see.

## The live-demo slide

Slide 12 is intentionally a "switch to the live site" slide — OpenHamClock
blocks iframe embedding on purpose, so this deck doesn't try. The workflow:

1. **Before the talk:** open `https://openhamclock.com` in a separate
   browser tab, sign in / set up your callsign and grid, leave it warm.
2. **During the talk:** when you hit slide 12, press `L` (or click the
   button on the slide). Either opens the live site in a new tab.
3. `Alt`+`Tab` (or `Cmd`+`~` on macOS) between the live tab and the deck
   for the rest of the demo.

The demo is ~5 minutes. Stick to navigation — don't change settings on
stage, you'll forget to undo them.

## Customize for your club

To repurpose this deck for another club night:

1. Duplicate the folder, rename it `presentations/<your-club>-YYYY-MM-DD/`.
2. In `index.html`, find-and-replace:
   - `DVRA · W2ZQ · MAY 13, 2026` → your club / date kicker
   - `Chris Hetherington · K0CJH` → your name / call
   - `chris@cjhlighting.com` → your contact
3. Trim or swap slides to match your audience. The slide-by-slide rundown:

| #   | Slide                    | Length  | Notes                             |
| --- | ------------------------ | ------- | --------------------------------- |
| 1   | Title                    | 30s     | Welcome + your intro              |
| 2   | What it is (one breath)  | 1m      | The elevator pitch                |
| 3   | Dedication to WB0OEW     | 1m      | Keep this — it sets the tone      |
| 4   | The big picture          | 2m      | Describe the layout               |
| 5   | Map                      | 1.5m    | The map is the application        |
| 6   | DX cluster + PSKReporter | 2m      | Two-column                        |
| 7   | POTA/SOTA/WWFF/WWBOTA    | 2m      | Drop if non-portable-ops audience |
| 8   | Propagation + VOACAP     | 2m      | The technical "wow" slide         |
| 9   | Satellites               | 1.5m    | Drop if audience is HF-only       |
| 10  | Rig control + WSJT-X     | 2m      | Power-user slide                  |
| 11  | EmComm                   | 2m      | Drop or emphasize per audience    |
| 12  | **LIVE DEMO**            | **~5m** | The heart of the talk             |
| 13  | Built to be hacked       | 1.5m    | The plugin pitch                  |
| 14  | Install options          | 1.5m    | Pi kiosk + Docker                 |
| 15  | Get involved             | 1m      | The ask                           |
| 16  | Thanks + Q&A             | rest    | 73                                |

Total scripted: ~25 min + Q&A.

## Trim for a 15-minute slot

Drop slides 7, 9, 11 and keep the demo at 3 min — lands ~15 min total.

## Trim for a 45-minute slot

Add a second demo block after slide 13, walking through a plugin or the
Rig Bridge live. Slides already in the deck are enough material.

## License

Same as the project (MIT). Re-use this deck for any non-malicious purpose,
attribution appreciated but not required.
