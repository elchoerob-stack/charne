# How it copes when things move

A recorded macro breaks the first time a page changes. That is why most
record-and-replay tools end up abandoned. Foreman handles change in three
layers, cheapest first.

## Layer 1 — several ways to find the same thing

Every step remembers seven different ways to identify its element: the test
id, the role and accessible name, the label, the placeholder, the id, the
visible text, and a CSS path. They are tried in that order — most durable
first, because a test id survives a redesign while a generated CSS path barely
survives a change of sort order.

This alone handles most drift. A test proves it: a booking recorded against
one page replays correctly against a rebuilt copy where **every id was renamed
and the test id deleted**, purely because the visible labels were unchanged —
which is exactly what a person would have gone by.

Costs nothing, needs no API call.

## Layer 2 — work out how to do it instead

When none of the seven match, the step stops being "click this element" and
becomes an *intent*: "enter the registration", "open the job card", "save the
booking". Claude is given that intent, the surrounding steps for context, and
a list of everything on the page a person could actually click or type into.

It then takes **as many actions as it needs**, one at a time, up to a limit:

- dismiss the cookie banner that appeared last month
- open the tab or menu the form now lives behind
- type into the field that got renamed
- click the button that is now called something else

A test proves this too, against a page rebuilt so thoroughly that layer 1
cannot cope: a cookie banner blocks the page, the form hides behind a tab, and
every field has a new name. The run completes anyway.

## Layer 3 — remember what worked

Whatever it finds is written back onto the task. The next run goes straight
there, at layer-1 speed, with no API call. The task quietly improves itself
each time the page moves.

## Where it deliberately stops

It is driving a live business system, where a wrong click makes a real record
or sends a real message. So:

- **If two elements could plausibly be the one meant, it gives up** rather than
  picking. The run fails with a screenshot, which is recoverable; a wrong
  booking is not.
- **A login screen aborts the run.** That means a saved sign-in expired, and
  the alternative is typing a customer's name into a password box.
- **The bounded loop.** A handful of actions per step, then it stops. It will
  not wander around a site trying things.
- **Practice run** walks every step and touches nothing, so a task can be
  sanity-checked before it acts for real.

## What this does not cover

- A workflow that has genuinely changed shape — an extra approval screen, a
  step that now needs data from somewhere else. It will stop and tell you.
  Re-record it; that takes two minutes.
- Anything outside the browser. Desktop applications are not driven.
- CAPTCHAs and two-factor prompts, by design.
