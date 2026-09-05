# Tasks: record a job once, then let Foreman do it

This is the part that makes Foreman a worker rather than an advisor.

## The idea

You already do the job correctly. Rather than describing it to a machine in
some rule language, you just **do it once with the recorder running**. Foreman
turns that single performance into something it can repeat on demand, with
different data, in the background, while you get on with something else.

```
record a job  →  make a task  →  run it (once, or once per row)  →  it works while you work
```

## Step by step

1. **Record the job.** Open the CMS screen where the job starts, click the
   recorder extension, give it a title, press Start, do the job normally,
   press Stop, then Send to CMS Agent.
2. **Make a task.** In the console under **Recordings**, press **Make a task**.
   Foreman compiles the recording: it throws away the scrolling and the
   mis-clicks, collapses your typing into one value per field, and lifts every
   value you typed into a **named field** you can change per run.
3. **Connect CMS once.** The first run asks you to connect. A browser opens,
   you log into CMS as normal, and Foreman keeps *only the session cookie*.
   Your password is never stored, never seen, and never sent anywhere.
4. **Run it.** Press Run. You get the fields from the recording, pre-filled
   with what you typed the first time. Change them, press Start, and the run
   goes into the background queue. Carry on working — check on it under
   **Work** whenever you like.

## Running it over a list

The same task can be run once per row of data: one booking per line, one quote
per vehicle. Each row becomes its own run in the queue, and they execute one
at a time on purpose — two browsers driving the same CMS session at once is a
reliable way to create duplicate bookings.

## What makes it hold up

A recorded macro usually breaks the first time the page changes. Two things
stop that here:

- **Several ways to find every element.** Each step remembers the test id, the
  role and accessible name, the label, the placeholder, the id, the visible
  text, and the CSS path. They are tried cheapest and most stable first. A
  redesign that renames every id but keeps the visible labels changes nothing —
  this is covered by a test that replays a booking against a deliberately
  rebuilt page.
- **Claude repairs what the fallbacks cannot.** When no strategy matches,
  Foreman sends Claude the interactive elements currently on the page and asks
  which one the step meant. If Claude is confident it retries and **writes the
  repair back onto the task**, so the fix sticks for every future run. If it is
  not confident it stops rather than guessing — a wrong click in a live
  dealership system creates real bookings and real invoices.

## The safety rails

These are deliberate, and worth knowing about:

- **A run stops if CMS shows a login screen.** That means the saved session
  expired. Better to stop than to type a customer name into a password box.
- **Masked fields must be supplied every run.** Anything the recorder masked
  for POPIA (ID numbers, phone numbers, e-mail addresses) is never carried
  into the task, so it cannot silently reuse someone else's personal data.
- **Practice run** walks the steps and touches nothing, so you can check a task
  is sane before it acts for real.
- **Watch it happen** shows the browser instead of hiding it, for when you want
  to see what it is actually doing.
- **Every run keeps a log** with a screenshot at the point of failure.

## Signing in to sites

Foreman works across as many sites as you sign it into — the system you start
in, the one you pull a number from, the one you file the result in. Add each
under **Sites**: a real browser opens, you sign in, and only the session cookie
is kept. Passwords are typed into a real browser and never reach Foreman.

Cookie jars go stale. When one does, a run stops at the login screen rather
than blundering on, and the Sites panel flags anything older than two weeks.

## Where documents go

Anything a task downloads or writes is saved to your machine, in a folder per
task and run, under whatever you set as `WORKSPACE_DIR` (a "Foreman" folder in
your home directory by default — point it at your Desktop or a synced drive).
Each run lists the files it produced.

## Which browser it drives

Foreman drives a browser separate from your own, so your Chrome stays yours.
You almost certainly already have Chrome installed, so put this in
`server/.env` and skip downloading a second browser:

```
BROWSER_CHANNEL=chrome
```

Alternatively `BROWSER_PATH=C:\path\to\chrome.exe`, or run `npm run browser`
once to fetch Playwright's own Chromium.

## Honest limits

- It drives **web pages**. Desktop programs and phone apps are not driven.
- It has been proven end to end against test pages, **not yet against a live
  system you use daily**. Expect to record a real job and adjust a step or two
  the first time.
- Nothing is scheduled yet: runs start when you press Run. A cron trigger is a
  small addition on the same queue.
- One run at a time, by design.
