# Grok / "Grokbot" capabilities and how CMS Agent maps them

This is the research behind the design. "Grokbot" is used here to mean the
agentic side of xAI's Grok: the consumer assistant's modes and the Agent Tools
API that developers use to build bots on it. Each capability is listed with
what it actually does, whether it is relevant to a dealership workshop support
agent, and what CMS Agent does about it.

Sources consulted (September 2026): xAI's Grok 4.1 Fast / Agent Tools API
announcement, the xAI developer docs tools overview, the Voiceflow, Suprmind,
TechJack and Verdent write-ups on Grok features, the Grok Build developer guide,
and the Grok-MCP open-source server. Some of these sites are not reachable from
the build environment, so details come from search summaries and should be
re-checked against docs.x.ai before quoting them to a customer.

## 1. Capability inventory

| Grok capability | What it does | CMS Agent equivalent |
|---|---|---|
| **Server-side agent tools** (`web_search`, `x_search`, `code_execution`, `collections_search`, remote MCP) | xAI runs the reasoning + tool loop on its servers; the bot can browse, search X, run Python, retrieve uploaded documents, and call MCP servers without the developer managing sandboxes. | Claude server tools do the same job: `web_search_20260209` (Deep and Council modes), `code_execution_20260120` (Think/Deep/Council). "Collections" become the CMS knowledge base + recordings searched by `search_knowledge` / `get_workflow_sop`. MCP can be added via the Claude MCP connector when a dealership system exposes one. |
| **DeepSearch / DeeperSearch** | Iterative retrieval loop: split the question into sub-queries, search in parallel, keep a scratchpad, repeat up to a step limit, then answer with sources. | **Deep mode**: `effort: xhigh`, web search enabled with a higher `max_uses`, an explicit instruction to decompose into sub-questions and keep notes before answering, and a higher tool-iteration ceiling (24). |
| **Think mode** | Visible chain-of-thought panel while the model reasons. | **Think mode** (default): adaptive thinking with `display: "summarized"`; the console shows a collapsible "Thoughts" panel streamed live. |
| **Heavy / multi-agent cross-check** (Grok, Harper, Benjamin, Lucas; up to 16 agents) | Several agents work the same problem in parallel and cross-check each other, which xAI credits with cutting hallucinations. | **Council mode**: three specialist briefs (product, integrations, network/device) run in parallel at medium effort; the main turn is told to cross-check them and to settle disagreements with tool evidence. |
| **Grok Build parallel subagents / Arena mode** | Up to 8 coding agents race the same task. | Not a coding agent. The same idea shows up as parallel tool execution: when Claude requests several checks in one turn (e.g. Evolve + Infomedia + SMS health) they run concurrently and return in one message. |
| **Memory** (remembers prior chats; injected at conversation start) | Facts persist across sessions. | `remember` / `recall` tools with a per-dealer scope plus `global`; the latest dealer facts are injected into the dynamic context of every turn. Customer personal data is excluded by instruction and by the recorder's masking. |
| **Workspaces / Projects** | Containers of related chats, files and custom instructions. | The **dealer** is the workspace: sessions, cases, recordings and memory are all keyed by dealer code, and the sidebar filters by it. |
| **Tasks / scheduled routines** | Recurring or one-off scheduled prompts and reminders. | `schedule_followup` stores a due reminder tied to a case; it is surfaced at the end of the next turn after it falls due (and via `/api/followups`). A cron runner can be added on top of the same table. |
| **Real-time X data** | Live public posts for current events. | Not relevant to dealership support. The "real-time" signal that matters is the live telemetry the recorder captures: failed requests, console errors, latency, offline periods. |
| **Vision** (image understanding, camera in voice mode) | Describe and analyse images. | Screenshot upload or paste in the console; images go to Claude as base64 image blocks, so "what does this error mean" works from a photo of a screen. |
| **Voice mode** | Speech in and out. | Dictation via the browser Web Speech API (`en-ZA`). Speech output is not built in; it is a one-line addition with `speechSynthesis`. |
| **Companions / personas** | Character personalities. | Not applicable. |
| **Image/video generation (Imagine)** | Media generation. | Not applicable. |

## 2. What "problem-solving intelligence" adds beyond Grok

Grok's tools give a bot reach (search, code, documents). They do not give it
a method. CMS Agent adds an explicit diagnostic method so that the model's
reasoning is grounded, auditable and improves over time:

1. **Playbooks with priors and likelihood ratios.** Ten seeded playbooks for
   the CMS Workshop Module, Evolve DMS, Infomedia and messaging. Each check
   states how much a pass or fail should move the odds.
2. **Automatic evidence.** Evidence from a problem recording (failed requests,
   console errors, latency, offline) and from integration health checks is
   evaluated by the checks without asking the user.
3. **One question at a time.** The engine returns the single most informative
   unanswered check, so the agent asks a question rather than pasting a list.
4. **Act / ask / escalate.** A plan is produced only when the top hypothesis
   clears a confidence threshold; when nothing fits, a structured escalation
   packet says who to contact and what to include.
5. **Learning loop.** Resolving a case with a resolution creates a learned
   playbook that takes part in future diagnoses, gaining weight each time it
   is confirmed.

See `PROBLEM_SOLVING.md` for the algorithm and `WORKFLOW_RECORDER.md` for how
recordings become evidence and SOPs.

## 3. Deliberate differences

- **Model.** CMS Agent runs on Claude (Opus 5 by default) with adaptive
  thinking, refusal fallbacks and prompt caching. Nothing here calls xAI.
- **Grounding over breadth.** Web search is off in Quick and Think modes so
  product answers come from the knowledge base and recordings, not the open
  web. It is on in Deep and Council modes for questions outside CMS
  (browser, tablet, carrier, Windows behaviour).
- **Privacy.** POPIA masking is done in the recorder before data leaves the
  browser, and the system prompt forbids storing customer personal data in
  memory or cases.
