# CMS admin user worker

Create a user, change a user, or deactivate one, in CMS admin, without you
touching a keyboard or mouse. It works in a browser of its own, in the
background, and **shows you the filled-in form before anything is saved.**

> **Read this first.** Foreman has never seen your CMS admin. Everything below
> was tested against a stand-in admin page, not your real one. Expect to
> supervise the first few real runs, with a test user, before you trust it.

## How it works

You don't describe CMS admin to Foreman. You **record yourself doing each job
once**, and Foreman repeats it with different data. Three jobs, three recordings:
create a user, change a user, deactivate a user. See `docs/TASKS.md` for
recording and "Make a task".

Then on `/workflows.html` you tell Foreman, per job:

1. which recorded task it is;
2. **which step presses Save** (it suggests the likely one);
3. which field holds the dealer, name, e-mail and role (it suggests these too);
4. **what message CMS shows when the save worked**, e.g. "User saved successfully".

The page won't accept a workflow until these are sensible: the Save step must
be a click, every field a job needs must be connected, a field that was masked
when you recorded (e-mail addresses usually are) must be connected to an input,
and the success message can't be blank.

## What happens on a job

A client e-mail says "please set up Thabo Dlamini, thabo@…, as a service advisor
at Suzuki Boksburg". Claude reads it and plans a "create user" step with those
details. **If anything is missing (no role, a mistyped e-mail) it asks you
instead of guessing.** Then:

1. **Preview, automatically, before you're asked anything.** The browser runs
   your recorded steps up to, but not including, Save. Foreman reads back every
   editable field on the form and takes a screenshot. **Nothing has been saved.**
   You see the form as it really stands: your typed values, and any default CMS
   pre-filled that you didn't choose.
2. **You approve** (on the Command screen, or via Claude if you have allowed
   that). Approve is locked until the preview has worked.
3. **Apply.** The workflow runs again. **Just before Save it reads the form again,
   and if anything differs from what you approved (a value changed, a field
   appeared or vanished) it stops without saving.** It presses Save, then checks
   the page for an error ("that user already exists" and so on), then requires
   your success message to appear.
4. **Done only if CMS said so.** If Save was pressed but the message never appeared,
   the step *fails* with "could not be confirmed: check CMS admin", and nothing
   after it runs. A client is never told "your user is set up" on a hope.

## Things you must know

- **Nothing before the Save step may save anything.** The preview runs those
  steps for real. If your CMS auto-saves a draft, or a "Next" button creates the
  record, the preview would create it. Record the job so the first persisting
  action is the Save step, and do your first runs with a test user.
- **It does not make decisions.** There is no "if the user already exists, change
  them instead". That's why there are three separate jobs. A "create" for someone
  who exists will fail with CMS's own error, or the preview will show it.
- **Dropdown values must match.** The dealer and role are chosen by their text
  in CMS. If the client writes "Service Advisor" and CMS says "Service advisor"
  it still matches; if they write "Advisor" it may not, and the preview will show
  what was actually selected. Check it.
- **Sign in once a day.** Foreman uses the sign-in you give it under **Sites** and
  never sees your password. If it has expired, the preview fails with "asking for
  a login" and approving is blocked until you sign in and retry the preview.
- **One browser job at a time.** They queue, so two never fight over the same CMS
  session. A step that takes too long (5 minutes) is stopped.
- **If it can't tell whether it saved**, check CMS admin before retrying.
  Retrying a change asks for approval again and previews again.

## Your data

The e-mail address, name and role you're setting up are stored in Foreman's
local database (the job and its inputs) and in the form screenshot, which is
kept in Foreman's screenshots folder on this computer. Nothing is sent anywhere
by this worker. (Claude sees them only because it planned the step from the
e-mail, or if you instruct Foreman from Claude.)

## Not covered yet

Dealer settings, building a new dealer, and adding a product to a dealer are
still to do; they'd use the same preview-then-approve mechanism with their own
recordings.
