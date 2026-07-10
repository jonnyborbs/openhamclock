# OpenHamClock — SFDXA Talk (July 8, 2026, via Zoom)

A ~25-minute Reveal.js deck about OpenHamClock for the South Florida DX
Association — a DX-focused adaptation of the DVRA deck, updated with
everything that shipped in the June (v26.4.x) and July (v26.5.0) release
drops. Reuses the DVRA deck's screenshots and structure; leads with the DX
cluster, the new OHC Cluster node, and the propagation-accuracy work.

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

## Presenting

| Key                 | Action                                                                            |
| ------------------- | --------------------------------------------------------------------------------- |
| `Space` / `→`       | Next slide                                                                        |
| `←` / `Shift+Space` | Previous slide                                                                    |
| `S`                 | Open **speaker view** in a new window (notes + timer + next-slide preview)        |
| `F`                 | Fullscreen                                                                        |
| `Esc`               | Slide overview                                                                    |
| `B` / `.`           | Black out the screen                                                              |
| `L`                 | Open **openhamclock.com** in a new tab (handy when you reach the live-demo slide) |
| `?`                 | Reveal.js help                                                                    |

The deck has speaker notes on every slide — press `S` and a second window
opens with the notes and a clock. Put that on the monitor Zoom isn't sharing.

## Presenting over Zoom

This talk is remote — a few things that matter more than in a room:

1. **Share the browser window, not the screen.** Keep the deck and the
   pre-warmed openhamclock.com tab in the _same window_ and switch tabs
   during the demo. Never Alt+Tab between windows while sharing — viewers
   see your desktop.
2. **Open the speaker view (`S`) on a second monitor** (or your laptop
   screen if you're sharing an external display). Zoom shares only the
   window you picked.
3. **Invite the audience to follow along** — openhamclock.com is live;
   people on the call can open it themselves during the demo. It lands
   better than any screen share.
4. **Drop links in the Zoom chat** at the "Get involved" slide:
   openhamclock.com and github.com/accius/openhamclock.
5. Turn off notifications (macOS Focus / Windows Do Not Disturb) before
   sharing.

## The live-demo slide

Slide 14 is intentionally a "switch to the live site" slide — OpenHamClock
blocks iframe embedding on purpose, so this deck doesn't try. The workflow:

1. **Before the talk:** open `https://openhamclock.com` in a second tab of
   the same browser window, set up your callsign and grid, leave it warm.
2. **During the talk:** when you hit slide 14, press `L` (or click the
   button) and switch tabs.
3. Switch back to the deck tab when done and advance.

The demo is ~5 minutes. Stick to navigation — don't change settings live,
you'll forget to undo them. A DX-flavored demo walk is in the slide's
speaker notes (spot → path → callsign popup → DXpedition filter → FT8
propagation flip).

## Slide-by-slide rundown

| #   | Slide                        | Length  | Notes                                   |
| --- | ---------------------------- | ------- | --------------------------------------- |
| 1   | Title                        | 30s     | Welcome + your intro                    |
| 2   | What it is (one breath)      | 1m      | The elevator pitch, DX-angled           |
| 3   | Dedication to WB0OEW         | 1m      | Keep this — it sets the tone            |
| 4   | The big picture              | 1.5m    | Describe the layout                     |
| 5   | Map                          | 1.5m    | Gray-line — this room gets it           |
| 6   | DX cluster + PSKReporter     | 2m      | New filters: DXpeditions, contest, spot |
| 7   | OHC Cluster node             | 2m      | NEW July — our own node, good story     |
| 8   | Chasing tools                | 1.5m    | NEW — callsign popup + DX local time    |
| 9   | Propagation + VOACAP         | 2m      | The FT8 threshold fix is the wow moment |
| 10  | POTA/SOTA/WWFF/WWBOTA        | 1.5m    | Trim if the room is HF-DX-only          |
| 11  | Satellites                   | 1.5m    | Sat DX framing; drop if HF-only         |
| 12  | Rig control + WSJT-X + N3FJP | 2m      | Pileup-speed framing                    |
| 13  | What else since spring       | 1m      | Rapid-fire; the meta-point is velocity  |
| 14  | **LIVE DEMO**                | **~5m** | The heart of the talk                   |
| 15  | Built to be hacked           | 1m      | The plugin pitch                        |
| 16  | Install options              | 1.5m    | Pi kiosk + the new Windows one-liner    |
| 17  | Get involved                 | 1m      | The ask — drop links in Zoom chat here  |
| 18  | Thanks + Q&A                 | rest    | 73                                      |

Total scripted: ~26 min + Q&A.

## Trim for a 15-minute slot

Drop slides 10, 11, 13 and keep the demo at 3 min — lands ~15 min total.

## License

Same as the project (MIT). Re-use this deck for any non-malicious purpose,
attribution appreciated but not required.
