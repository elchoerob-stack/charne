# Support desk

Paste a client e-mail; Foreman sorts it, drafts the reply, and keeps the Jira
ticket in step. Open it at `/support.html` (the **Support** button in the
console and on the board).

```
paste e-mail → Sort it → [you check] → Approve → ticket created + assigned to you
                                                      │
                          copy the draft reply ◄──────┘     work happens
                                                      │
                          Work is done → ticket closed → Archive
```

## Two ways in

- **Paste an e-mail** from the shared inbox, for work that has no ticket yet.
- **Load a ticket** (`CS-259412`, or paste the link) for e-mails the desk has
  already turned into tickets. Loading only reads the ticket: it takes who
  raised it and what they wrote, sorts it the same way, and changes nothing in
  Jira. Loading the same ticket twice gives the same job.

## What it does for you

1. **Sorts the e-mail** into one of: how-to question, user profile, dealer
   settings, new dealer, add a product, lead aggregator, other. It pulls out
   the dealers (several means a multi-dealer job), the group, who it is from,
   what was asked, and **what is missing** before the work could safely start
   (a user with no role, a dealer with no VAT number).
2. **Proposes a ticket.** You can correct the type, title, dealers and group,
   and press *Preview the ticket* to see exactly what will be sent.
3. **Creates it only when you press Approve.** The ticket is created in your
   Jira project, assigned to you, and tagged Product Support plus the group.
4. **Drafts the reply** to the client, in your voice. It is never sent: copy it
   into the shared inbox. Once the ticket exists the draft carries its
   reference; when the work is done it says so.
5. **Checks the required fields, then closes the ticket** when you press
   *Work is done*, then lets you archive.

## The four things required before a ticket can close

The CMS desk requires **Assignee, Support Agent, Support Enquiry, and Group and
Dealership** on every closed ticket. Foreman finds those fields in Jira by
name, reads their allowed values, and shows each one in a **Required before
closing** panel:

| Field | What Foreman proposes |
|---|---|
| Assignee, Support Agent | You (whoever owns the API token) |
| Support Enquiry | `JIRA_ENQUIRY_VALUE`, default "Product Support" |
| Group and Dealership | The group and dealership named in the e-mail, only when exactly one allowed value matches |

Press **Fill these in Jira** to write them. Closing is **refused** while any
of the four is empty, and says which. A field is never overwritten once it has
a value unless you choose another.

**Nothing is guessed.** If the dealership is not in Jira's list, or the ticket
names several dealerships (one e-mail about five dealers is common), the field
is left for you with every allowed value available to type-ahead and choose.
Closing a multi-dealer ticket therefore always involves your pick.

## The safety rules

- Pasting an e-mail creates nothing anywhere. Only **Approve** touches Jira.
- A job gets one ticket. Pressing Approve twice never makes a second.
- A job only becomes *done* after Jira has accepted the close. If Jira refuses
  (wrong transition name, no permission), the job stays open and says why.
- Whether a job "changes data" is decided by its type, never by what the model
  says about itself, so a mis-sorted request cannot lower its own guard.
- The reply only gives system instructions found in the knowledge base. Where
  it has nothing, it writes `[NEEDS ANSWER: …]` instead of inventing steps.
- Only a finished job can be archived. Every action is written to an audit log.
- The e-mail text is treated as data: instructions written inside it are
  ignored, and it is never inserted into the page as markup.
- With no Claude credentials it still works: a keyword sort and a template
  reply, clearly labelled as such.

## Setting up Jira

Put these in `server/.env` (see `.env.example`) and restart:

| Setting | Meaning |
|---|---|
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | Your Jira Cloud site, login and project. The token is created at id.atlassian.com → Security → API tokens. |
| `JIRA_ENQUIRY_VALUE` | What goes in Support Enquiry. Default `Product Support`. |
| `JIRA_AGENT_FIELD`, `JIRA_ENQUIRY_FIELD`, `JIRA_GROUP_FIELD` | Only if your desk names the required fields differently. Defaults: Support Agent, Support Enquiry, Group and Dealership. |
| `JIRA_DONE_TRANSITION` | The transition that closes a ticket. Default `Done`. |
| `JIRA_SUPPORT_TAG`, `JIRA_GROUP_TAG` | Optional. Tag tickets Foreman creates itself at creation. Not needed for the required fields above. |

A missing transition lists the ones that exist, and a required field that is
not on the ticket's edit screen is reported by name rather than skipped.

## Not built yet

This stage is the paperwork. The jobs that change CMS admin (create a user,
change dealer settings, add a product) are still done by you; the next stage
connects each job type to a recorded workflow that runs in its own browser and
**stops for your approval before the final save**.

Foreman also has no way to read the shared inbox, so the e-mail is pasted in.
