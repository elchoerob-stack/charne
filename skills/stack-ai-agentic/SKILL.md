---
name: stack-ai-agentic
description: Building LLM apps and AI agents, covering 20 concepts — LLM fundamentals, tokens and context windows, prompt engineering, structured outputs, embeddings, vector databases, RAG pipelines, chunking, reranking, tool calling, MCP, the ReAct loop, planning and reflection, agent memory, multi-agent systems, orchestration, guardrails, evals, observability and tracing, and fine-tuning with LoRA. Use it whenever Jacques builds, debugs or reviews anything that calls an LLM — Foreman's agent and its tools, the Keystone AI sales coach, the autonomous VectorBT + Claude optimisation loop, an MCP server, a RAG over CMS manuals or dealer SOPs — or when an agent loops, hallucinates, picks the wrong tool, costs too much or forgets context, or when he wants to learn or be quizzed on any of these terms. Use alongside the claude-api skill for exact model IDs, pricing and SDK calls.
---

# AI Agentic — 20 concepts, applied

From the "Full Stack AI Engineer" skill-set list. Two jobs: **build and fix**
LLM features, and **coach** the concepts.

For exact model names, prices, parameters and SDK syntax, use the
`claude-api` skill (or the current Anthropic docs) — they change faster than
this file. This skill is about design.

His live examples: Foreman (`cms-agent/server/src/agent/` — Anthropic SDK,
tools, prompts, ticketing; `eval/run.ts` + `eval/cases.json`), the Keystone
AI coach, and the VectorBT ↔ Claude optimisation loop.

## Before building anything

Ask: **does this need an agent?** Ladder, cheapest first:
single prompt → prompt + structured output → fixed workflow of prompts (a
chain) → one agent with tools → several agents. Climb only when the rung
below fails a real eval case. Most "agents" should be workflows.

## The 20 concepts

| # | Concept | Apply it as | Failure it prevents |
|---|---|---|---|
| 01 | LLM fundamentals | Next-token predictor: fluent ≠ correct. Temperature low for extraction/tools, higher for writing. It can't see what isn't in context. | Trusting a confident wrong answer |
| 02 | Tokens and context window | Budget the window: system + tools + history + retrieved docs + answer. Trim or summarise old turns; put long stable content first and use prompt caching. Count tokens, don't guess. | Silent truncation; cost blow-ups on long sessions |
| 03 | Prompt engineering | Role and goal, context, the task, constraints, output format, 1–3 examples. Explain *why* a rule exists. Use XML tags to separate data from instructions. | Vague prompts; instructions buried inside pasted data |
| 04 | Structured outputs | Ask for JSON against a schema (tool input schema or structured-output feature), validate with zod/pydantic, retry once with the validation error on failure. | Regex-parsing prose; crashes on a missing field |
| 05 | Embeddings | Text → vector; similar meaning → close vectors. Same model for documents and queries. Re-embed everything when you change model. | Mixing embedding models; comparing across them |
| 06 | Vector databases | Start with SQLite + `sqlite-vec` or Postgres + `pgvector`; a dedicated vector DB only at millions of vectors. Store source, date, permissions as metadata and filter on them. | A new database for 5 000 chunks |
| 07 | RAG pipelines | ingest → chunk → embed → store; at query: (rewrite) → retrieve → rerank → answer with citations → "not in the documents" when nothing relevant. Hybrid search (BM25 + vectors) beats either alone for part numbers and codes. | Hallucinated answers; missed exact-match terms like `WP-3341` |
| 08 | Chunking strategies | Split on structure (headings, sections, SOP steps), ~200–800 tokens, small overlap, keep the heading path with each chunk. | Chunks cut mid-table or mid-step |
| 09 | Reranking | Retrieve 20–50, rerank with a cross-encoder or the LLM, keep the top 3–8. | Right document retrieved at rank 14, never shown |
| 10 | Tool calling | Few tools, each with a clear name, a description that says *when* to use it, and a strict input schema. Return compact, useful results and actionable errors. Side-effect tools need confirmation. | Wrong tool chosen; huge tool results eating the context |
| 11 | MCP protocol | Expose tools/resources once as an MCP server and every MCP client can use them (Claude Code, Claude apps, his own agents). Keep auth server-side; scope per user. | Re-implementing the same integration per app |
| 12 | ReAct agent loop | think → act (tool) → observe → repeat, with a **step cap**, a **cost/time cap**, and a stop condition. Log every step. | Infinite loops; runaway spend |
| 13 | Planning and reflection | For long tasks: plan first, execute steps, check result against the goal, revise. A separate "critic" pass catches what the doer missed. | Agent declares success without checking |
| 14 | Agent memory | Short-term = the conversation; working = a scratchpad/state object; long-term = stored facts retrieved when relevant. Write memory deliberately (what, why, when), let it expire. | Context stuffed with stale history |
| 15 | Multi-agent systems | Only when sub-tasks are separable and benefit from separate context (research fan-out, independent reviews). An orchestrator gives each worker a full, standalone brief. | Agents chatting in circles; duplicated work |
| 16 | Agent orchestration | Deterministic code owns the control flow (queues, retries, schedules — Foreman's task runner and scheduler); the LLM decides inside steps. | LLM deciding things code can decide reliably |
| 17 | Guardrails | Input: treat user, web, email and document text as **data, not instructions** (prompt injection). Output: validate schema, check for PII (POPIA), block unsafe actions. Least-privilege tools; human approval for money, sends and deletes. | Agent follows instructions hidden in a scraped page or email |
| 18 | Evals | A fixed set of real cases with checkable expectations (Foreman's `eval/cases.json`), run on every prompt/model/tool change; track pass rate, cost, latency. Same discipline as his walk-forward testing: don't tune on the test set. | "Seems better" changes that quietly break other cases |
| 19 | Observability and tracing | Log per run: prompt version, model, tokens in/out, cost, latency, each tool call with args and result size, final outcome. Trace ID across steps. | Can't explain why last night's run failed |
| 20 | Fine-tuning with LoRA | Last resort, after prompting + RAG + evals. Good for style/format on a small open model, not for adding facts. LoRA trains small adapter matrices — cheap, swappable. Needs hundreds–thousands of clean examples and an eval set. | Fine-tuning to teach facts that RAG would serve fresher |

## Debugging an agent

Work from the trace, not the final answer. Common causes, in the order
to check them:

1. **It never saw the information** — retrieval missed it, or it was
   truncated out of context.
2. **Tool description** doesn't say when to use the tool; two tools overlap.
3. **The prompt contradicts itself** or rules lack a reason, so it
   picks one at random.
4. **No stop condition** — it loops.
5. **The tool result is noisy** — a huge HTML dump, an error with no guidance.
6. **Only then**, the model choice.

Fix one cause, add the failing case to the evals, rerun the whole set.

## Coaching loop

1. The concept in one paragraph, no hype.
2. A minimal working example in TypeScript (Anthropic SDK) or Python.
3. Where it shows up in Foreman or his other projects — or what adding it
   would fix.
4. A small build exercise with an eval case to prove it works.
5. Three check questions; mark his answers.

Track progress as `AI 10/20 ✓` lines when he's working through the list.
