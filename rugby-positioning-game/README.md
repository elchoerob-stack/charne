# Gap King — Rugby Positioning Academy

A phone-first rugby positioning trainer. You pick a position, drag your marker to where you think you should stand for that moment in the game, then tap **Play It Out** — the game simulates the phase and shows you whether you created a gap (attack) or closed one (defence), with a coach's note explaining why.

Built as a single self-contained HTML file — no build step, no install, no server required. It works fully offline once loaded.

## How to play it on a phone

Pick whichever is easiest:

1. **GitHub Pages (best for a real "app" feel):** enable Pages on this repo (Settings → Pages → deploy from branch → root), then open `https://<your-username>.github.io/<repo>/rugby-positioning-game/` on the phone. On iOS Safari or Android Chrome, use "Add to Home Screen" — it launches full-screen like a real app.
2. **Quick share:** open `rugby-positioning-game/index.html` directly from any static file host (Netlify Drop, a gist raw link via an HTML viewer, etc).
3. **Local testing on a laptop:** `cd rugby-positioning-game && python3 -m http.server 8000`, then visit `http://localhost:8000` (or your machine's LAN IP from the phone, same Wi-Fi).

## The concept

Every level freezes a real rugby moment — first phase off a scrum, a 2-on-1 out wide, a scrambling defence after a turnover — and asks one question: **where do you stand?**

- Drag the gold **YOU** marker anywhere on the pitch.
- Toggle **Space Map** to see a live territory overlay (gold = space your team controls, red = space the defence controls) that updates as you drag — this is the actual teaching tool. It makes the abstract idea of "creating space" and "closing gaps" visible in real time.
- Tap **Play It Out**. The ball-carrier runs at the biggest gap it can find, defenders react and close in, and the phase resolves as a TRY, LINE BREAK, or TACKLE depending on where everyone (including you) started.
- You're scored 1–3 stars purely on your starting position against the coaching principle for that level, plus a plain-English coach's note explaining what you got right or wrong.

## Progression

16 levels across four bands, structured to grow with a player from early high school to matric:

| Band | Grade / Age | Focus |
|---|---|---|
| 1. Schoolboy Rookie | Grade 8–9 · 13–14 | Depth, alignment, straight running |
| 2. Club Player | Grade 10 · 15 | Width, overlaps, drift defence |
| 3. Provincial Trialist | Grade 11 · 16 | Line speed, decoy runners, broken field |
| 4. Matric Test Level | Grade 12 · 17–18 | Full-field reads, adapting the textbook picture to what the defence is actually doing |

Each level is either an **attack** scenario (how do you create space?) or a **defence** scenario (how do you close it down?). A level unlocks the next once you earn at least one star; a band unlocks once every level in the previous band has been passed.

Progress (stars, unlocked bands) is saved in the browser's local storage on the device, so it persists between sessions on the same phone.

## Free Play — build your own scenario

Beyond the 16 set levels, **Free Play** puts a realistic, full-size rugby pitch (100m try-line to try-line, 22s, halfway, 10m lines, 5m/15m marks, goal posts — the works) in front of you and lets you tap anywhere on it.

1. Tap a spot on the field.
2. Pick what's happening there: **Scrum, Lineout, Ruck, or Penalty Tap.**
3. Pick whose ball it is, and which position you're playing.
4. The game builds a realistic attack/defence picture **for that exact spot on the field** — pinned in your own 5m, it's cramped and the defence can blitz; on their try line, the defence is stacked and desperate; near touch, width is tight; off a penalty tap, the defence starts illegally close until you notice they have to retreat 10m.

From there it's the same drag-and-simulate loop as the Academy, plus one extra, very real rule: if you're defending and you haven't retreated behind the offside line (the back of the ruck/scrum, or the full 10m on a penalty tap) before you hit **Play It Out**, the whistle blows immediately — **Penalty Conceded** — before the phase even runs. It's an easy, memorable way to feel out why the offside line matters, not just read about it.

Free Play scenarios aren't part of the star/progress system — they're for open-ended practice, so there's no "right answer" saved anywhere, just the outcome and a coach's note built from the actual numbers of that attempt (your depth off the ball, the gap at the moment of contact, distance to touch).

## Coach's Corner

An in-app glossary (accessible from the home screen and mid-level via the "Coach Tip" button) explains the rugby vocabulary in plain language: gain line, depth, alignment, width, overlap, drift defence, blitz defence, decoy runner, support line, sweeper, second phase, line speed, go-forward, cutting angle.

## How the simulation works (for the curious)

It's a deliberately simple, readable model, not a physics engine:

- The pitch is a coordinate grid. Space is scored by comparing, at each point, which team has a player closer to it — the same idea broadcasters use for tactical overlays.
- The ball-carrier picks the biggest reachable pocket of space in front of them and runs straight at it.
- Defenders either mark a nearby non-carrier attacker (holding them in place — this is what makes decoy running work) or sprint to intercept the carrier's line.
- The outcome comes entirely from where everyone started, which is the whole point: **the decision that matters happens before the whistle, not during the sprint.**

## Editing / extending

Everything — all 16 levels, the glossary, the simulation engine, and the UI — lives in `index.html`. Levels are defined as plain data objects in the `LEVELS` array near the top of the `<script>` block, so adding a new scenario just means adding a new object with pitch coordinates, an optimal zone, and coaching feedback strings.
