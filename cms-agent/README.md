# Foreman

**Foreman watches you do a job once, learns it, and then does it for you** —
in a browser of its own, in the background, on a schedule if you want, while
you get on with something else.

It is built for the tedious things that come round again and again: the same
form, the same export, the same five-minute job you do forty times a month.
You do it once with the recorder running. Foreman turns that into a task it
can repeat with different data, working out for itself where things have
moved when the site changes underneath it.

Three things make it usable rather than a toy:

- **It is not your browser.** Runs happen in a separate browser with its own
  input. Nothing touches your mouse or keyboard, so it works while you work.
- **It copes with change.** Each step knows seven ways to find its element,
  and when they all fail it works out how to achieve the step's intent
  instead — clearing a banner, opening a tab, finding the renamed field. Then
  it remembers, so the next run is fast again. See `docs/HOW_IT_COPES.md`.
- **The output lands on your machine.** Anything a task downloads or writes is
  saved into a folder you choose, one per task and run.

It also **answers and diagnoses**: describe a problem and it works it through
with you. That side ships knowing a lot about CMS Systems, Evolve DMS and
Infomedia, because that is where most of Jacques' own tedious work lives —
but the automation itself has nothing to do with workshops and works on any
website you sign it into.

## What you get

- **Agent console** (`web/`): chat with streaming answers, a live "Thoughts"
  panel, an activity feed of every tool call, four modes (Quick / Think /
  Deep / Council), dictation, screenshot paste, and a sidebar for integration
  health, recordings, cases, dealer memory and playbooks.
- **Problem-solving engine** (`server/src/problem-solving/`): ten seeded
  playbooks for CMS, Evolve DMS, Infomedia Superservice, OTP/e-signature,
  eVHC tablets, dispatch board, printing, sessions and performance. Ranks
  hypotheses, asks the single most informative question, produces a plan when
  confident and an escalation packet when not, and learns from resolved cases.
- **Tasks** (`server/src/tasks/`): a recording compiled into something
  repeatable — values you typed become named fields, and the job runs in a
  background queue in its own browser. Every step carries several ways to find
  its element, and Claude repairs the ones that break, writing the fix back so
  it sticks. See `docs/TASKS.md`.
- **Workflow recorder** (`recorder-extension/` + `server/src/recorder/`):
  Chrome extension that captures clicks, fields, screens, screenshots,
  console errors and failed requests with POPIA masking; the server compiles
  recordings into markdown SOPs, Playwright replay scripts and evidence for
  the engine.
- **Workshop reports and campaign lists** (`server/src/reports/`): upload a
  CMS workshop bookings export for the Workshop Performance Dashboard (KPIs,
  dealer and advisor tables, close rates, carry-over abuse, weekly trend,
  tracking, insights) or a Marketing Contacts export for a validated,
  deduplicated SMS and e-mail campaign list with a five-sheet workbook and
  CSVs. Both in CMS eco branding, both discussable with the agent.
  See `docs/REPORTS.md`.
- **Case-to-ticket bridge**: one click assembles the escalation packet
  (symptom, hypotheses, recorder evidence, links, dealer facts, timeline,
  still-needed checklist) and sends it via webhook, Jira or e-mail, or opens
  a pre-filled draft.
- **Weekly playbook review** (`/review.html`): edit, promote or archive the
  playbooks learned from resolved cases; promoted ones persist in
  `knowledge/playbooks.custom.json`.
- **Evals** (`server/eval/`): 52-case diagnostic eval (engine level, free)
  and an agent-level eval with a Claude judge.
- **Installable app**: progressive web app for the laptop and the phone
  (`docs/INSTALL.md`), with a service worker for instant open.
- **Agent tools**: knowledge search, recordings and SOPs, recording analysis,
  diagnose, integration health checks, dealer memory, cases, follow-ups, plus
  Claude's server-side code execution and web search in the deeper modes.

## Quick start

