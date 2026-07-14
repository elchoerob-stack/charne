# Gap King — Rugby Positioning Academy

A phone-first rugby positioning trainer. You pick a position, drag your marker to where you think you should stand for that moment in the game, then tap **Play It Out** — the game simulates the phase and shows you whether you created a gap (attack) or closed one (defence), with a coach's note explaining why.

Built as a single self-contained HTML file — no build step, no install, no server required. It works fully offline once loaded.

## Install it as an app

The game is live at:

**https://elchoerob-stack.github.io/charne/rugby-positioning-game/**

It's a full PWA — open that link on a phone and install it:

- **Android (Chrome):** open the link → tap the ⋮ menu → **Add to Home screen** / **Install app**.
- **iPhone (Safari):** open the link → tap the Share button → **Add to Home Screen**.

It installs with its own Gap King icon, launches full-screen with no browser bars, and **works offline** after the first load — practice on the bus, no data needed. Progress, saved plays, the player name and language choice all live on the device.

Updates deploy automatically: any push that touches `rugby-positioning-game/` on the game branch is synced to the Pages branch by `.github/workflows/pages.yml`, and the installed app picks the new version up in the background next time it's opened with a connection.

Local testing on a laptop: `cd rugby-positioning-game && python3 -m http.server 8000`, then visit `http://localhost:8000`.

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

## Season — the career mode

**Season** is the headline mode: a career of eight matches against a rising ladder of fictional South African schools and clubs (Riverside High up to the Junior Springboks), each opponent tougher than the last. It plays like a sports-game career:

- Each match is **best of 3 phases**. In each phase you get a fresh rugby picture (scrum/ruck/lineout, attack or defence, somewhere on the field), you position, and you play it out. Win 2 phases to win the match.
- You carry an **OVR rating** (EA-style overall) shown on a player card. Beating stronger sides pushes it up; losses nudge it down. Climb from "Prospect" to "World Class".
- **Difficulty scales for real** — tougher opponents defend with faster line speed and blitz far more often, so the same positioning that beat Riverside High gets swallowed by Grey College. That is the lesson: the better the defence, the sharper your reads and depth have to be.
- Each phase is **one genuine attempt** (decisions carry weight), with a **Replay** button to re-watch how it unfolded before you commit and continue.
- Pick your specialist position on the player card; career progress and rating persist on the device.

## Live opposition — the defence reads you back

The biggest realism upgrade: **the opposition moves while you position, before the ball is played.**

- When you attack, the AI defence **drifts and re-marks in real time** as you shift your line — sliding across to match up man-for-man, holding its spacing, the fullback covering the danger side. You **cannot** manufacture an overlap just by standing wide against a well-drilled drift; you need a genuine extra man (the fullback into the line, or a mismatch), exactly as in the real game.
- When you defend, the AI attack **probes your thinnest channel**.
- A live **tactical read-out** names the picture as you move: it rings the **spare man out wide** when you've genuinely made an overlap, or the **unmarked attacker / gap in your line** when you're defending — teaching the eye what to look for. What you see while positioning is exactly what feeds the phase when you play it out.

## Free Play — build your own scenario

Beyond the 16 set levels, **Free Play** puts a realistic, full-size rugby pitch (100m try-line to try-line, 22s, halfway, 10m lines, 5m/15m marks, goal posts — the works) in front of you and lets you tap anywhere on it.

1. Tap a spot on the field.
2. Pick what's happening there: **Scrum, Lineout, Ruck, or Penalty Tap.**
3. Pick whose ball it is, and which of the full 15 positions you're playing — any back or any forward.
4. The game builds a realistic attack/defence picture **for that exact spot on the field** — pinned in your own 5m, it's cramped and the defence can blitz; on their try line, the defence is stacked and desperate; near touch, width is tight; off a penalty tap, the defence starts illegally close until you notice they have to retreat 10m.

From there the phase **plays out like real rugby**:

