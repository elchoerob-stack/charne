# CMS Workshop

A working, end-to-end prototype of the CMS workshop module for franchised
dealerships — the booking diary, the dispatch board, the electronic health
check, quoting, parts, customer authorisation and the handover to Evolve.

It is three separate front doors onto one shared core:

| Surface | File | Who opens it |
|---|---|---|
| **The web version** | `index.html` | Service advisors, foremen, parts, managers, admin |
| **The workshop app** | `workshop.html` | Technicians, on the tablet in the bay |
| **The customer link** | `customer.html#<token>` | The vehicle owner, on their phone |

All three read and write the same data. Approve something on the customer
link and the dispatch board moves while you watch — open the three in
separate tabs or on three devices on the same machine and they stay in step.

## Opening it

No build, no install, no Node. **Double-click `index.html`.** It runs from
the file system, works offline and keeps everything in the browser.

To put it on the network for a demo across a dealership's Wi-Fi, serve the
folder any way you like, for example:

```
npx http-server cms-workshop -p 8080
```

Then `http://<your-ip>:8080` on the laptop and `.../workshop.html` on a
tablet. The customer link is a URL, so it opens on any phone that can reach
the same address.

Demo sign-ins (Setup → People changes them):

| Person | Role | PIN |
|---|---|---|
| Thandi Mokoena | Service advisor | 1111 |
| Sipho Ndlovu | Workshop foreman | 3333 |
| Johan Pretorius | Technician | 4444 |
| Fatima Patel | Parts | 7777 |
| Dean Naidoo | Workshop manager | 8888 |
| Jacques R | Administrator | 9999 |

The demo customer link is `customer.html#demo1234`, code `4417` — a Hilux
on a 90 000 km service with two red and four amber findings waiting for a
decision.

## What each surface does

### The web version — `index.html`

- **Today** — what needs a person right now, in the order it needs them:
  failed Evolve posts, approvals ageing past ninety minutes, parts
  backorders, part-finished health checks, vehicles ready but not collected.
- **Diary** — slot by slot, with the load against the day's sellable hours.
- **Dispatch board** — technicians or bays down the columns, time down the
  side, drag to re-allocate. Wall-screen mode goes full screen for the
  workshop wall.
- **New booking** — the five-step wizard: Customer → Vehicle → Work
  requested → Slot & advisor → Confirm. Drafts save on every step and can be
  resumed. Next only comes alive when the step's mandatory fields are good,
  and the reason appears under the field once you leave it.
- **Job cards** — one drawer with everything on it: what was asked for,
  the quote, the health check, the authorisation and its send log, parts,
  the Evolve posting log with retry, and the full history.
- **Health checks** — every check in the workshop, progress, findings and
  what has been quoted off them.
- **Authorisations** — what is waiting on a customer, how long it has been
  waiting, and what has been decided.
- **Parts** — requests from the bays, issue or backorder, and the price file
  with cost, markup, sell and supersession.
- **Customers** — history, vehicles and POPIA consent per channel.
- **Reports** — invoiced value, average RO, health-check completion, upsell
  conversion, workshop efficiency, and the same by advisor and technician.
- **Setup** — everything below.

### The workshop app — `workshop.html`

PIN in, and then one job at a time. Clock on and off, work through the
health check group by group with big red/amber/green targets, type a
measurement and the item colours itself, photograph what you found, ask
parts for something, and hand the vehicle back as complete, waiting on
parts, or needing approval.

Photos are scaled down before they are stored, which is the difference
between an upload that works on workshop Wi-Fi and a 413.

### The customer link — `customer.html#<token>`

One page, no login, no app. A one-time code confirms who they are, then
they see where their vehicle is, what was found, why it matters, what each
item costs including VAT, and the technician's photographs. They approve or
decline **item by item**, sign with a finger, and the workshop knows
immediately. The health check is there in full, green items included —
which is what makes the red ones believable.

