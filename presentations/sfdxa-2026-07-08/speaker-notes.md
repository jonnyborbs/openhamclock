# Script — SFDXA Talk (Zoom)

Word-for-word script, one section per slide. The same text lives in the
deck's speaker view (press `S` while presenting). Stage directions are in
_[brackets]_ — everything else is meant to be spoken.

Fill in the two `[BRACKETS]` placeholders on slide 1 before the call.

---

## Slide 1 — Title

> Thanks for having me tonight, everyone. I'm Chris Hetherington, K0CJH —
> [LICENSED SINCE YEAR], operating from [LOCATION]. I'm the developer
> behind a project called OpenHamClock, and over the next twenty-five
> minutes or so I want to show you what it is, what it does for a DXer
> specifically, and how you can run it on whatever you've already got.
>
> The back half of this is a live demo, and the site is live right now at
> openhamclock.com — so feel free to open it on your end and click along
> as we go.

---

## Slide 2 — One-breath pitch

> In one breath: OpenHamClock is everything a DXer wants, on one screen,
> in any browser. It's the DX cluster, DXpeditions, and PSKReporter,
> filtered the way you actually chase. It's VOACAP propagation run live
> for your QTH — not somebody's stale screenshot. It's click-a-spot and
> your radio tunes. And it's free and open source.
>
> It runs cloud-hosted at openhamclock.com, or you can self-host it on a
> Pi, a Mac, a Linux box, or in Docker.
>
> If you've ever had eight tabs open in the shack — a cluster page here,
> VOACAP there, PSKReporter in a third — that's the problem this solves.
> One screen.

---

## Slide 3 — Dedication to WB0OEW

> Before I show you anything new, I want to acknowledge where this comes
> from. If you've been licensed more than a few years, you probably know
> the name Elwood Downey, WB0OEW. He built the original HamClock — the
> little dashboard you've seen running on Raspberry Pis in shacks all
> over the world. Elwood became a Silent Key in early 2026.
>
> OpenHamClock is not a fork of his code. It's a ground-up rewrite for
> the modern web — but the goal is exactly his: give an operator one
> screen that tells them what's happening in the world. The dedication in
> the license file is real. This project exists because his did.
>
> _[Pause a beat, then advance.]_

---

## Slide 4 — The big picture

> So here's what it looks like. The default layout is a world map with
> everything else docked around it. Your callsign and the time are up
> top. Solar weather — SFI, K-index, sunspot number — runs across the
> header. Down the left, your DE and DX station panels, solar imagery,
> and VOACAP. On the right, the DX cluster, PSKReporter, DXpeditions, and
> contests. Band buttons across the bottom.
>
> And all of these panels dock, undock, tear off, and resize. You can
> save one layout for casual monitoring, another for a contest weekend,
> another for chasing a DXpedition — and flip between them with one
> click.

---

## Slide 5 — The map

> The map is the application. It's a real interactive map — pan, zoom,
> pick your projection. The day/night terminator updates in real time —
> and I don't have to explain to this club why that matters. When the
> gray line is crossing the entity you need, you can see it, live, right
> next to the spots.
>
> You set your DE — where you are — and pick a DX, and you instantly have
> distance, bearing, grid squares, and sunrise and sunset at both ends.
> And when you click a cluster spot, it draws the great-circle path right
> on the map.
>
> You'll see all of this live in a few minutes.

---

## Slide 6 — DX cluster + PSKReporter

> The DX cluster has been around since the late eighties — and most
> cluster interfaces still look like it. This is the version you wish
> you'd had all along.
>
> Filter by band, mode, CQ zone, or your own watchlist. Keep an exclude
> list of calls or prefixes you never want to see again. Spots are
> retained for thirty minutes, so you see the trend on a band — not just
> whoever spotted last.
>
> Four things on this panel are new since spring. There's a real mode
> column now, with sorting by time, frequency, or call. There's a
> one-click "show only DXpeditions" filter — it cross-references the
> DXpedition calendar, so the list collapses to just the ATNOs. There's a
> contest filter, for taming the firehose on contest weekends. And you
> can now send a spot straight from the panel — no separate telnet
> session.
>
> Below it, PSKReporter runs live over MQTT — not the old five-minute
> polling. Who's hearing you, who you're hearing — and MySpots lights up
> the moment your call hits the cluster.

---

## Slide 7 — OHC Cluster: our own node

