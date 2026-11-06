import type { Capability } from "../types.js";

/**
 * Workers that are specified but not built. They are registered so that the CEO
 * knows they exist and says "I can't do that yet" instead of improvising, or
 * quietly leaving that part of a request out.
 *
 * Each becomes real by supplying run() and setting available: true. Those that
 * change CMS admin will do it through a recorded browser workflow that stops
 * for approval before the final save.
 */

const todo = (id: string, title: string, description: string, inputs: Capability["inputs"]): Capability => ({
  id, worker: id.split(".")[0], title, description, inputs, risk: "changes_data", available: false,
});

export const plannedCapabilities: Capability[] = [
  todo("cms_admin.manage_user", "Create, change or deactivate a user in CMS admin", "Creates or updates a user profile for a dealer in CMS admin.", {
    dealer: { description: "Dealer or branch", required: true }, name: { description: "The user's name", required: true }, email: { description: "The user's e-mail", required: true }, role: { description: "Role or access level", required: true },
  }),
  todo("cms_admin.update_dealer_settings", "Change settings for one or more dealers", "Applies a settings change to a list of dealers in CMS admin.", {
    dealers: { description: "The dealers to change", required: true }, change: { description: "What to change", required: true },
  }),
  todo("cms_admin.build_dealer", "Build a new dealer onto the system", "Sets up a brand-new dealer in CMS admin.", {
    dealer: { description: "Dealer name", required: true }, details: { description: "VAT, registration, address, brand", required: true },
  }),
  todo("cms_admin.add_product", "Add a product to an existing dealer", "Adds a product (stock, workshop, and so on) to a dealer already on the system.", {
    dealer: { description: "Dealer", required: true }, product: { description: "The product to add", required: true },
  }),
  todo("leads.activate_aggregator", "Activate a lead aggregator for a dealer", "Switches on a lead aggregator for a dealer, or requests its integration details.", {
    dealer: { description: "Dealer", required: true }, aggregator: { description: "Which aggregator", required: true },
  }),
];
