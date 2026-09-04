# Architecture

```
cms-agent/
  web/index.html            Console: chat (SSE), thoughts panel, activity feed, modes, voice, screenshots,
                            sidebar for health / recordings / cases / memory / playbooks
  recorder-extension/       Chrome MV3 extension: capture, mask, screenshot, upload
  server/
    src/index.ts            Express app, static console, optional bearer token
    src/routes.ts           /api/chat (SSE), sessions, cases, memory, playbooks, followups
    src/agent/agent.ts      Turn loop: history → dynamic system message → Claude stream → tools → repeat
    src/agent/tools.ts      Tool registry (knowledge, recordings, diagnose, health, memory, cases, follow-ups)
    src/agent/prompts.ts    Frozen system prompt (cached), mode notes, council specialists
    src/agent/integrations.ts  Health adapters: live URL or simulated
    src/problem-solving/    Playbooks + Bayesian-style engine (pure, tested)
    src/recorder/           Zod schema, SOP compiler, renderers, evidence extraction, routes
    src/reports/            Workshop dashboard + campaign list builders (xlsx in, HTML/xlsx/CSV out), store, routes
    src/tasks/              Recording -> repeatable Task; Playwright runner with locator fallbacks and
                            Claude self-healing; background run queue; store; routes
    knowledge/cms-kb.json   Seed knowledge base
    test/                   node:test suites
```

## Turn flow

1. Console POSTs `{sessionId, dealer, mode, text, images}` to `/api/chat`.
2. `runTurn` loads history from SQLite, appends the user message (with image
   blocks), and builds a **dynamic context** (date, dealer, dealer facts, open
   cases, mode note) which is sent as a mid-conversation `system` message so
   the cached system prompt prefix is untouched.
3. In **Council** mode three specialist calls run first, in parallel, and their
   briefs are appended to the dynamic context.
4. `client.beta.messages.stream` is called with adaptive thinking
   (summarised display), `output_config.effort` per mode, the tool list per
   mode, `fallbacks: "default"` and the server-side fallback beta header.
   Text and thinking deltas are forwarded as SSE events.
5. On `tool_use`, all requested tools run concurrently; results go back in one
   user message. `pause_turn` (server tools) re-sends; `refusal` is reported.
6. Every message, including tool plumbing and thinking blocks, is persisted so
   the next turn replays it unchanged on the same model.
7. Due follow-ups are surfaced, then `done` with token usage.

## Modes

| Mode | Effort | Tools | Iterations |
|---|---|---|---|
| quick | low | custom tools | 6 |
| think | high | + code execution | 12 |
| deep | xhigh | + web search (8 uses) | 24 |
| council | high | + web search (3 uses), preceded by 3 specialist briefs | 16 |

## Storage

SQLite (`better-sqlite3`, WAL) at `CMS_AGENT_DB`. Tables: sessions, messages,
memory, recordings, cases, learned_playbooks, followups, files, reports,
tasks, task_runs.
Uploaded workbooks and generated report files live next to the database under
`data/files` and `data/reports`.

## Security notes

- Optional `CMS_AGENT_TOKEN` guards `/api/*`; the extension and console send it
  as a bearer token.
- Recordings can carry screenshots of customer data even with masking; keep
  the server on the dealership/CMS network and prune old recordings.
- The agent never executes anything against CMS, Evolve or Infomedia. Health
  checks are read-only GETs; everything else is advice for a human to act on.
