# Evals

`server/eval/` holds Foreman's measurement harness. The point is that every
change to a playbook, prompt or tool is a measured change, not a guess.

## Cases

`eval/cases.json` has 52 cases: five per seeded playbook with varied wording,
some with recorder evidence or answered checks, plus two that should
escalate because no playbook fits. **These were synthesised from the
playbooks**, which is the lowest-fidelity source. Replace and extend them
with real support conversations as they happen: copy the advisor's words
into `symptom`, add any evidence Foreman had, and set `expect` to the
playbook that turned out to be right.

```json
{ "id": "kim-2026-09-12", "symptom": "…advisor's words…", "expect": "evolve-post-fail",
  "evidence": { "health": { "evolve": "degraded" } }, "answers": { "account-hold": true } }
```

## Levels

- **Level 1 — engine** (`npx tsx eval/run.ts`): deterministic, free. Reports
  top-1 and top-3 accuracy per playbook and whether escalation cases
  escalate. Exit code 1 on any miss, so it can run in CI.
- **Level 2 — agent** (`npx tsx eval/run.ts --agent [--limit N]`): runs a real
  Think-mode turn per case and grades it: did it call `diagnose_problem`, did
  the expected playbook's title or steps appear, how many questions did it
  ask, and a Claude judge scores correctness and clarity 1–5 with a strict
  rubric. Uses tokens (roughly 6–12k per case at Opus 5 pricing).

Results go to `eval/results/<timestamp>.json`. Compare two runs before and
after a change; a change that lowers level-1 accuracy is rejected, a change
that lowers level-2 correctness needs a look at the judge notes.

## Current baseline

Level 1: 52/52 (top-1 100%). Level 2: not yet run in this environment (needs
credentials); run it once to set the baseline before changing prompts.

## Growing the set

- Every escalated case that later got a known cause is a perfect eval case.
- Every learned playbook promoted in the review screen should get two cases:
  the original wording and a paraphrase.
- Keep escalation-expected cases in the set so the engine never becomes
  over-eager.