> Now — about where those spots come from. This shipped this week, and
> it's my favorite story in the deck.
>
> OpenHamClock now runs its own DX cluster node. The hosted site used to
> connect to public DXSpider nodes, like everybody else — and when an
> upstream node had a bad day, we had a bad day. Reconnect storms, login
> problems, the works. At one point a node sysop suggested — maybe with
> some exasperation — that we should go build our own cluster.
>
> _[Beat.]_
>
> OK. Done.
>
> OHC Cluster ingests the Reverse Beacon Network skimmer feeds — CW and
> RTTY on one pipe, FT8 and FT4 on another — plus human spots. And it
> serves a classic telnet interface, which means you don't need
> OpenHamClock to use it. You can point your regular logging program at
> it like any other node.
>
> And one touch I like: the telnet login banner is dedicated to the
> memory of Elwood, WB0OEW.

---

## Slide 8 — Chasing tools

> Two smaller things, new this month, that map straight onto DXer
> reflexes.
>
> First, the callsign info popup. You know the reflex — a call you don't
> recognize hits the cluster, and you open QRZ in another tab to see who
> it is. Now you just click the call, right in the cluster or on the map,
> and you get an inline card: name, QTH, grid, country — and my favorite
> part, the local time at his end. Because half of deciding whether to
> sit in a pileup is knowing whether the operator is about to go to bed.
> One more click gets you the full QRZ or HamQTH page if you want it.
>
> Second, the DX target now takes a callsign directly. Type a call, and
> the crosshair, bearing, and distance snap to his QTH. And DX local time
> uses real timezones now instead of longitude math — which sounds
> pedantic until you look up somewhere like Manila or Perth, where sun
> time and civil time disagree by a lot.

---

## Slide 9 — Propagation + VOACAP

> Propagation. Most propagation tools you've used are effectively
> screenshots. OpenHamClock runs the ITU-R P.533 engine — the same
> physics VOACAP is built on — itself, every ten minutes. The colored
> band overlay on the map is a fresh prediction for your QTH, right now.
> Real-time indices as gauges, solar imagery, X-ray flux so you can see
> the flare before the band drops out.
>
> Two fixes this month are worth calling out. First: if you've ever
> looked at an FT8 prediction anywhere and thought "that band is NOT
> closed, I'm watching people work Japan on it" — you were right. Most
> tools run the engine at SSB thresholds and bolt an FT8 bonus on
> afterwards. And a bonus can't reopen a band the engine already scored
> at zero — which is exactly where FT8 earns its keep. OpenHamClock now
> runs the engine at each mode's real decode threshold — FT8 at minus
> nineteen dB, WSPR at minus twenty-six, CW at plus five. Real example:
> Atlanta to Tokyo, 15 meters, noon — zero percent on SSB, sixty-seven
> percent on FT8. That matches what you actually hear.
>
> Second: the Kp index now follows NOAA's one-minute estimate instead of
> the three-hourly product. So when a geomagnetic storm hits, the console
> reacts in minutes — and when the bands go weird, you know why right
> away.

---

## Slide 10 — POTA / SOTA / WWFF / WWBOTA

> Between openings, the same map covers the portable world — POTA, SOTA,
> WWFF, and WWBOTA, each with its own marker. Click an activator and you
> get the reference, the callsign, frequency, mode, and when they were
> spotted. Same filters, same click-to-tune as the DX cluster. And a rare
> park or flora-and-fauna entity counts for the chase too.
>
> WWBOTA is the newest one — bunkers on the air. Old military and civil
> defense relics. Yes, that's a real program, and yes, it's growing fast.
> Anyone here activated a bunker yet? Put it in the chat.
>
> You can also set audio alerts on a band you're watching — so you can be
> in the kitchen and still know when someone shows up on 17 meters.

---

## Slide 11 — Satellites

> Satellites live on the same map as everything else. Live SGP4 tracking,
> pass predictions for your QTH sorted by next AOS, footprint and ground
> track drawn right on the map. And grids on the birds are real DX.
>
> Pick anything from the active catalog — AO-91, SO-50, the ISS, RS-44,
> FO-29, or the QO-100 geostationary footprint — and overlay several at
> once, right next to your DX spots.
>
> Behind the scenes, the TLE pipeline now pulls from three independent
> sources — CelesTrak, AMSAT, and SatNOGS — so the birds don't vanish
> when one upstream has a bad day.

---

## Slide 12 — Rig control + WSJT-X + N3FJP