**Windows: download `Foreman.exe` from Releases and double-click it.** That is
the whole install. The file carries the entire program inside it, so there is
no Node, no Git, no `npm install` and nothing to type — the first run unpacks
it, generates an access code, fetches the browser it drives and opens the
console. Every run after that takes seconds. See `docs/INSTALL.md`, and
`docs/PACKAGING.md` for how it is built.

Mac/Linux: `bash cms-agent/setup.sh`. Docker: `docker compose up -d` in `cms-agent/`.

From the source, for working on it:

```bash
cd cms-agent/server
cp .env.example .env            # add ANTHROPIC_API_KEY (or use `ant auth login`)
npm install
npm run dev                     # http://localhost:8787
```

Open http://localhost:8787, set a dealer code, and try:

- "Invoice on job card 48812 is not posting to Evolve at Kimberley"
- "Customer says she never got the OTP for the brake authorisation"
- "How do I create a booking with an OEM menu?" (after uploading a recording)
- "Build the workshop report and tell me who to worry about" (after uploading an export)
- "How many of these contacts can we actually reach?" (after uploading a contacts export)

To exercise the diagnostic engine and recordings without API credentials:

```bash
npm test                         # engine, SOP and report unit tests
curl -X POST localhost:8787/api/recordings -H 'content-type: application/json' \
     --data @test/fixtures/sample-recording.json
curl localhost:8787/api/recordings/rec_sample/sop?format=md
curl -X POST localhost:8787/api/diagnose -H 'content-type: application/json' \
     -d '{"symptom":"booking will not save, next button does nothing","recording_id":"rec_sample"}'
```

Simulate an outage for a demo: `SIMULATED_STATE=evolve:down npm run dev`, then
ask the agent why invoices are not posting.

## Install the recorder

See `recorder-extension/README.md`. Load it unpacked in Chrome, point it at
the server URL, record a workflow in CMS, and send it to the agent.

## Configuration

`server/.env.example` documents every setting: model (`claude-opus-5` by
default), port, database path, web search on/off, optional bearer token, and
optional live health URLs for Evolve and Infomedia (simulated adapters are
used when blank).

## Guides

- **In the app: press *Guide*** (or open `/guide.html`) — how to use Foreman,
  with a first-hour checklist that remembers where you got to

- `docs/INSTALL.md` — install on the laptop, as a desktop app, and on the phone
- `docs/USER_GUIDE.md` — step-by-step use of every feature

## Docs

- `docs/GROK_CAPABILITIES.md` — Grok capability inventory and how Foreman maps to it
- `docs/PROBLEM_SOLVING.md` — the diagnostic engine
- `docs/WORKFLOW_RECORDER.md` — capture, masking, SOP compilation, replay
- `docs/TASKS.md` — record a job once, then let Foreman run it
- `docs/HOW_IT_COPES.md` — the three layers that keep it working when pages change
- `docs/AGENTS_AND_SCHEDULING.md` — the board, schedules and agents
- `docs/REMOTE_ACCESS.md` — using the phone away from the Wi-Fi
- `docs/PACKAGING.md` — how Foreman becomes one double-clickable file
- `docs/REPORTS.md` — workshop dashboard and campaign list tools
- `docs/EVALS.md` — the eval harness and how to grow the case set
- `docs/ARCHITECTURE.md` — layout, turn flow, modes, storage
- `docs/ROADMAP.md` — what would make Foreman the best workshop agent on the market

## Status and next steps

Working now: console, streaming agent with tools, engine, recorder extension,
SOP/Playwright export, cases, memory, follow-ups, tests.

Also done from the roadmap: case-to-ticket bridge, eval set, weekly playbook
review, installable phone/desktop app.

Not yet: live Evolve/Infomedia health endpoints (adapters are simulated until
URLs are configured), speech output, and an MCP connection to dealership
systems. The task runner, scheduler and agents are proven against a test page
and the API, not yet against live CMS.
