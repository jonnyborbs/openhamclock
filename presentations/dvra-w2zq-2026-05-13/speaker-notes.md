# Speaker Notes — DVRA Talk

Full script-grade notes. Read through it the night before; print and bring it
to the lectern. Same notes also live in `index.html` (press `S` while
presenting for Reveal's speaker view), but the in-deck versions are
condensed — this file is the long-form prep.

Personal placeholders in `[BRACKETS]` — swap them with your own details
before Wednesday.

---

## Slide 1 — Title (~30 sec)

**The goal of this slide:** establish who you are and what they're in for,
no more.

**Sample opening:**

> "Thanks for having me tonight. I'm Chris, K0CJH, [LICENSED SINCE YEAR],
> [LOCATION / WHERE YOU OPERATE FROM]. I want to spend the next 25 minutes
> or so talking about a project called OpenHamClock — what it is, what it
> does, and how you can run it on whatever you've already got. Then we'll
> save time for questions."

**Don't:** read the title off the slide. Don't apologize for technical
problems before they happen. Don't open with "so…"

**Do:** make eye contact with someone in the back row in the first ten
seconds. The room calibrates to that.

**Transition into slide 2:**

> "Before I show you any of it, the elevator-pitch version."

---

## Slide 2 — One-breath pitch (~1 min)

**The goal:** give the audience a frame so the rest of the talk lands. Don't
read the bullets — _talk through_ them.

**Sample line:**

> "OpenHamClock is the screen you wish was always running in your shack. DX
> spots, propagation, satellites, parks, weather, rig control — all in one
> browser tab instead of eight."

**Read the room — fast hands check, don't dwell:**

- "Who here runs HamClock today?" _(hands)_
- "Who has VOACAP open in a browser tab right now?" _(more hands)_
- "Who has PSKReporter or a cluster page bookmarked?" _(most hands)_
- "Right. That's the problem this solves."

**The point to land:** it's free, open source, runs in any browser, and you
can be using it ninety seconds from now.

**Transition into slide 3:**

> "Before I show you anything new, I want to acknowledge where the idea
> came from. This isn't a slide I'd skip."

---

## Slide 3 — Dedication to WB0OEW (~1 min)

**The most important slide on a human level.** Slow down. Don't rush this.

**Sample:**

> "Anyone who's been licensed for more than a few years probably knows the
> name Elwood Downey, WB0OEW. He built the original HamClock — the little
> dashboard you've seen mounted on Raspberry Pis in shacks all over the
> place. He became a Silent Key in early 2026."
>
> "HamClock ran on Pis, on tablets, on old laptops, on those cheap 800x480
> screens. It was honest, it was useful, it was beautifully crafted. And it
> was free."
>
> "OpenHamClock is _not_ a fork of his code. It's a ground-up rewrite in
> modern web technology — but the goal is identical. Give an operator one
> screen that tells them what's happening in the world. The dedication in
> the LICENSE file is real. This project exists because his did."

Pause. Let it land. Then move on.

**Don't:** make it longer than a minute. The respect is in the
acknowledgment, not the length.

**Transition into slide 4:**

> "So — what does this thing actually look like?"

---

## Slide 4 — The big picture (~2 min)

**The goal:** orient them spatially before you start naming features.

**Sample:**

> "The default layout is a world map with everything else floating on top of
> it. Your callsign and the time are up top. Solar weather — SFI, K-index,
> sunspot number — runs across the header. Your DX cluster, the satellites,
> the activations, the weather, all live in dockable panels around the map."
>
> "And it's _dockable_ in a real sense. Panels tear off, redock, resize.
> You can save a layout for the bench, another for EmComm, another for
> contesting — one click to switch."

**Anecdote you can use:**

> "I have one layout that's just-the-map and one that's everything-at-once.
> When I'm casually monitoring I use the first. When I'm hunting POTA or
> chasing DX I flip to the second."

**Transition:**

> "Let's go around the map and the panels one at a time."

---

## Slide 5 — The map (~1.5 min)

**The goal:** sell the map as the _application_, not as a backdrop. This is
the headline feature.

**Sample:**

> "Almost everything in OpenHamClock happens on this map. It's a real
> Leaflet world map — pan, zoom, projection of your choice. The day/night
> terminator updates in real time. You pick where you are — your **DE** —
> and where you're working — your **DX** — and instantly you have distance,
> bearing, gridsquare, sunrise and sunset at both ends."
>
> "When you click a DX cluster spot, it doesn't just go to a list. It draws
> the great-circle path right there on the map. You can _see_ propagation
> instead of just reading about it."

**Promise to deliver later:**

> "I'll show you all of this live in a few minutes."

**Transition:**

> "What's _on_ that map? Let's start with the cluster."

---

## Slide 6 — DX cluster + PSKReporter (~2 min)

**The goal:** convince the cluster-skeptical hams that this is the cluster
they've been waiting for.

**Sample:**

> "The DX cluster has been around since the late '80s — and frankly, most
> cluster interfaces have looked like it. You see every spot, you can't
> filter sanely, callsigns you don't care about clutter the screen. OHC's
> cluster is the version you wish you'd had all along."
>
> "Filter by band, by mode, by CQ zone, by your own watchlist. Maintain an
> exclude list for callsigns or even prefixes you don't want to see ever
> again. Thirty-minute retention by default, so you see the _trend_ on a
> band, not just whoever spotted last."

**Then PSKReporter:**

> "PSKReporter pane runs alongside. Real-time, via MQTT — not the old
> five-minute polling. Two tabs: who's hearing you, who you're hearing.
> 'MySpots' lights up the moment your callsign hits the cluster."

**Hook for digital-mode operators:**

> "If you run FT8 or FT4 or WSPR — you don't need a second tab open anymore.
> It's right there next to everything else."

**DVRA contributor moment — DO NOT SKIP:**

There's a callout on this slide for **Rich Freedman, N2EHL**, a DVRA
member whose work shaped the cluster filtering UX. Pause when you reach
it. Look toward Rich if he's in the room. Suggested line:

> "Quick aside — the cluster filtering you're seeing here, the exclude
> list, the watchlist, band/mode/zone — that pattern is largely shaped
> by contributions from one of your own, Rich Freedman, N2EHL. And the
> same approach is what now drives how activations get filtered too.
> Rich, if you're here — thank you. Your contributions are greatly
> appreciated."

Let the room react. This is a moment.

**Transition:**

> "Speaking of activations — beyond rag-chewing and DX, the cluster
> shows another whole world: portable activators."

---

## Slide 7 — POTA / SOTA / WWFF / WWBOTA (~2 min)

**The goal:** show breadth of activation programs, then ask the room which
they actually use.

**Sample:**

> "On the same map, four kinds of activator markers. Green triangles are
> POTA — Parks on the Air. Orange diamonds are SOTA — Summits on the Air.
> Light green inverted triangles are WWFF — World Wide Flora and Fauna.
> Purple squares are WWBOTA — Bunkers on the Air."
>
> "Click any of them and you get the park reference or summit code, the
> activator's callsign, frequency, mode, time spotted. Filter the whole
> map by program if you only chase one."

**Room check:**

> "Who here is a POTA chaser?" _(many hands)_
> "Who's activated lately?" _(some)_
> "Anyone WWBOTA?" _(usually a laugh)_

**Aside about WWBOTA — this almost always lands:**

> "WWBOTA is the new one. It's _bunkers_ — old military and civil defense
> relics. It's exploded in the last 18 months. Whatever your hobby looked
> like a couple of years ago, it now also includes hams crawling around
> Cold War bunkers."

**Bonus feature to mention:**

> "Audio alerts on a band you're watching — so you can be in the kitchen
> and still know when someone shows up on 17 meters."

**Transition:**

> "Now — what tells you whether 17 meters is even open right now?"

---

## Slide 8 — Propagation + VOACAP (~2 min)

**The goal:** establish OHC's propagation panel as _actually live_, not
yesterday's screenshot.

**Sample:**

> "Most propagation tools you've used are screenshots. You go to a website,
> you see numbers, you don't really know how old they are. OpenHamClock
> shows you the real-time indices — SFI, K-index, A-index, sunspot number
> — as gauges, the way they ought to be presented. Solar imagery from SDO
> and Helioviewer, cycled in the solar panel. X-ray flux, so you can see a
> flare coming before propagation goes sideways."
>
> "But here's the part to underline: the band-condition predictions are
> _live_. There's an ITU-R HF propagation engine — the same physics VOACAP
> is built on — running on the server, every ten minutes. The colored
> band overlay on the map isn't a screenshot of last week's predictions.
> It's a fresh prediction generated for _your_ QTH, _now_."

**Drive the point home:**

> "If the K-index spikes and conditions deteriorate, you'll see it on the
> map within ten minutes. That's the difference."

**Transition:**

> "Speaking of things in real time — satellites."

---

## Slide 9 — Satellites (~1.5 min)

**The goal:** quickly cover an audience-pleasing feature. Don't dwell unless
the room is sat-heavy.

**Sample:**

> "Satellites are on the same map as everything else. Live SGP4 tracking —
> the same orbital mechanics that everything serious uses. Pass predictions
> for your QTH, sorted by next AOS. Footprint and ground track drawn on
> the map."
>
> "Pick from the active sat catalog — AO-91, SO-50, ISS, RS-44, FO-29, and
> the QO-100 geostationary footprint. One click and it's overlaid alongside
> your DX spots and POTA activators. You don't lose your context."

**If the room has sat ops:**

> "QO-100 isn't visible from here in PA, obviously, but the footprint
> visualization alone is fun to look at. And if you've worked QO-100 from
> elsewhere, you know how nice it is to see who else might be in the
> footprint."

**Transition:**

> "All right — let's talk about your radio."

---

## Slide 10 — Rig control + WSJT-X (~2 min)

**The goal:** the power-user payoff slide. Sell the click-to-tune workflow.

**Sample:**

> "Click a spot. Your radio tunes. That's the whole pitch."
>
> "OpenHamClock has a plugin layer called the Rig Bridge. It talks to
> almost any modern radio over almost any transport. Direct USB CAT, no
> hamlib required. Hamlib if you've already got rigctld running. flrig if
> that's your stack. SmartSDR for Flex 6000- and 8000-series. TCI for
> Thetis, ExpertSDR, SunSDR. RTL-SDR for receive-only experimenting."

**Models — light name-drop:**

> "Yaesu — the FT-991A, 891, 710, the DX10, the 5000. Kenwood — TS-890,
> 590, 2000, 480. Icom — 7300, 7610, 9700, 705, 7851. Elecraft K3 and K4.
> FlexRadio, SunSDR, Hermes-Lite 2, ANAN. If you've heard of it and it
> talks to a computer, OHC probably already speaks its protocol."

**The killer feature — sell it twice:**

> "The workflow is: you see a DX cluster spot on 20 meters. You click it.
> Your radio moves to that frequency, that mode, that bandwidth. You key
> up. That's it. No alt-tabbing. No retyping a frequency."

**And the reverse direction:**

> "WSJT-X, JTDX, MSHV, JS8Call — they all stream their decodes through
> the relay. Decoded callsigns appear _on the map_ in real time. You can
> _see_ who's hearing you."

**There's also a cloud relay** (only mention if you have time):

> "If you've got an internet connection at the shack, the cloud relay lets
> you control your rig from anywhere — phone, laptop, tablet."

**Transition:**

> "OK — that's the day-to-day operator. What about the bad days?"

---

## Slide 11 — EmComm (~2 min)

**The goal:** show OHC as a credible situational-awareness tool when things
go sideways. Calibrate enthusiasm to the room's EmComm involvement.

**Sample:**

> "OpenHamClock ships with a dedicated EmComm layout. One screen,
> everything you need during an activation: weather, space weather, paths,
> activations — all visible at once. You're not alt-tabbing during an
> incident."

**Walk through the EmComm-relevant overlays:**

> "On the map: aurora overlay from NOAA's OVATION model, real-time. Weather
> radar from your local source. Live USGS earthquakes. All toggleable."

**The messaging side:**

> "Winlink RMS gateway is wired through the Rig Bridge — that's pending
> Winlink API approval at the moment. MeshCom UDP is in beta for local
> mesh-radio relay."

**Internationalization angle, only if relevant:**

> "Ten languages — including Spanish, French, German, Portuguese,
> Japanese — which matters for cross-border EmComm and for groups that
> work with non-English-speaking served agencies."

**Room check:**

> "DVRA does any ARES or RACES work?" _(adjust depth based on response)_

**Transition:**

> "All right — enough slides. Let me show you the actual thing."

---

## Slide 12 — LIVE DEMO (~5 min)

**The heart of the talk.** If only one part of the deck has to land, it's
this one.

**How the slide works:**

OpenHamClock blocks iframe embedding on purpose, so the slide is a
big-button "open the live site in a new tab" treatment, not an embed.
Press `L` from the slide (or click the button) and the live site opens in
a fresh tab. `Alt`+`Tab` (or `Cmd`+`~` on macOS) to flip back to the deck
when you're done.

**Before you advance to the slide:**

- Open `openhamclock.com` in a separate browser tab _before the talk
  starts_. Set up your callsign and grid so you're not seeing the wizard.
  Click around once to warm the cache.
- Have the deck tab and the live tab as the only two tabs in that
  browser window — makes `Cmd+~` / `Alt+Tab` predictable.

**The walk — practice this Tuesday night:**

1. **The map with the terminator.** Point at the day/night line. "That's
   right now."
2. **Click a DX cluster spot.** The great-circle path draws. Pick a spot
   on a different continent for maximum visual effect.
3. **Filter the cluster by band.** "20m only" or "FT8 only" — show the
   spots vanish and reappear.
4. **Open the PSKReporter pane.** Show MySpots, TX, RX tabs.
5. **Toggle the POTA layer on.** Click an activator. Show the popup.
6. **Open the Space Weather pane.** Point at the gauges. If K-index is up,
   make a joke about today being good for chasing aurora.
7. **Toggle Aurora overlay if K is elevated.** Visual payoff.

**Safety rules — read these to yourself before you go on stage:**

- **Don't live-edit settings during the demo.** Stay in defaults. Don't
  change your callsign on stage; you'll forget to undo it.
- **Don't try the rig-control demo unless you've rehearsed the setup.**
  Most projector-room WiFi won't reach your shack rig anyway.
- **If WiFi flakes, switch to your pre-loaded tab.** Don't try to
  reconnect on stage.

**Transition out of the demo:**

> "OK — I could click around in this for an hour, but let me come back to
> the deck so you don't leave without the URLs."

---

## Slide 13 — Built to be hacked (~1.5 min)

**The goal:** establish credibility — open source, real plugin system,
real contributors, real velocity.

**Sample:**

> "OpenHamClock is MIT licensed. Seventeen rig-bridge plugins. Three
> built-in map overlays. Ten languages. Twenty-eight named contributors
> in the README — and this project is _three months old_."
>
> "Map overlays are React hooks. If you can write JavaScript, you can
> copy one of the three built-ins, edit it, restart, and your overlay
> shows up in the layer toggle. The architecture docs and the plugin
> guide are both in the repo."

**The "AddOns" pitch:**

> "There's also an AddOns folder — userscripts that the community ships.
> APRS auto-position, calculators, news feeds. Low-friction way to add
> something quirky without touching the core."

**Drive the velocity point:**

> "Three months old, 28 contributors. That should tell you something
> about how welcoming the project is to PRs."

**Transition:**

> "How do you get it on your stuff?"

---

## Slide 14 — Install options (~1.5 min)

**The goal:** lower the activation energy. Tell them which path is right
for _them_.

**Sample:**

> "Four ways in. Pick whichever matches your patience."

**Walk through them:**

> "Zero install — visit openhamclock.com. The setup wizard asks for your
> callsign and your grid. You're operating in 30 seconds."
>
> "Raspberry Pi kiosk — one curl command, runs the install script,
> reboots into fullscreen Chromium. Perfect for a wall display in the
> shack. I run one on a Pi 3 — it's fine."
>
> "Local install on a Mac or Linux box or WSL — clone the repo, npm ci,
> npm start. Open localhost:3000."
>
> "Docker if you want it isolated on your home server. docker-compose
> up -d and you're done."

**Room hands check:**

> "Show of hands — who already runs a Pi for ham stuff?" _(most hands)_
> "That's the kiosk install. Fresh Pi, paste one line, walk away, come
> back to a wall display."

**Privacy note worth flagging:**

> "If you self-host, all API calls are proxied through your own backend.
> Nothing about your operating goes anywhere you don't control."

**Transition:**

> "Last real slide — how to get involved."

---

## Slide 15 — Get involved (~1 min)

**The goal:** make the ask explicit. Tell them exactly what to do next.

**Sample:**

> "If you take nothing else from tonight, take this: try it. openhamclock
> dot com, no install, your callsign and grid in the wizard. Five minutes."
>
> "If you find a bug, or there's a feature you want, file a GitHub issue.
> Negative feedback is more valuable than silence. The Facebook group
> 'OpenHamClock' is the most active community channel. There's also a
> subreddit at r-slash-OpenHamClock."
>
> "If you write code — pull requests against the Staging branch. The
> docs walk you through dev setup. If you've been looking for a project
> to contribute to, this is one where your first PR has a real chance of
> being merged."

**If you have business cards or a QR code:** mention them here.

**Transition into closing:**

> "And with that —"

---

## Slide 16 — Thank you + Q&A

**Sample close:**

> "Thanks again for having me. This project exists because of 28 people
> who decided to send PRs to a three-month-old repo. And a special thanks
> on screen to one of your own — Rich Freedman, N2EHL — whose work on
> cluster filtering shaped how the activations panel filters too. Rich,
> truly appreciated."
>
> "If anyone has questions — I'm Chris, K0CJH, my contact's on the screen
> — I'd love to take them."

**73, sit back, take questions.**

### Q&A bank — be ready for these

> **"Does it work offline?"**
> Mostly no. Some panes do — the clock, satellite pass predictions
> (orbital elements cache). Map tiles cache for short periods. The
> propagation panel, cluster, and PSKReporter all need internet.

> **"Will it run on my old Pi 3?"**
> Yes. Kiosk mode is happy on a Pi 3. A Pi 4 with 2GB+ is more
> comfortable, especially if you're running other things alongside.

> **"How is it different from HamClock?"**
> Modern web stack — React, Node.js — instead of native C++. Plugin
> system from day one. Active contributor community. Web-first instead
> of local-display-first. Same spiritual goal, completely different
> implementation. It's not a fork; it's a homage.

> **"Who funds this?"**
> Nobody. It's open source, no funder. Hosting at openhamclock.com is
> out of pocket. Donations welcome but not required. If you want zero
> dependence on the cloud instance, self-host — that's the whole point.

> **"Is my data private?"**
> Self-host for zero external dependencies. Otherwise, only public APIs
> see your callsign — the DX cluster and PSKReporter, both of which
> already get it if you operate at all.

> **"Can I run it on a tablet?"**
> Yes. Layout is responsive. iPad on the bench works well. Phone is
> usable but the layout assumes more screen real estate than a phone
> has.

> **"Does it talk to LoTW / Club Log / QRZ / [LOGBOOK]?"**
> Not yet. File an issue if you want it. Logbook integration is on the
> roadmap.

> **"Does it support [MY SPECIFIC RADIO MODEL] I didn't see on the slide?"**
> If it speaks Hamlib, yes — via the rigctld plugin. If it has a Yaesu,
> Kenwood, or Icom CAT protocol, probably also yes via direct USB. If
> it's something weird (homebrew SDR, vintage gear) — open an issue and
> we'll figure it out.

> **"What about contests?"**
> There's a contest calendar built in. Active contest integration
> (logging, dupes) is not in scope — N1MM and other contest loggers do
> that better.

> **"How does it handle weak signal modes — JT9, FST4, MFSK?"**
> Anything WSJT-X / JTDX / MSHV decodes will flow through the relay and
> show up on the map. The list of modes plotted depends on what your
> decoder is configured to decode.

> **"Can the audience see what I have set up at home?"**
> Only what _you_ configure to be shareable. Default is private. The
> rig-control cloud relay requires you to set it up explicitly.

> **"I'm not a coder — how can I help?"**
> File good bug reports. Suggest features. Translate strings (10
> languages today, more welcome). Make a video showing how you use it.

---

## Pre-talk checklist — Tuesday night

- [ ] Open `index.html` on the presentation laptop. Verify the deck renders
      and the title slide looks right.
- [ ] Press `S` — verify Reveal's speaker view opens in a second window.
- [ ] Open `openhamclock.com` in a separate browser tab. Sign in / set
      callsign + grid. Click around once to warm the cache. Leave it open.
- [ ] On slide 12, click the "Open in new tab" button once to verify the
      `L` keybinding / link works.
- [ ] Pre-set your callsign and grid on the live site so the demo doesn't
      start from the setup wizard.
- [ ] Walk the demo path once (see slide 12 notes) — time it.
- [ ] Set browser zoom to 100%.
- [ ] Clear autocomplete history in the URL bar (you don't want
      embarrassing suggestions to pop up on the projector).
- [ ] Disable system notifications. Do Not Disturb on.
- [ ] Charge the laptop fully. Plug it in. Don't trust the battery alone.
- [ ] Test the projector adapter on a TV at home. Bring a spare adapter
      and an HDMI cable.
- [ ] Print this notes file. Stick it in the laptop bag.
- [ ] Print or load a QR code to github.com/accius/openhamclock if you
      want to share that easily.

## At the venue

- [ ] Get there 20 minutes early. Plug in, mirror the display, verify the
      audience can read the smallest text on the deck.
- [ ] Confirm WiFi works on the presentation laptop. Test loading
      `openhamclock.com` _now_, not during slide 12.
- [ ] Decide: mirror or extend display. (Mirror is simpler. Extend lets
      you keep speaker notes private but is a higher risk of mistakes.)
- [ ] Have a glass of water on the lectern.
- [ ] If they're broadcasting to Zoom: share the _deck window only_, not
      the whole desktop. Otherwise the speaker notes window leaks.
- [ ] Before slide 1: take a breath, look at the back row, smile.

73 and good luck out there.
