---
name: prompt-master
description: Get more out of a Claude plan by making each turn count — sharpening a vague ask into a prompt that lands first time, sequencing a big job into the right number of sessions, routing work to the right model, and keeping context lean. Use this whenever the user is worried about running out of Claude capacity or hitting their plan limit, asks how to phrase or structure a prompt, says something like "what's the best way to ask this", "am I wasting messages", "which model should I use", "how do I stop burning through my limit", or is about to hand over a large multi-part job that would otherwise sprawl across many corrective turns. Also use it when a request arrives underspecified enough that answering it directly would clearly cost two or three rounds of correction — sharpen first, then do the work.
---

# Prompt Master

## The economics you are optimising

A Claude plan is spent per **turn**, and the cost of a turn scales with how much
context that turn carries. Two consequences drive everything in this skill:

1. **Rework is the dominant cost.** A vague prompt costs one turn to ask, one to
   correct, and often a third to undo the correction. Three turns for one job.
2. **A bad answer keeps charging rent.** Every message in a conversation is
   re-sent on every later turn. A wrong 900-line file generated in turn 2 is
   still being paid for in turn 20. Long meandering threads cost superlinearly.

So the levers are: fewer turns, and lighter threads. Everything below serves one
of those two.

## Do not become the waste

This skill exists to save the user turns and tokens. A version of it that prints
a 400-word lecture about prompt engineering before every answer has *spent* the
thing it was supposed to *save*. Guard against that hard:

- Never make the user approve a rewritten prompt before doing their work. That
  turns one turn into two — the exact failure mode being fixed.
- Keep any advice to a few lines, at the end, and only when it would change what
  the user does next. Silence beats filler.
- If the incoming request is already clear, just do it. Say nothing about
  prompting.

## Step 1 — Triage the request

**Path A — one job, one session.** A bug, a feature, a document, an analysis, a
script. This is most requests. Go to Path A.

**Path B — a campaign.** Work that plainly cannot land in one sitting: "build me
a trading bot with backtesting and a dashboard", "migrate this whole app",
"produce reports for all 14 dealers". Signals: several deliverables, or stages
that depend on each other, or an unknown that has to be resolved before the rest
can be designed. Go to Path B.

When it is genuinely unclear which, treat it as Path A. Over-planning a small job
is itself waste.

## Path A — Sharpen, then do the work

Reconstruct the request as the prompt the user *should* have sent, then act on
that. In one turn.

A prompt that lands first time carries five things. Most vague asks are missing
three of them, and you can usually infer them from context rather than asking:

1. **The finished artifact, not the activity.** "A `.cs` cBot file that…" beats
   "help me with my bot". Naming the deliverable fixes format, scope and done-ness
   in one stroke.
2. **The constraints that would otherwise cause rework.** Language and version,
   file/format, length, the platform it must run on, and — often most valuable —
   what *not* to do. Constraints the user knows but did not think to say are the
   single biggest source of wasted turns.
3. **The context only the user has.** What they already tried, why the obvious
   answer is wrong for them, what their environment actually is. If you have this
   from earlier in the conversation or the repo, use it; that is free.
4. **The success test.** How they will judge the result. Without it you are
   guessing at "good", and guessing costs a correction round.
5. **Decision authority.** State plainly that you will pick sensible defaults for
   anything unspecified and note the assumptions afterwards. This is the highest-
   value line in the whole recipe: it converts a clarifying-question round trip
   into zero extra turns.

Then **do the work**. The default is act, not ask.

Ask a blocking question only when proceeding under any assumption would be unsafe
or would make the result useless if the guess is wrong — a destructive operation,
or a fork where the two readings produce entirely different deliverables. A
question costs a full round trip, so it must buy more than it costs.

### How to show it

Lead with one or two lines naming what you took the request to mean and the
assumptions you are running with, then deliver. Something like:

> Reading this as: a 15-minute XAUUSD cBot in C# for cTrader, risk hardcoded as
> constants, no optimisable risk parameters. Assuming you want it self-contained
> in one file. Here it is.

That is enough. It lets the user catch a wrong reading in the same breath as
getting the work, instead of in an extra turn. Do not print a formal "Optimised
prompt:" block unless the user asked for a prompt to take elsewhere — in that
case give them the prompt and stop.

## Path B — Sequence the campaign

For a job too big for one session, the deliverable is a **plan of prompts**, not
the work itself. Each step should be a prompt the user can paste into a fresh
session and have it succeed with no memory of the others.

Order the steps by what they unlock. Put the genuinely uncertain thing first —
the piece that, if it fails, changes everything downstream. Building three
polished layers on top of an unvalidated assumption is the most expensive
mistake available, because the rework is not one turn, it is all of them.

For each step give:

- **What it produces** — a named artifact the next step can consume.
- **The prompt** — self-contained, carrying its own context, because a fresh
  session knows nothing.
- **Where to run it** — fresh session or continue, and which model (below).

Batch aggressively. Ten small mechanical edits belong in one prompt, not ten.
Anything the user can hand off to a cheaper model or a script should not be
spending premium capacity.

Then offer to start step one. Do not silently begin — the plan is the thing they
asked for.

## Routing: model and surface

Matching the model to the work is the easiest saving available, because the
cheapest models are genuinely excellent at the bulk of day-to-day work.

| Work | Route to |
|---|---|
| Architecture, subtle bugs, ambiguous requirements, anything where being wrong is expensive | Opus 5 |
| Most coding, drafting, analysis, refactors — the daily bulk | Sonnet 5 |
| Lookups, formatting, extraction, renaming, bulk mechanical passes | Haiku 4.5 |
| Anything touching many files in a repo | Claude Code, not chat — pasting files into chat costs the file on every subsequent turn |
| A workflow being repeated for the third time | A skill, not a prompt — see the `skill-creator` skill |

`references/routing.md` has the fuller version, including when a subagent or a
script beats another turn. Read it when a routing call is not obvious from the
table.

## Context hygiene

These are the habits that keep a thread cheap. Mention one only when it applies
to what the user is actually doing.

- **Start fresh at task boundaries.** New task, new session. Carrying a finished
  task's history into the next one means paying for it again on every turn.
- **Restart, don't wrestle.** Once a thread has gone wrong twice, a third
  correction is usually worse value than a new session with a prompt that folds
  in what was learned. Sunk cost is real and it is charging rent.
- **Point, don't paste.** In Claude Code, name the file and let it be read on
  demand. A pasted file is in context forever; a read file can be re-read cheaply
  when needed.
- **Ask for the artifact, not the tour.** "Do it, and note your assumptions at
  the end" gets in one turn what "explain your plan, then implement it" takes two
  to get.
- **Don't order options you won't use.** Three approaches costs three times the
  output when the user will pick one anyway. Ask for a recommendation.

`references/patterns.md` holds worked before/after examples of vague asks turned
into first-time-right prompts. Read it when a rewrite is not coming easily, or
when the user wants to learn the pattern rather than just get their work done.

## When to say nothing

If the user's prompt is already specific, or the task is trivial, or they are
mid-flow on something working — skip all of this and just do the job. The most
efficient turn is the one that answers the question and stops.