When messaging is down, the advisor records a telephone authorisation
instead, and the call stands in place of the signature on the job card.

## How it is customised

Every difference between one dealership and the next lives in Setup, and
nothing is hard-coded anywhere else:

- **Dealership and branding** — details, and the dealership's own logo on
  the customer link while the staff apps stay CMS-branded.
- **Diary** — opening days and hours, slot length, capacity per slot and
  per day.
- **Rates and pricing** — VAT, as many labour rates as the franchise has, a
  parts markup matrix by cost band, sundries and the cap.
- **People and roles** — who exists, and for each role which screens they
  see, in which order, and what they may do.
- **Words we use** — "Job card" or "Repair order", "Technician" or "Tech".
  Change it once and it changes on all three surfaces.
- **Statuses** — rename, recolour, reorder or remove. The board columns, the
  customer's progress tracker and the reports all follow the list.
- **Health checks** — templates, groups, items, measurements with their
  amber and red thresholds, and whether a photo is compulsory.
- **Menus and parts** — service menus and the price file.
- **Messages** — what the SMS, the WhatsApp and the e-mail actually say.
- **Authorisation** — one-time code, signature, per-item approval, link
  expiry, and the terms above the signature.
- **Integrations** — Evolve and Infomedia settings, plus training switches
  that let you show a dealership a failed post without breaking anything.
- **Data** — export the whole dealership as one JSON file and import it at
  the next rollout; reset the demo; or clear the demo data and keep the
  configuration for a live setup.

Personal preferences sit alongside that and belong to the person, not the
dealership: light or dark, three densities, a colour-blind-safe health-check
palette, which screen they land on, and how they like the board grouped.

## What is real and what stands in

Real, in that it is fully worked through here: the booking rules, the
pricing (cost → markup → VAT), the health check and its thresholds, the
authorisation flow with per-item decisions and the signature, statuses,
roles and permissions, capacity, reporting, and the posting log with retry.

Standing in for a live service, with the same shape so the screens do not
change when it is wired up:

- **Infomedia Superservice** — VIN decode and service menus come from
  `config.menus` rather than the live feed. A VIN that does not decode
  produces an empty menu, which is the real failure mode.
- **Evolve DMS** — posting is simulated, including the common failures
  (debtor on hold, closed period, missing VAT mapping). Retry works the way
  it does in CMS: fix the cause, then retry — never re-invoice.
- **Messaging** — SMS and WhatsApp are written to the send log and walk
  queued → sent → delivered rather than leaving the machine.
- **Storage** — the browser, not a server. Nothing leaves the machine, and
  clearing site data clears it, so export anything worth keeping.

## Checking it still works

`test/checks.mjs` drives a real browser through the flows that matter — sign
in, the booking wizard, the job card's tabs, the dispatch board, every Setup
tab, the technician's health check, and the customer approving and signing —
and fails on any console error. It needs Playwright:

```
npx http-server cms-workshop -p 8899 -s &
node cms-workshop/test/checks.mjs
```

All fifteen checks pass on the current build, with no browser errors.

## Files

```
index.html              the web version
workshop.html           the workshop app
customer.html           the customer link
assets/config.default.js  every dealership-level setting, commented
assets/core.js          the shared rules — pricing, jobs, authorisation, sync
assets/seed.js          the demo dealership
assets/ui.js            shared interface pieces
assets/app-web.js       the web version
assets/app-tech.js      the workshop app
assets/app-customer.js  the customer link
assets/cms.css          the design system, CMS CI 2026
docs/CUSTOMISING.md     setting up a new dealership
docs/DEMO-SCRIPT.md     a ten-minute demo that lands
test/checks.mjs         the end-to-end checks
```

Branding follows the CMS Systems Visual Guide (CI) 2026, ECO ONE edition:
the CMS eco lock-up, Roboto embedded locally, and the core palette with the
supporting greens and ambers used only where a health check genuinely needs
red, amber and green.
