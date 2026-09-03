# Problem-solving engine

`server/src/problem-solving/` is a small, pure-TypeScript diagnostic engine.
It has no dependency on the model; the agent calls it through the
`diagnose_problem` tool, and the console can call it directly via
`POST /api/diagnose`.

## Model

- **Playbook**: a known problem with `symptoms` (phrases), a `prior` (base
  rate), `checks`, `resolution` steps, a `verify` statement and an
  `escalate` target.
- **Check**: a question with `lrPass` and `lrFail` likelihood ratios. A check
  may carry an `auto` evaluator that answers it from `Evidence`; otherwise the
  agent asks the user.
- **Evidence**: console errors, failed requests, last URL, integration health,
  free-text facts, offline flag, p95 latency. It is built from a recording
  (`evidenceFromRecording`), from `check_integration` results, and from what
  the user says.

## Algorithm (`diagnose`)

1. **Candidate generation.** Score every playbook by symptom-phrase overlap
   after tokenising and mapping synonyms (authorization → authorisation,
   catalog → catalogue, frozen → stuck, …). Keep those above `minMatch`.
2. **Prior.** Start each candidate at `logit(prior × (0.4 + 0.6 × match))`.
3. **Update.** For each check, take the outcome from an explicit answer, else
   from the `auto` evaluator, else leave it pending. Add `log(lrPass)` or
   `log(lrFail)` to the log-odds.
4. **Normalise.** Convert to probabilities across candidates plus a fixed
   "something else" mass, so confidence never reaches 100% on words alone.
5. **Next check.** For the top two hypotheses, rank pending checks by expected
   posterior movement weighted by the hypothesis' confidence; return the best
   one as `nextCheck`.
6. **Decide.**
   - confidence ≥ `actThreshold` (0.7): return a `plan` (steps, verify, escalate)
   - no candidates, or all checks exhausted with low confidence: return an
     `escalation` packet (who, summary, evidence, tried hypotheses, what to include)
   - otherwise: ask the `nextCheck`
7. **Explain.** `reasoning[]` lists what matched, what evidence was used and
   why the engine chose to act, ask or escalate. The agent is told to relay
   this in plain words.

## Learning

`update_case` with `status: resolved` and a `resolution` calls
`playbookFromCase`, which turns the case into a learned playbook with a low
prior (3%), one confirmation check, and the resolution split into steps. Each
further resolution of the same case increments `confirmations`, raising the
prior up to 12%. Learned playbooks are loaded on every diagnosis.

## Extending the playbooks

Add an entry to `playbooks.ts`. Guidelines:

- Symptoms are lower-case phrases; multiword phrases count double.
- Priors only need to be right relative to each other.
- Use `lrPass`/`lrFail` in the 3–8 / 0.3–0.7 range for strong checks and
  1.5 / 0.8 for weak ones. A check that *rules out* a cause when it passes
  (e.g. "send log says delivered") gets `lrPass < 1` and `lrFail > 1`.
- Prefer `auto` evaluators that read failed-request URLs and statuses, since
  the recorder captures those for free.

Run `npm test` in `server/` after changes; `test/engine.test.ts` covers
ranking, evidence updates, learning and escalation.
