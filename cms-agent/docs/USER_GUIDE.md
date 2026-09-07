# Foreman user guide

> There is a friendlier version of this built into the app: press **Guide** in
> the top bar, or open `/guide.html`. It has a first-hour checklist, works on
> the phone, and prints. This file is the longer written reference.

Foreman is your workshop agent. It diagnoses CMS problems with playbooks and
evidence, builds workshop reports and campaign lists, turns recordings into
SOPs, and escalates cleanly when it cannot fix something. This guide walks
through every feature step by step. Install first (`docs/INSTALL.md`).

## 1. The console at a glance

- **Top bar**: dealer code box (set this first, everything is filed under it),
  Review link, Install app, New session.
- **Chat**: your conversation. Answers stream in; a collapsible **Thoughts**
  panel shows Foreman's reasoning; the grey **activity feed** shows every
  tool it used (diagnosis, health check, knowledge search, report build).
- **Composer**: type, or 🎙 to dictate, 🖼 to attach a screenshot (or paste
  one), Enter to send.
- **Right panel**: Mode, Reports & campaign lists, Integration health,
  Recordings, Cases, Dealer memory, Playbooks.

## 2. Pick a mode

| Mode | Use when |
|---|---|
| **Quick** | You want a one-line answer or a fact from the knowledge base. |
| **Think** (default) | A real problem. Foreman gathers evidence and reasons before answering. |
| **Deep** | Something unusual or outside CMS (browser, tablet, carrier, Windows). Adds web search and a multi-step investigation. |
| **Council** | A stubborn problem. Three specialists (product, integrations, network/device) each write a brief and Foreman cross-checks them. |

## 3. Solve a problem (step by step)

1. Set the **dealer code** (e.g. `KIM01`).
2. Describe the problem in the words the advisor used, including any error
   text: *"Invoice on job card 48812 is not posting to Evolve"*.
3. Foreman runs the diagnosis. Watch the activity feed: it will show the
   ranked hypotheses with confidence and the one check it wants next.
4. **Answer the one question** it asks (or click **Check all** in Integration
   health so it can use live status). Each answer moves the confidence.
5. When it is confident it gives **numbered steps** and **how to verify**.
   Do the steps, then tell Foreman the result.
6. If it worked, say so: *"That fixed it."* Foreman will offer to open or
   resolve a case. **Resolving a case with the resolution written down is
   what teaches it** for next time.
7. If it did not work or nothing fits, Foreman prepares an escalation. See §7.

Tips: attach a screenshot of the error; say "the customer is at Upington" and
Foreman will remember dealer facts you confirm; ask *"what would change your
mind?"* to see the reasoning.

## 4. Record a workflow (SOP or problem capture)

1. On the laptop, open the CMS screen where the task starts.
2. Click the **Foreman Recorder** extension → title (e.g. *Create a
   booking with an OEM menu*) → purpose **SOP / training** or **Problem
   capture** → dealer code → **Start**.
3. Work through the task normally. Add a **note** at the moment something
   goes wrong ("Next does nothing here").
4. **Stop** → **Send to CMS Agent**. Personal data typed into the screens is
   masked before it leaves the browser.
5. In Foreman's **Recordings** panel: **SOP** opens the numbered procedure,
   **Playwright** downloads a replay script, **Diagnose** asks Foreman to
   analyse the errors and failed requests it captured, **Explain** writes the
   SOP for a service advisor.

Use SOP captures during rollouts: record each task once and you have the
training pack for the next dealership.

## 4b. Turn a recording into a task Foreman runs for you

This is the difference between Foreman telling you how to do a job and Foreman
doing it.

1. Record the job as in §4, and send it to CMS Agent.
2. In **Recordings**, press **Make a task**. Foreman strips out the noise and
   turns everything you typed into named fields.
3. Under **Tasks**, press **Run**. The first time it asks you to **Connect
   CMS**: a browser opens, you log in once, and only the session cookie is
   kept — your password is never stored.
4. Change any of the fields (they are pre-filled with what you typed while
   recording), then press Start. Tick **Practice run** the first time to walk
   the steps without touching CMS, or **Watch it happen** to see the browser.
5. The run goes into the background. Carry on working; check progress under
   **Work**, and open the log for any run to see each step and a screenshot if
   something failed.

Full detail, including how it survives CMS being redesigned: `docs/TASKS.md`.

## 4c. The board, schedules and agents

Press **Board** (top bar, or the bottom tab on the phone).

- **Drag a card** between lanes. Dropping it in *Scheduled* switches its
  schedule on, *Paused* switches it off, *To do* is the manual lane. It works
  with a thumb on the phone.
- **⏰ Schedule** on any card: daily, chosen weekdays, every N minutes, or a
  cron expression. Times are Centurion wall-clock.
- **+ New agent**: give it a name, say what it is for, tick the tasks it owns.
  Press *Run now*, or schedule it. When it finishes it writes you a short
  report — on the board and in the chat.

Detail: `docs/AGENTS_AND_SCHEDULING.md`.

## 5. Build a workshop report

