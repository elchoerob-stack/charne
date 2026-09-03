# Making Foreman the best workshop agent on the market

An honest view of where Foreman stands and what would make it unbeatable for
franchised dealership workshops in South Africa. Ordered by impact per week of
effort. "Capacity" items are about doing more work per day without Jacques in
the loop; "capability" items are about doing things no competitor does.

## What already sets it apart

- A diagnostic method (playbooks, evidence, confidence, one question at a
  time, learning from resolved cases) rather than a chat window.
- Evidence captured from the real screen: the recorder's failed requests and
  console errors feed the diagnosis automatically.
- Domain depth: Evolve DMS posting, Infomedia menus, OTP/e-signature, eVHC
  tablets, carry-over abuse, pre-inspection, DMS linkage.
- Reports that a dealer principal can open on a phone, built from the export
  they already have, and an agent that can discuss the numbers.

## Tier 1 — do these next (days each)

1. **Live integration adapters.** Point `EVOLVE_HEALTH_URL` and
   `INFOMEDIA_HEALTH_URL` at real endpoints and add a `cms` status URL. Then
   add read-only lookups: job card posting log, authorisation send log, VIN
   decode. Every one of these turns a question to the user into an automatic
   check, which is the single biggest jump in diagnostic accuracy.
2. **Scheduled routines.** A cron runner over the `followups` table plus a
   WhatsApp/e-mail notifier so Foreman chases "did the Evolve retry post?"
   without being asked, and sends the Monday workshop report to each dealer
   principal automatically (Grok Tasks, but for dealers).
3. **Case-to-ticket bridge.** Push escalation packets straight into the CMS
   support desk system (Jira/Zendesk/e-mail) with recording links, so an
   escalation is one click and arrives complete.
4. **Eval set.** Fifty real support conversations with the known correct
   cause, scored automatically (`/claude-api build-eval`). Without this, every
   prompt or playbook change is a guess. With it, Foreman measurably improves
   every week.
5. **Playbook growth loop.** A weekly review screen listing resolved cases
   that produced learned playbooks, with one-click promotion into the seeded
   list after a human confirms. Ten playbooks becomes a hundred in a quarter.

## Tier 2 — capability (weeks each)

6. **Screen-aware guidance.** The recorder already knows the current screen
   and the last failed request. Add a side panel in the CMS web app (the same
   extension) that shows Foreman's next step in context, so the advisor never
   leaves CMS.
7. **Voice on the floor.** Speech in is done; add speech out and a hands-free
   mode for technicians on tablets ("Foreman, the eVHC upload is stuck").
8. **Multi-dealer memory and benchmarks.** Group-level views across all 14
   Morgan franchises (the group report skill), with week-on-week deltas and
   automatic "who moved" commentary.
9. **Training mode.** Turn any SOP recording into an interactive walkthrough
   with screenshots and a quiz, and record who completed it: rollout training
   that survives staff turnover.
10. **Proactive anomaly detection.** Watch the daily export and open cases
    automatically when a dealer's close rate drops, carry-over excess spikes,
    or DMS linkage falls below threshold.

## Tier 3 — capacity (doing more per day)

11. **Batch mode.** Queue of uploaded exports processed overnight with the
    Batch API at half cost; reports waiting in each dealer's inbox at 07:00.
12. **Compaction and long sessions.** Enable server-side compaction so a
    dealer's session can run for weeks without losing history.
13. **Cheaper tiers per task.** Keep Opus 5 for diagnosis; route SOP
    formatting and report narration to Sonnet 5 at low effort once the eval
    set proves quality holds (`/claude-api cost-optimize`).
14. **Managed deployment.** Move the agent loop to Managed Agents with a
    scheduled deployment so nothing depends on a laptop being on.
15. **Multi-tenant hosting.** Per-dealer-group databases, SSO, audit log,
    POPIA data retention policy enforced by a nightly job. This is what lets
    CMS sell Foreman as a product line rather than a tool Jacques runs.

## Tier 4 — moat

16. **Outcome data.** Track time-to-resolution and repeat-incident rate per
    playbook and per dealer. Publish the numbers. No competitor has them.
17. **Partner integrations as MCP servers.** Expose Evolve, Infomedia and CMS
    lookups as MCP tools so any assistant a dealer group already pays for can
    use Foreman's knowledge, with CMS as the source of record.
18. **Dealer-facing SLA.** "Foreman answers 80% of workshop questions in
    under two minutes, escalates the rest with a complete packet." Measured
    by the eval set and the outcome data above.

## For Jacques personally

- Get the eval harness running first; it turns intuition into evidence and is
  the same discipline as the walk-forward testing in the trading bots.
- Record every rollout session with the extension; the SOP library builds
  itself and becomes the onboarding pack for the next dealer.
- Keep learned playbooks reviewed weekly; that is the compounding asset.
- Put Foreman in front of one dealer principal for a month and collect the
  outcome numbers before showing it to CMS leadership.
