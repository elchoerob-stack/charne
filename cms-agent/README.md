# CMS Agent

A Claude-powered support and problem-solving agent for the CMS Workshop
Module, with a workflow recorder that turns real dealership sessions into SOPs
and diagnostic evidence.

It takes the useful parts of the Grok "agent bot" feature set (server-side
tools, DeepSearch-style investigation, visible thinking, multi-agent
cross-checking, memory, workspaces, scheduled follow-ups, vision, voice) and
adds what a workshop support agent actually needs: a diagnostic method with
playbooks, evidence and confidence, plus a learning loop from resolved cases.
The capability mapping is in `docs/GROK_CAPABILITIES.md`.

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
- **Workflow recorder** (`recorder-extension/` + `server/src/recorder/`):
  Chrome extension that captures clicks, fields, screens, screenshots,
  console errors and failed requests with POPIA masking; the server compiles
  recordings into markdown SOPs, Playwright replay scripts and evidence for
  the engine.
- **Agent tools**: knowledge search, recordings and SOPs, recording analysis,
  diagnose, integration health checks, dealer memory, cases, follow-ups, plus
  Claude's server-side code execution and web search in the deeper modes.

## Quick start

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

To exercise the diagnostic engine and recordings without API credentials:

```bash
npm test                         # engine + SOP unit tests
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

## Docs

- `docs/GROK_CAPABILITIES.md` — Grok capability inventory and the CMS Agent mapping
- `docs/PROBLEM_SOLVING.md` — the diagnostic engine
- `docs/WORKFLOW_RECORDER.md` — capture, masking, SOP compilation, replay
- `docs/ARCHITECTURE.md` — layout, turn flow, modes, storage

## Status and next steps

Working now: console, streaming agent with tools, engine, recorder extension,
SOP/Playwright export, cases, memory, follow-ups, tests.

Not yet: live Evolve/Infomedia health endpoints (adapters are simulated until
URLs are configured), speech output, a cron runner for follow-ups, and an MCP
connection to dealership systems. Each is a small addition on the existing
tables and tools.