> Rig control. Click a spot, your radio tunes — and in a pileup race,
> that's the difference. The spot appears, you click it, and you're on
> frequency with the right mode while the other guy is still spinning his
> VFO.
>
> Under the hood there's a plugin layer called the Rig Bridge. It talks
> to almost any modern radio over almost any transport — direct USB CAT
> with no hamlib, rigctld if you already run it, flrig, SmartSDR for the
> Flexes, TCI, even RTL-SDR for receive-only.
>
> It goes the other way too. WSJT-X, JTDX, MSHV, and JS8Call stream their
> decodes onto the map in real time — so you can watch an opening build
> toward the entity you need before you ever transmit.
>
> And new this month: if you log with N3FJP, that's built in now.
> Configure it from Settings, and your logged QSOs appear on the map. It
> even plots the call you're currently typing in the entry window as a
> live preview — so you see the path before you commit the QSO.

---

## Slide 13 — What else since spring

> A quick sampler of everything else that's shipped since spring — ten
> seconds each. A live aircraft layer, and a worldwide ATC sectors
> overlay — fun for matching what you hear on HF to who owns the
> airspace. Map style rotation for wall displays, and a magnitude filter
> on the earthquake layer. Sixteen languages now — Simplified Chinese
> just joined. A full screen-reader accessibility pass, including a text
> view of the entire map. The Windows install got overhauled — one line
> of PowerShell that actually works. And self-hosters now get the real
> propagation engine in local builds.
>
> The reason I show this slide: this project ships a release every month,
> and the two headline fixes in July — the FT8 predictions and the
> real-time Kp — both started as users emailing "this looks wrong." If
> you find something wrong, tell us. It'll probably be fixed in the next
> drop.

---

## Slide 14 — LIVE DEMO

> OK — enough slides. Let's go look at the real thing. If you want to
> follow along, it's openhamclock.com, live right now.

_[Switch to the pre-warmed tab — same browser window, next tab over.]_

> Here's the map. This line is the day/night terminator, updating live —
> there's your gray line.

_[Click a DX cluster spot on another continent.]_

> I'll click this spot — and there's the great-circle path, with distance
> and bearing.

_[Click the callsign in the popup.]_

> Click the call itself, and there's the new info popup — name, country,
> grid, and his local time. He's awake. Worth calling.

_[Open the DX cluster filters; toggle "Show only DXpeditions."]_

> Here's the "show only DXpeditions" toggle — it cross-references the
> DXpedition calendar, so whatever's left is just the expeditions. And if
> the list is short right now — or even empty — that's honest data: it
> means nobody's spotted an expedition in the last hour. They're rare
> catches by definition. When one pops up, this is where you'll see it.

_[Point at the spot button — do not send.]_

> This button sends a spot straight to the cluster from here. I won't
> send one tonight.

_[Open the PSKReporter pane.]_

> The PSKReporter pane — MySpots, who's hearing me, who I'm hearing. Live
> over MQTT.

_[Open the Propagation panel; flip mode SSB → FT8.]_

> Now watch the propagation panel when I flip from SSB to FT8. Same path,
> same hour — honest FT8 physics. Look at the bands reopen.

_[Open the Space Weather pane; toggle Aurora overlay if K is elevated.]_

> And real-time Kp, here — this updates by the minute now, not every
> three hours.

_[Switch back to the deck tab.]_

> I could click around in this for an hour, but let me come back to the
> deck so you don't leave without the URLs.

---

## Slide 15 — Built to be hacked

> A little about what's under the hood. It's MIT licensed. Seventeen rig
> plugins. Sixteen languages. Six-plus map overlays. More than fifty
> contributors — and the project is about five months old. That velocity
> is the point.
>
> Map overlays are React hooks — if you write JavaScript, you can copy a
> built-in, edit it, restart, and yours shows up in the layer toggle. And
> there's an AddOns folder for community userscripts — APRS
> auto-position, calculators, news feeds.

---

## Slide 16 — Install options

> How do you get it? Four ways, in order of patience.
>
> Zero install: go to openhamclock.com. The wizard asks for your callsign
> and grid, and you're operating in thirty seconds.
>
> Raspberry Pi kiosk: one curl command, and the Pi reboots into a
> fullscreen wall display. It's happy even on a Pi 3.
>
> Local install: clone the repo, npm ci, npm start, open localhost 3000.
>
> And Docker, if you want it isolated on your home server.
>
> Windows folks — the install experience was overhauled this month. One
> line of PowerShell and a real updater. If a previous attempt fought
> you, it's worth a retry.
>
> One more thing: if you self-host, all the API calls proxy through your
> own backend. Nothing about your operating goes anywhere you don't
> control.

---

## Slide 17 — Get involved

