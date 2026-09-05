# Foreman

**Foreman** does two jobs for CMS Systems dealerships.

**1. It answers and diagnoses.** Describe what is going wrong at a dealership
and it works the problem with you — ranking causes from playbooks, checking
Evolve/Infomedia/SMS health, reading the evidence out of a recording, and
giving you steps to fix and verify. Feed it a workshop export or a Marketing
Contacts export and it builds the report or the campaign list and talks you
through the numbers.

**2. It does the work.** Record a job once with the recorder extension, press
*Make a task*, and Foreman then performs that job itself — in its own browser,
in the background, as many times as you like, with different data each run,
while you carry on with something else. Put tasks on a schedule, arrange them
on a drag-and-drop board, or hand a set of them to a named **agent** that runs
them and reports back. See `docs/TASKS.md` and
`docs/AGENTS_AND_SCHEDULING.md`.

The name is the job: the foreman runs the floor, knows every job on the board,
and sorts out the problem before it reaches the dealer principal.

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

Windows, one command in PowerShell (installs Node and Git if needed, builds,
configures, autostarts, opens the console):

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
irm https://raw.githubusercontent.com/elchoerob-stack/charne/claude/grokbot-cms-agent-5vkq13/cms-agent/setup.ps1 | iex
```

Mac/Linux: `bash cms-agent/setup.sh`. Docker: `docker compose up -d` in `cms-agent/`.

Manual:

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

- `docs/INSTALL.md` — install on the laptop, as a desktop app, and on the phone
- `docs/USER_GUIDE.md` — step-by-step use of every feature

## Docs

- `docs/GROK_CAPABILITIES.md` — Grok capability inventory and how Foreman maps to it
- `docs/PROBLEM_SOLVING.md` — the diagnostic engine
- `docs/WORKFLOW_RECORDER.md` — capture, masking, SOP compilation, replay
- `docs/TASKS.md` — record a job once, then let Foreman run it
- `docs/AGENTS_AND_SCHEDULING.md` — the board, schedules and agents
- `docs/REMOTE_ACCESS.md` — using the phone away from the Wi-Fi
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
