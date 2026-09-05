# Agents, scheduling and the task board

Three pieces that turn a pile of recorded tasks into something that runs the
day without you.

## The task board (`/board.html`)

Five lanes. **Drag a card and the drop does the real thing** — it is not a
decoration on top of a separate settings screen:

| Lane | What dropping a card here does |
|---|---|
| **To do** | The manual lane. Any schedule is switched off. |
| **Scheduled** | Switches the schedule on and works out the next run. A task with no schedule yet opens the schedule editor instead of silently doing nothing. |
| **Paused** | Keeps the schedule but stops it firing. |
| **Done** / **Needs attention** | Outcome lanes, filled in from the last run. |

Dragging uses pointer events rather than HTML5 drag-and-drop, so it works with
a thumb on the S25+ as well as a mouse. Position within a lane is saved, so the
order you put things in is the order you see next time.

## Scheduling

Set on any task (⏰ Schedule) or on an agent. Four shapes:

- **Daily** at a time
- **Weekly** on chosen weekdays at a time
- **Every N minutes**
- **Cron**, the standard five fields (`minute hour day month weekday`), with
  lists, ranges and steps: `30 7 * * 1-5` is 07:30 on weekdays

Times are **wall-clock in Africa/Johannesburg**, not UTC. "Daily at 08:00"
fires at 08:00 in Centurion whether or not the laptop's clock agrees, and the
tests pin this: 08:00 SAST is asserted to be `06:00Z`.

A schedule can carry its own data, so a nightly task runs with the values you
want rather than whatever happened to be recorded.

The scheduler ticks every 30 seconds. A due task is queued exactly once and
its schedule is immediately rolled forward, so a slow run cannot cause a
double fire. **If there is no saved CMS session, a scheduled run is skipped
rather than started** — it would only stop at the login screen.

## Agents

An agent is a named worker: a name, a plain-language brief, the tasks it owns
in order, and optionally a schedule.

Running one executes its tasks in order, then **Claude writes the report** —
two to five lines saying what got done, what did not and why, and the one thing
to do next. The report lands on the board and in the chat, so you find out
without going looking. If Claude is unreachable the report falls back to a
plain per-task list rather than failing the run.

Options:

- **Stop at the first task that fails** — for sequences where step two is
  pointless if step one did not work.
- **Schedule** — the agent runs itself; think "Morning bookings, weekdays at
  07:00, tell me what happened."

Example worth building first: an agent called *Morning bookings* with the
brief "Loads and confirms the day's service bookings before the workshop
opens", owning your booking task, scheduled weekdays at 07:00. You read the
report over coffee instead of doing the work.

## Honest limits

- Runs are sequential by design. Two browsers on one CMS session is how you
  get duplicate bookings.
- An agent's report costs a small Claude call per run.
- Scheduling has been proven against the test page and the API, not yet
  against live CMS on a real morning.
