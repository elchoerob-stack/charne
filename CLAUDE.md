# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this project is

A single-file **React** mobile web app: a property-listings / lead-gen app for
**Charné Snyman**, a property sales specialist at **RB Brand Real Estate**
(Pretoria East & surrounds, South Africa). It shows curated listings, lets a
visitor filter/search them, save favourites to a device-local watchlist, and
contact the agent via WhatsApp / phone / email. It includes a **POPIA**
(South Africa's Protection of Personal Information Act) consent gate that must
be accepted before the app is usable.

The entire application lives in one file:

- **`CharneCLient`** — a JSX/React source file. Note the spelling and the
  **missing file extension**; despite having no `.jsx`/`.js` extension, its
  contents are a React component module (`import ... from "react"` at the top,
  `export default function CharneClientApp()` at the bottom).

There is no `package.json`, no build config, no bundler config, no test suite,
and no README in the repo — just this file and (now) this doc. Treat the file
as the single source of truth.

## Runtime & dependencies (important)

This file is **not** a standalone buildable project. It is written to run inside
a host that already provides its dependencies and a storage API. Specifically it
assumes:

- **React** with hooks (`useState`, `useEffect`) — `import { ... } from "react"`.
- **`lucide-react`** for all icons — `import { Heart, Phone, ... } from "lucide-react"`.
- **`window.storage`** — an async key/value store injected by the host
  environment (the pattern used by Claude Artifacts). The code calls:
  - `await window.storage.get(key)` → returns `{ value }` (a stringified JSON payload) or falsy
  - `await window.storage.set(key, stringValue)`
  - `await window.storage.delete(key)`

  All access to it is wrapped in `try/catch` and expects JSON strings. **Do not
  assume `localStorage`, a database, or a network backend** — persistence is
  entirely through `window.storage`, and it is device-local only.

There is no server, no API calls (external links open `rbbrandrealestate.co.za`
listings and `wa.me` / `tel:` / `mailto:` deep links in new tabs), and no
routing library.

## Architecture

Everything is one module, read top-to-bottom in these sections (each separated
by a `// ─── Section ───` comment banner):

1. **`POPIA`** — a plain object acting as the compliance + persistence layer.
   Holds consent metadata (`version`, `controller`, `purposes`, `retention`,
   `rights`) and the only functions that touch `window.storage`:
   - `getConsent()` / `record(granted)` / `revoke()` — consent lifecycle, key `"cs_popia_v1"`
   - `getWatchlist()` / `saveWatchlist(ids)` — watchlist persistence, key `"cs_watchlist_v1"`
   - `revoke()` deletes **both** the consent record and the watchlist.
2. **`C`** — the design-token palette (nav navy `#0F2040`, gold `#C49A2F`,
   backgrounds, text, borders, tag colours). Every colour in the UI should come
   from here, not a hardcoded hex, unless it is a per-property gradient/status.
3. **`PROPERTIES`** — the static array of listing objects (the app's "database").
   Also derived constants `AREAS` and `TYPES` (built from the data), the
   `fmtPrice` helper (formats to `R 1 234 567` via `toLocaleString("en-ZA")`),
   and the `TypeIcon` component (maps a property `type` to a lucide icon).
4. **Screen / presentational components** (all function components, props-driven,
   no internal data fetching):
   - `POPIAGate` — full-screen consent prompt shown when no consent exists.
   - `DeclinedScreen` — shown when consent was explicitly declined.
   - `PropertyCard` — the reusable listing card (used on Home, Properties, Watchlist).
   - `HomeScreen` — agent header, contact buttons, stats band, 3 featured listings, market-insight CTA.
   - `PropertiesScreen` — search + area/type filter chips + price cap, filtered list. Holds its own filter state (`useState`).
   - `PropertyDetail` — full listing view with specs, highlights, and a fixed WhatsApp/Call CTA bar.
   - `WatchlistScreen` — saved properties + a POPIA "withdraw consent & delete data" control.
   - `NavBar` — fixed bottom tab bar (Home / Properties / Watchlist) with a watchlist count badge.
5. **`CharneClientApp`** (default export) — the root. Owns the global state and
   wiring: `loading`, `consent`, `screen`, `selectedProp`, `watchlist`. On mount
   it loads consent + watchlist from `window.storage`. Renders one of: loading
   spinner → `POPIAGate` (no consent) → `DeclinedScreen` (consent declined) →
   the main app (nav + current screen, or `PropertyDetail` when a property is
   selected).

### State & navigation model

- **No router.** "Navigation" is state: `screen` ("home" | "properties" |
  "watchlist") and `selectedProp` (a property object or `null`). If
  `selectedProp` is set, the detail view renders over the tabs; otherwise the
  active `screen` renders with the `NavBar`. `navigateTo(s)` clears
  `selectedProp` and sets `screen`.
- **State lifts to the root.** `watchlist` and `consent` live in
  `CharneClientApp` and flow down as props; child screens are stateless except
  `PropertiesScreen`, which owns only its transient filter inputs.
- **Persistence is a side effect of state changes.** `toggleWatchlist` updates
  React state and then calls `POPIA.saveWatchlist`; `handleConsent` /
  `handleRevoke` do the same for consent. Keep this order (update UI state, then
  persist) and always route persistence through the `POPIA` object.

## Conventions

- **Styling is 100% inline `style={{ ... }}` objects.** There is no CSS file,
  no Tailwind, no styled-components. The only stylesheet is a tiny inline
  `<style>` tag for the `spin` keyframe on the loading spinner. Match this —
  don't introduce a CSS framework or external stylesheet.
- **Colours come from the `C` token object.** Reuse `C.nav`, `C.gold`, etc.
  Exceptions already in the data: each property carries its own `bg` gradient
  and `statusColor`.
- **Icons come from `lucide-react`.** Add any new icon to the single top-of-file
  import list. Don't pull in another icon library.
- **Money is formatted with `fmtPrice`** (South African locale, `R` prefix).
  Don't hand-roll number formatting.
- **Design target is a phone.** The root container is capped at
  `maxWidth: 480` and centred; screens pad the bottom (`paddingBottom: 80–100`)
  to clear the fixed bottom nav / CTA bars. Keep new UI within this mobile frame.
- **Copy is South-African / POPIA-aware.** Locale strings use `"en-ZA"`,
  currency is Rand, and privacy language references POPIA (Act 4 of 2013, as
  amended April 2025). Preserve this tone and the compliance framing.
- **Code style matches the file:** compact single-line JSX where practical,
  section banner comments (`// ─── Name ───`), arrow-function components,
  destructured props. Follow the surrounding density rather than reformatting.

## Adding / changing things

- **A new listing:** add an object to the `PROPERTIES` array. Required-ish
  shape (see existing entries): `id` (unique number), `title`, `area`, `city`,
  `price` (number, ZAR), `type` (one of `"Townhouse" | "House" | "Apartment" |
  "Vacant Land"` — matches `TYPES` and `TypeIcon`), `beds`, `baths`, `garages`
  (numbers; `0` hides the spec), `floor` (m², or `null`), `erf` (m², or `null`),
  `status` + `statusColor` (badge text/colour), `desc`, `highlights` (string
  array), `bg` (CSS gradient string), and `url` (the live listing link).
  `AREAS` is derived automatically from the data; a new `type` value would need
  to be added to `TYPES` and handled in `TypeIcon`.
- **A new screen:** add a presentational component, a `screen` id, a `NavBar`
  tab entry, and a render branch in `CharneClientApp`. Keep new persistence
  behind the `POPIA` object and a `window.storage` key namespaced `cs_*_v1`.
- **Contact details are placeholders.** Phone (`+27000000000` / `27000000000`
  in `wa.me`/`tel:` links) and email (`charne@rbbrand.co.za`) are stand-ins —
  update all occurrences together if wiring real details.
- **Storage schema is versioned in the key** (`cs_popia_v1`, `cs_watchlist_v1`)
  and in `POPIA.version`. If you change a stored payload's shape, bump the key
  version (and handle/clear old data) rather than silently breaking existing
  saved records.

## Building / running / testing

There is currently **no build, run, or test tooling in the repo** — no
`package.json`, scripts, linter, or CI. The `CharneCLient` file is meant to be
dropped into a host that supplies React, `lucide-react`, and `window.storage`
(e.g. an Artifacts-style runtime), which is where it renders. If you add
tooling, add it deliberately and document it here; don't assume any exists.

## Git / workflow

- Active development branch for AI-assisted work: **`claude/claude-md-docs-s0d18x`**
  (default branch is `main`). Develop, commit, and push to the designated
  branch; don't push elsewhere without explicit permission.
- GitHub access is scoped to **`elchoerob-stack/charne`** only.
- Don't open a pull request unless explicitly asked.