- **The ball goes through the hands.** The 9 clears it from the base and each carrier decides in the moment — take the gap if it's open, or ship it on to the next player out wide. A good shape sends the ball all the way to the wing; a bad one dies two passes in. A live commentary bar calls the play as it happens ("10 ships it to 12... HE'S THROUGH THE GAP!").
- **Every one of your players is movable.** Drag any gold player individually to place him exactly where you want — you're designing the whole play, not just your own position. The **Drag** chip additionally cycles three modes for how the team responds when you move *your own* player: **Me** (solo), **Team** (nearby players drift to hold the shape), and **Line** (the complete backline translates with you). Individually placed players keep their spots through all of it. Park a defender ahead of the offside line, though, and the whistle names him: the penalty is called on the player you misplaced.
- **Call the play: run it or kick it.** On attack, the **Call** chip picks Run, **Grubber** (poked into the space behind the line), **Box Kick** (up-and-under from the 9), or **Cross Kick** (floated wide to the wing). Kicks obey the onside law — only players behind the kicker may chase — so where you set your chasers *before* the kick decides whether you regather or hand it straight back ("KICK COVERED"). Defending, the AI attack kicks too, especially when pinned in its own 22 — suddenly the fullback's depth is a real decision every phase. Saved plays remember their call, so a named play can *be* a kick play.
- **Rucks look like real rucks.** Only 2–4 forwards commit at the breakdown; the rest hold in pods off 9 and 10 or fold into the defensive line — different every time you tap.
- **The fullback matters.** On attack he sometimes injects into the line as the extra man (and if you *are* the 15, choosing between joining the line and sweeping behind is the whole lesson). On defense he sweeps the backfield and runs down line breaks.
- **Real laws apply.** A defender who hasn't retreated behind the offside line (back of the ruck/scrum, 10m at a lineout for the backs, the full 10m on a penalty tap) concedes an immediate **Penalty** before the ball even moves.

Outcomes are graded like a real phase: **TRY** (with a celebration), **LINE BREAK**, **GOOD GAIN**, **TACKLED**, or **INTO TOUCH**, with metres gained and pass count shown, and a coach's note built from what actually happened — including whether the ball ever reached *you*.

**The defence thinks too.** Every phase the defence randomly picks a look — a rushing **blitz**, a sliding **drift**, or a balanced press — announced in the commentary, and the coach's note ties the lesson to it ("against a blitz you need extra depth and quicker hands"). The attack reads numbers as well: if your line loads the blind side and the count favours it, the play switches blind. Overlaps are detected and reported ("you had the extra man — the ball died before it got to him").

Free Play scenarios aren't part of the star/progress system — they're open-ended practice with a fresh picture every tap.

## My Plays — save and practise your own plays

Set up any Free Play scenario, shape your line exactly how you want it (Line drag mode makes this easy), then tap **💾** and give the play a name — "Deep Strike", "Blitz Beater", whatever sticks. Saved plays live in **My Plays** on the home screen. Opening one restores the exact team shape and scenario; every run plays out against a freshly chosen defensive look, so practising the same play teaches *when* it works, not just *that* it works. Plays are stored on the device.

## Make it yours

- **Player name**: set it once from the home screen and your player carries it above their head on the pitch — and the commentary calls your name when you touch the ball or make the tackle.
- **Afrikaans**: one tap on the home screen switches the whole game — menus, briefs, coach feedback, commentary ("HY'S DEUR DIE GAPING!... DRIE!"), the glossary, and all 16 Academy levels — between English and Afrikaans. The choice is remembered.
- **Players look like players**: little jerseyed figures with heads, swinging arms while they run, and their number on the back — gold for your team, red for the opposition.

For Scrum and Lineout the full bound pack (1–8) is on the pitch for both teams, shown as smaller tokens so the backline reads clearly. Penalty taps carry no set pack, since the forwards are realistically still arriving. Any of the 15 positions is playable, forwards included.

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
