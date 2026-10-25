# Agent Momentum

A private, phone-first weekly sales rhythm app for Charné (Brand Real Estate, Pretoria East),
built from *Agent Momentum — Build brief v1.0*.

**Plan on Sunday → log during the week → review on Friday → learn from the trends.**
Everything is stored on the phone (IndexedDB). No login, no server, no client names.

## Using it

| Screen | What it's for |
| --- | --- |
| **Today** | Five progress rings. **Tap a ring to log one** (with Undo); **press and hold** to add details. Shows today's suggested number for each target, your streak, and next steps due today (swipe → done, ← next work day, or use the buttons). Prompts appear here when it's time to plan, review, close last week or back up. |
| **+ button** | Log anything in two taps. The entry is saved the moment you pick the type; outcome, price, band, area, reference and note are optional and save as you go. "When" lets you log something from yesterday. |
| **Week** | Focus area and band, a day-by-day done/planned grid, top 3 deals with a one-tap stage bar (moving to *Offer* or *Accepted* logs the offer for you), stalled listings and qualified buyers. |
| **Planner** | Five short steps, with everything pre-filled so "Next" × 4 works: focus → targets → 5 buyers (copy last week's) → top 3 deals → stalled listings. |
| **Review** | Live during the week; on Friday from 15:00 it asks for a reason and fix for each miss. Close the week to lock it and carry unfinished deals forward. Share as an image or save as PDF for Monday's meeting. Browse past weeks with the arrows. |
| **Insights** | Built around three questions: *Am I improving?*, *Where does my funnel leak?*, *Where do my deals come from?* Plus habits, personal bests and up to two coaching cards (after 2 closed weeks). |
| **Settings** (gear on Today) | Usual targets, work days (add Saturday for show days), bands and areas, reminder times + calendar export, theme, PIN, backup/restore, CSV export, sample data, clear all data. |

Want to see it full of data first? Choose **Explore with sample data first** on the welcome
screen (or Settings → Sample data). Sample records are flagged and removed in one tap; anything
logged for real is never removed with them.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # metric, coaching and data-layer unit tests (Vitest)
npm run test:e2e     # Playwright: plan → log → review smoke test
npm run build        # production PWA in dist/
npm run build:single # one self-contained HTML preview in dist-single/
npm run icons        # re-render PNG icons from public/icon.svg
```

Layout, as the brief's handover note asks:

- `src/config.ts` — default targets, bands/areas, activity types, every coaching threshold.
- `src/lib/metrics.ts` — all numbers (pure functions, `tests/metrics.test.ts`).
- `src/lib/coaching.ts` — the 8 coaching rules (pure, one test per rule in `tests/coaching.test.ts`).
- `src/lib/db.ts` — Dexie schema, versioned. Add a new `db.version(n)` for changes; never edit a shipped one.
- `src/lib/repo.ts` — every write (logging, stage moves, closing a week and carry-over).

Every record has a UUID, `createdAt`, `updatedAt` and soft-delete `deletedAt`, so a sync service can be added later.

## Hosting

The `Agent Momentum` GitHub workflow tests every change and, on `main`, publishes `dist/` to GitHub Pages
(enable Pages → Source: *GitHub Actions* in the repo settings). Any static host works: set `BASE_PATH`
if the app isn't served from the domain root. HTTPS is required for install and offline use.

## Decisions worth knowing

- **Log first, details later.** Choosing a type saves immediately; details are optional. That's what makes 2-tap logging real.
- **Pre-qualified and within-comps rates** count only entries where the question was answered, so quick one-tap logs don't drag the rate down. The Review shows how many were recorded.
- **Offers:** an offer with no outcome counts as *submitted*. Log it again as *accepted* when it lands (or move the deal's stage, which does it for you).
- **Today's suggested number** = what's left of the weekly target ÷ work days left including today.
- **Streak** counts work days with at least one entry; today doesn't break it until it's over, and days off are skipped.
- **Coaching** looks back over the last 4 closed weeks, shows at most 2 cards, and always keeps a seat for a personal-best celebration.
- **Reminders:** a server-less PWA can't push notifications reliably (especially on iPhone), so the app nudges on open and exports an `.ics` with repeating Sunday / weekday / Friday reminders for the phone's calendar.
- **PIN** is a privacy screen (salted SHA-256), not encryption.

## Open questions from the brief

- Does a WhatsApp follow-up count as a meaningful seller conversation? (Hint text in the log sheet can be updated in `config.ts`.)
- Saturday show days — supported: Settings → Work days → Sat.
- Offers capture an optional amount but no commission (that stays in Keystone).
- The name "Agent Momentum" is still a working title.
