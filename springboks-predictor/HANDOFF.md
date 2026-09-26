# Handover: splitting the Springboks Tour Predictor from the Bok family predictor

## Status (26 Sep 2026)
- DONE step 3: Firebase project `springboks-predictor` created (Firestore,
  africa-south1), rules published and tested (reads OK, picks/results OK,
  delete/create-untagged/fixture edits denied).
- DONE step 4: 7 office games copied and verified ALL MATCH; the live app at
  /charne/tour/ now uses the new project. Anyone who had the page open before
  the switch may still write a pick to the OLD project until they reload —
  re-run `migrate.py verify` and reconcile any missing picks before step 6.
- TODO: steps 1-2 (Jacques creates the repo; push this folder; enable Pages),
  step 5 (forward /charne/tour/), step 6 (clean old DB), step 7.

For Claude (or Jacques) continuing on another machine. Written 25 Sep 2026.

## Why
The CMS office predictor and the Bok family predictor shared a web address
(`elchoerob-stack.github.io/charne/` and `/charne/tour/`), one open Firestore
project (`sa-predictions`) and one repo branch. Colleagues could reach the
family app and its data. Jacques chose a **full split**, new name
**springboks-predictor**.

## Where things are
- **Live today (unchanged):** https://elchoerob-stack.github.io/charne/tour/ —
  served from repo `elchoerob-stack/charne`, branch
  `claude/sa-score-prediction-app-eia010`, folder `tour/`.
- **This folder** (`springboks-predictor/` on branch
  `claude/cms-prediction-app-recall-1rgfm1` of `charne`) is the standalone app,
  ready to become the root of the new repo. Identical to `tour/` except the
  link-preview URLs point at the new address. It still uses the OLD database
  until step 4.
- Office games live in `sa-predictions` as `matches/*` docs tagged `app:"cms"`:
  `cms-test2/3/4` (played, with picks) and `cms-aus/ita/fra/ire` (open).

## Steps
1. **Jacques:** create public repo `elchoerob-stack/springboks-predictor`
   (no README). Claude's GitHub integration cannot create repos.
2. **Push:** copy this folder's contents to the new repo's root (include
   `.nojekyll`), push to `main`. Then Jacques: repo Settings → Pages →
   Deploy from branch → `main` / root. Check
   https://elchoerob-stack.github.io/springboks-predictor/ loads.
3. **Jacques:** Firebase console → new project `springboks-predictor`
   (Analytics off) → Firestore in `africa-south1`, production mode → Rules:
   paste `firestore.rules` → Publish → Project settings → add Web app → copy
   the `firebaseConfig`.
4. **Migrate (do it in one sitting, picks keep flowing into the old DB until
   the switch):**
   - `python migrate.py copy <projectId> <apiKey>` then
     `python migrate.py verify <projectId> <apiKey>` — must print ALL MATCH.
   - In the new repo's `index.html`, replace the `initializeApp({...})` config
     with the new one, and update the comment above it (it says "Same Firebase
     project as the family predictor" — no longer true; also drop the
     `app:"cms"` filter comment if simplifying).
   - Run `verify` once more right before pushing, push, confirm the live app
     shows the log (Willem 27, Jacques 19 as of 25 Sep) and the 4 open games.
5. **Forward the old link:** in `charne`, branch
   `claude/sa-score-prediction-app-eia010`, replace `tour/index.html` with a
   small page that redirects to the new address (meta refresh +
   `location.replace`), and make `tour/sw.js` unregister itself so installed
   phones stop serving the cached old app.
6. **Clean the family DB (only after 4 and 5 are live and verified):** delete
   the `cms-*` docs from `sa-predictions`. The family app's code that skips
   `app:"cms"` docs can then go too.
7. Tell colleagues the new link. The Share button already uses whatever
   address the page is on.

## Things to know
- Perth (Australia v SA) kicks off **Sun 27 Sep 11:45 SAST**; picks lock then.
  Avoid switching databases in the hour before kick-off.
- Two reminders fire into the ORIGINAL cloud session, not a laptop session:
  3 Nov (refresh wi's guides for Italy/France/Ireland) and 22 Nov (add the
  Nations Championship Finals Weekend game). After the split, those updates
  go to the new repo/project — check the handover there.
- Organiser PIN for entering results is in `index.html` (`var PIN`).
- The sandbox that built this couldn't load gstatic.com (Firebase SDK) or
  github.io; tests used a stubbed Firebase module fed with a snapshot of the
  live data.
