# Routing work to the cheapest thing that will do it well

Read this when the routing table in SKILL.md does not settle the call.

## Contents
- Choosing a model
- Choosing a surface (chat vs Claude Code vs a scheduled run)
- When another turn is the wrong tool entirely
- Reading the situation when the user is near a limit

## Choosing a model

The instinct to reach for the strongest model on everything is expensive and
usually unnecessary. The strongest model earns its keep on a narrow band of work:
where the problem is genuinely ambiguous, where an error is costly or hard to
detect, or where the answer depends on holding a lot of interacting constraints
in mind at once.

**Opus 5** — architecture and design calls, debugging something that has already
resisted one fix, security-sensitive code, ambiguous requirements that need to be
interpreted rather than followed, long multi-step agentic work where drift
compounds, and any judgement call the user will act on without checking.

**Sonnet 5** — the daily bulk. Writing a feature to a clear spec, refactors,
tests, documents, analysis of data whose shape is known, code review, most
debugging. If the task is well-specified, this is the right default and the
quality difference on well-specified work is small.

**Haiku 4.5** — mechanical and high-volume: extraction, reformatting, renaming
across files, summarising something already written, classification, converting
between formats, first-pass triage of a large set of items.

A useful test: *if this comes back subtly wrong, will I notice?* If yes, a
cheaper model is fine — the check is cheap. If no, pay for the stronger one.

Note that in Claude Code, fast mode runs Opus with faster output rather than
substituting a smaller model, so it is not a way to save capacity — it is a way
to wait less.

## Choosing a surface

**Chat** suits self-contained thinking: a decision, a draft, an explanation, a
piece of analysis on data pasted once. Its weakness is that everything pasted
into it stays in context for the rest of the conversation, so it is a poor place
to work across files.

**Claude Code** suits anything touching a repository. It reads files on demand
rather than holding them permanently, runs and tests what it writes, and can
verify its own work — which removes whole rounds of "that doesn't compile".
Anything involving more than about two files belongs here.

**A scheduled or background run** suits work that is genuinely repetitive on a
cadence — a weekly report, a recurring check. Setting it up costs more than doing
it once, and pays back from roughly the third repetition.

## When another turn is the wrong tool entirely

Some work should not be a Claude turn at all:

- **Deterministic transforms.** If the same input must always produce the same
  output — a spreadsheet clean, a file rename, a format conversion — one turn
  that writes a script beats N turns doing it by hand, and the script is reusable
  for free.
- **The third repetition.** A workflow done three times is a skill. Capturing it
  once means every future run costs one short prompt instead of a re-explanation.
  Point the user at `skill-creator`.
- **Wide, shallow search.** Fanning out across many files to find something is
  better handed to a subagent, whose intermediate reading never enters the main
  thread's context.
- **Facts with an authoritative source.** Checking documentation directly is
  faster and more reliable than a turn spent recalling it.

## When the user is near a limit

If someone says they are close to running out, the useful help is triage, not
technique. Establish what actually has to land today, and route accordingly:

- Get the one thing that matters done first, at full quality.
- Push mechanical remainder work to a cheaper model or a script.
- Convert anything that can wait into a written-down prompt they can run later —
  a prompt costs nothing to hold.

Do not spend the remaining capacity discussing how to spend the remaining
capacity. Two or three lines, then act.