> If you take one thing from tonight, take this: try it. openhamclock dot
> com, no install, thirty seconds.
>
> If you find a bug, or there's a feature you want — file a GitHub issue.
> Negative feedback is worth more than silence, and I showed you two July
> headliners that started as user emails. The Facebook group
> "OpenHamClock" is the most active community channel, and there's
> r/OpenHamClock on Reddit. If you write code, pull requests go against
> the Staging branch.
>
> I'm dropping both links in the Zoom chat right now.

_[Paste openhamclock.com and github.com/accius/openhamclock into the
chat.]_

---

## Slide 18 — Thank you + Q&A

> Thanks again to the South Florida DX Association for having me tonight.
> This project exists because fifty-some people decided to send pull
> requests to a brand-new repo — and because users keep telling us what's
> wrong.
>
> I'm Chris, K0CJH — my contact is on the screen. What questions do you
> have?

_[Watch the chat as well as raised hands — half the questions arrive in
text.]_

### Q&A — scripted answers

> **"Which cluster node does the hosted site use?"**
> Our own now — OHC Cluster, new this month. It aggregates the RBN
> skimmer feeds plus human spots, and it serves classic telnet, so any
> logger can connect to it. Self-hosters can point at any node they like.

> **"Are the FT8 predictions really running different physics per mode?"**
> Yes — the P.533 engine runs at each mode's decode threshold: FT8 at
> minus 19 dB, FT4 minus 15, WSPR minus 26, JT65 minus 23, CW plus 5. It's
> not a fudge factor applied after the fact. SSB predictions are
> unchanged.

> **"Does it do LoTW / Club Log / logbook integration?"**
> Not yet — N3FJP is the first logger integration, new this month. File
> an issue for the one you use; logbook integration is on the roadmap.

> **"Does it work offline?"**
> Mostly no. Some panes do — the clock, satellite pass predictions. The
> propagation panel, cluster, and PSKReporter all need internet.

> **"Will it run on my old Pi 3?"**
> Yes. Kiosk mode is happy on a Pi 3. A Pi 4 with two gigs or more is
> more comfortable.

> **"How is it different from HamClock?"**
> Modern web stack — React and Node — instead of native C++. A plugin
> system from day one. An active contributor community. Same spiritual
> goal; it's not a fork, it's a homage.

> **"Who funds this?"**
> Nobody. It's open source, no funder. Hosting at openhamclock.com is out
> of my pocket. Donations are welcome but not required — and if you want
> zero dependence on the cloud instance, self-host. That's the whole
> point.

> **"Is my data private?"**
> Self-host for zero external dependencies. Otherwise, only public APIs
> see your callsign — the DX cluster and PSKReporter, both of which
> already get it if you operate at all.

> **"Can I run it on a tablet?"**
> Yes. The layout is responsive. An iPad on the bench works well. A phone
> is usable but cramped.

> **"Does it support my specific radio?"**
> If it speaks Hamlib, yes — through the rigctld plugin. If it has a
> Yaesu, Kenwood, or Icom CAT protocol, probably also yes over direct
> USB. If it's something unusual, open an issue and we'll figure it out.

> **"What about contests?"**
> There's a contest calendar built in, and the cluster gained a contest
> filter this month. Active contest logging — dupes, exchanges — is out
> of scope. N1MM does that better.

> **"How does it handle weak-signal modes — JT9, FST4, MFSK?"**
> Anything WSJT-X, JTDX, or MSHV decodes flows through the relay and
> shows up on the map.

> **"I'm not a coder — how can I help?"**
> File good bug reports — the July headliners were user emails. Suggest
> features. Translate strings — sixteen languages today, more welcome.
> Or make a video showing how you use it.

---

## Before the call — checklist

- [ ] Open `index.html`; verify the title slide renders.
- [ ] Press `S`; put the speaker view on the monitor you are NOT sharing.
- [ ] Open openhamclock.com in a **second tab of the same browser
      window**; set callsign + grid; click around once to warm it.
- [ ] Only two tabs in that window — deck and live site.
- [ ] Walk the slide-14 demo path once; time it.
- [ ] Browser zoom 100%; bookmarks bar hidden; URL autocomplete cleared.
- [ ] Notifications off (Focus / Do Not Disturb).
- [ ] Zoom: share the **browser window**, not the desktop; confirm the
      speaker-view window doesn't leak in a solo test meeting.
- [ ] Links ready to paste into chat at slide 17.
- [ ] Wired internet if available; laptop plugged in; mic and camera
      check.
