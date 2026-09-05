# Worked examples: vague ask → first-time-right prompt

Read this when a rewrite is not coming easily, or when the user wants to learn
the pattern rather than just get their work done.

Each example shows the ask, what was missing, and the reconstruction. The point
is not the wording — it is noticing which of the five elements (artifact,
constraints, private context, success test, decision authority) was absent, since
that is what the correction rounds would have been spent supplying.

---

## 1. Missing the artifact and the success test

**Ask:** "Can you help me improve my trading bot?"

**Missing:** what "improve" means, what file, what would count as better. This
costs at least two rounds: one to find out which bot, one to find out what
metric.

**Reconstructed:**

> Here is `GoldScalpBot15m.cs`. Backtested over 2024 it has a profit factor of
> 0.94 with 312 trades. I want profit factor above 1.2 without dropping below
> ~150 trades — I don't want an edge that only exists on a handful of setups.
> Risk sizing is hardcoded on purpose; leave those constants alone. Suggest and
> apply the changes you think most likely to get there, and tell me what you
> changed and why. Pick sensible defaults for anything I haven't specified.

Note what the success test did: it ruled out the degenerate answer (fewer,
luckier trades) before it could be given.

---

## 2. Missing private context

**Ask:** "Why is my report generation so slow?"

**Missing:** everything the user knows and Claude cannot see — scale, what was
already tried, where the suspicion lies.

**Reconstructed:**

> Report generation takes about 90 seconds for 14 dealers, roughly 40k rows
> total. I've already ruled out the Excel read — that's under 2 seconds. It got
> slow when I added the per-advisor breakdown. Find the actual bottleneck before
> proposing a fix; if you need to profile it, do that.

"Find the cause before proposing a fix" is worth a line on its own. Without it,
the likely answer is a plausible optimisation of the wrong thing, and then a
round to discover it didn't help.

---

## 3. Missing constraints — the expensive kind

**Ask:** "Build me a dashboard for the workshop numbers."

**Missing:** where it runs, who sees it, what it must not depend on. These are
the constraints that force a full rebuild when they surface late.

**Reconstructed:**

> Build a single self-contained HTML file — no CDN, no build step, opens straight
> from a shared folder on a dealership PC and must work offline. Audience is a
> dealer principal on a laptop, so desktop-first but it shouldn't break on a
> phone. Data comes from the attached export; the sheet names are stable. One
> page, no navigation.

"Self-contained, no build step" is the sort of constraint that is obvious to the
person asking and invisible to the person answering. Surfacing it up front is
often worth more than everything else in the prompt combined.

---

## 4. Missing decision authority

**Ask:** "Set up validation for the customer import."

**Missing:** permission to decide. Without it, the reasonable response is a list
of questions, and the user pays a round trip for each batch of them.

**Reconstructed:**

> Set up validation for the customer import. South African formats — mobile
> numbers, email, ID numbers. Reject obvious placeholder junk. You choose the
> rules and the rejection thresholds; use your judgement, apply them, and list
> the decisions you made at the end so I can overrule any I don't like.

The final clause is what makes this safe: authority is delegated, but the
decisions are surfaced, so a wrong call costs one correction rather than an
undetected error.

---

## 5. When the right move is a plan, not an answer

**Ask:** "I want to build a CRM for my wife's real estate business — pipeline,
commission forecasting, buyer matching, and an AI coach."

This is four deliverables and an unvalidated assumption. Answering it directly
produces something shallow in every dimension.

The response is a sequence, uncertainty first:

1. **Data model and pipeline stages** — the thing everything else depends on, and
   the thing most likely to be wrong. Fresh session, strongest model. Produces a
   schema.
2. **Pipeline CRUD against that schema** — well-specified once step 1 lands.
   Fresh session, mid model.
3. **Commission forecasting** — pure calculation on the schema, testable in
   isolation. Fresh session, mid model.
4. **Buyer–listing matching** — depends on the schema but not on 2 or 3, so it
   can run in parallel.
5. **AI coach** — last, because it consumes everything above.

Each step gets a self-contained prompt carrying its own context. The ordering is
the actual value being added: getting the schema wrong at step 1 does not cost
one turn, it costs steps 2 through 5 as well.

---

## The anti-patterns, stated plainly

- **Asking for options you won't use.** Three approaches cost three times the
  output and one turn to choose. Ask for a recommendation with a one-line reason.
- **"Explain your plan, then do it."** Two turns for one job. "Do it, and note
  your assumptions" gets the same safety in one.
- **Correcting a thread that has gone wrong twice.** Start again with a prompt
  that folds in what was learned. The broken thread is charging rent on every
  further turn.
- **Pasting a file to ask about one function.** Paste the function. In a repo,
  name the file and let it be read.
- **Re-explaining a workflow for the third time.** That is a skill now.