1. Export the bookings from CMS (the `Bookings MTD` export from the workshop
   dashboard, or any bookings sheet).
2. In **Reports & campaign lists** click **＋ Workshop export** and choose the
   file. The dashboard builds in a few seconds.
3. **Open** shows the dealer-principal-ready HTML (sortable tables, close
   rates, carry-over abuse, weekly trend, insights). Send the file as-is; it
   has no external dependencies.
4. Click **Discuss** (or press Enter on the pre-filled prompt) and Foreman
   gives the headline numbers and the three things to act on: zero-close
   advisors, carry-over abuse, low DMS linkage, stale jobs.
5. Ask follow-ups: *"Which advisor at Ermelo should I coach first?"*,
   *"Compare week 24 and 25."*

## 6. Build a campaign list

1. Export **Marketing Contacts** from CMS.
2. Click **＋ Marketing contacts** and choose the file.
3. Foreman validates every mobile number and e-mail by the RSA format rules
   (never by the "distinct" tabs), dedupes per channel and reconciles the
   counts.
4. **Open** shows the summary; **Excel** downloads the five-sheet workbook
   (Prospect Summary, Original Data with helper columns, Cleaned Data,
   Validation rules and blacklists, Send List); **SMS CSV** and **E-mail
   CSV** are ready to upload to the sending platform.
5. Ask: *"How many Active prospects can we actually reach by SMS?"* or *"Why
   were 400 e-mails rejected?"*

Remember: the SMS list and the e-mail list are each deduped on their own
channel, so they are larger than the both-channel Cleaned Data set. Foreman
will say so when quoting numbers.

## 7. Escalate a case

1. Open a case if one is not open yet: *"Open a case for this."*
2. Click **Escalate** on the case (or tell Foreman *"escalate this to the
   support desk"*).
3. Foreman assembles the packet: symptom, hypotheses tried, failed requests
   and console errors from the recording, links to the recording and SOP,
   dealer facts, timeline, and a checklist of what the dealer still has to
   supply.
4. What happens next depends on `TICKET_CHANNEL` in `.env`:
   - **draft** (default): the packet is saved on the case and your e-mail
     client opens with it pre-filled. Nothing is sent automatically.
   - **email**: sent to `TICKET_EMAIL_TO` via SMTP.
   - **jira**: a Jira issue is created and the key is shown.
   - **webhook**: posted as JSON to a Zapier/Make/Power Automate hook, which
     can create the ticket in any helpdesk.
5. The case moves to **escalated** and the packet is always available from
   the **Packet** button.

## 8. Weekly review (10 minutes every Monday)

1. Click **Review** in the top bar.
2. **Learned playbooks awaiting review**: each resolved case appears here.
   Tidy the title, make the symptom phrases the words an advisor would use,
   make the steps crisp, then **Promote**. Archive anything that was a
   one-off.
3. **Promoted playbooks** are permanent, editable, and carry more weight in
   diagnosis. Raise the prior for problems you see often.
4. Glance at **Resolved this week** and **Open escalations** so nothing is
   forgotten. Or ask Foreman: *"What did we learn this week?"*

## 9. Measure it (evals)

Run `npx tsx eval\run.ts` in `server\` to check the diagnostic engine
against the case set (no API cost). Run with `--agent` to test the full
agent with a Claude judge (uses tokens). Add real support conversations to
`eval\cases.json` as they happen; see `docs/EVALS.md`.

## 10. Memory and cases

- **Dealer memory** shows what Foreman knows about the selected dealer.
  Tell it durable facts ("the wall screen at Kimberley is on the guest
  Wi-Fi") and it stores them. Never store customer personal data.
- **Cases** shows open and recent cases for the dealer; Status asks for a
  summary and next step.

## 11. On the phone

Everything above works on the phone app. The most useful things on site:
dictate the advisor's description, attach a photo of the error, run the
diagnosis, and read the steps aloud. Reports build and open on the phone too.
The recorder extension is laptop-only.

## 12. When something goes wrong with Foreman itself

| Symptom | Fix |
|---|---|
| "No Claude API credentials" note in chat | Set `ANTHROPIC_API_KEY` in `.env` and restart. Reports and recordings still work without it. |
| Phone cannot reach the server | Same Wi-Fi or Tailscale; firewall rule for port 8787; use the laptop IP, not `localhost`. See `docs/REMOTE_ACCESS.md`. |
| Phone does not work away from home | Install Tailscale on the laptop and phone, or open a Cloudflare tunnel from the Phone popup. `docs/REMOTE_ACCESS.md`. |
| A scheduled task never ran | Scheduled runs are skipped when there is no saved CMS session — reconnect under Tasks → Connect CMS. |
| Upload says "No booking rows found" | The export sheet has no recognisable columns; check the sheet has a Status/Progress column. |
| Escalation "not sent" | Channel is `draft` or the channel's settings in `.env` are incomplete; the packet is still saved. |
| Recorder shows nothing | Reload the CMS tab after installing the extension; it only records the tab where you pressed Start. |
