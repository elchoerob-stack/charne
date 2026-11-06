import { complete, createTicket, fillFields, importTicket, intake, redraft } from "../../support/service.js";
import type { Capability } from "../types.js";

/**
 * The Support Agent as a worker. Each step is one of the support desk's own
 * operations, so the Shell can never do anything the support page cannot, and
 * the support page's rules (one ticket per job, close only when the four
 * required fields are filled, nothing guessed) apply unchanged.
 *
 * Steps hand work to each other through `jobId`: triage or load_ticket produce
 * it, the rest consume it.
 */

const jobId = { description: "The support job to act on, normally {{sN.jobId}} from an earlier triage or load_ticket step", required: true };
const view = (j: Awaited<ReturnType<typeof intake>>) => ({
  jobId: j.id,
  category: j.classification.category,
  summary: j.classification.summary,
  dealers: j.classification.dealers,
  group: j.classification.group ?? null,
  missing: j.classification.missing,
  ticket: j.ticket?.key ?? null,
});

export const supportCapabilities: Capability[] = [
  {
    id: "support.triage", worker: "support", title: "Read a client e-mail", risk: "read_only", available: true,
    description: "Reads a pasted client e-mail: works out what kind of job it is, which dealers and group, what was asked and what is missing. Changes nothing outside Foreman. Gives back a jobId.",
    inputs: { email: { description: "The full text of the client's e-mail", required: true } },
    run: async (i) => view(await intake(i.email)),
  },
  {
    id: "support.load_ticket", worker: "support", title: "Load an existing Jira ticket", risk: "read_only", available: true,
    description: "Reads a Jira ticket that already exists (the desk makes one from each client e-mail) and sorts it. Read-only. Gives back a jobId.",
    inputs: { key: { description: "The ticket key, e.g. CS-259412, or its link", required: true } },
    lockKey: (i) => `ticket:${(i.key ?? "").toUpperCase()}`,
    run: async (i) => view(await importTicket(i.key)),
  },
  {
    id: "support.create_ticket", worker: "support", title: "Create the Jira ticket", risk: "changes_data", available: true,
    description: "Creates the ticket in Jira and assigns it to the operator. Only for e-mails that have no ticket yet (a loaded ticket already has one). Never makes a second ticket for the same job.",
    inputs: { jobId },
    lockKey: (i) => `support:${i.jobId}`,
    run: async (i) => { const j = await createTicket(i.jobId); return { ticket: j.ticket?.key ?? null, url: j.ticket?.url ?? null, warnings: j.warnings }; },
  },
  {
    id: "support.fill_fields", worker: "support", title: "Fill the required Jira fields", risk: "changes_data", available: true,
    description: "Sets Assignee, Support Agent, Support Enquiry and Group and Dealership on the ticket, only where exactly one allowed value matches. Stops and says so if the dealer is not clear (for example a ticket naming several dealers), rather than guessing.",
    inputs: { jobId },
    lockKey: (i) => `support:${i.jobId}`,
    run: async (i) => { const r = await fillFields(i.jobId, {}); return { written: r.written, complete: r.status.complete, stillEmpty: r.status.missing }; },
  },
  {
    id: "support.draft_reply", worker: "support", title: "Draft the reply to the client", risk: "read_only", available: true,
    description: "Writes the reply e-mail for the operator to copy into the shared inbox. It is only a draft and is never sent.",
    inputs: { jobId, instruction: { description: "Optional: how to change the draft, e.g. 'shorter'" } },
    lockKey: (i) => `support:${i.jobId}`,
    run: async (i) => { const j = await redraft(i.jobId, i.instruction || undefined); return { reply: j.reply?.text ?? "", source: j.reply?.source ?? null }; },
  },
  {
    id: "support.close_ticket", worker: "support", title: "Close the Jira ticket", risk: "changes_data", available: true,
    description: "Closes the ticket in Jira and marks the job done. Refused by Jira rules unless Assignee, Support Agent, Support Enquiry and Group and Dealership are all filled. Only once the work itself is finished.",
    inputs: { jobId, note: { description: "Optional comment to add to the ticket before closing" } },
    lockKey: (i) => `support:${i.jobId}`,
    run: async (i) => { const j = await complete(i.jobId, { note: i.note || undefined }); return { status: j.status, ticket: j.ticket?.key ?? null }; },
  },
];
