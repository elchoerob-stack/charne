import type { Capability } from "./types.js";

/**
 * Every worker registers what it can do here. The CEO plans against this list
 * and nothing else.
 */
export class Registry {
  private caps = new Map<string, Capability>();

  register(...caps: Capability[]): this {
    for (const c of caps) {
      if (!/^[a-z_]+\.[a-z_]+$/.test(c.id)) throw new Error(`Capability id "${c.id}" must look like worker.action`);
      if (this.caps.has(c.id)) throw new Error(`Capability "${c.id}" is registered twice`);
      if (c.available && !c.run) throw new Error(`Capability "${c.id}" is marked available but has no run()`);
      this.caps.set(c.id, c);
    }
    return this;
  }

  get(id: string): Capability | undefined { return this.caps.get(id); }
  all(): Capability[] { return [...this.caps.values()]; }
  available(): Capability[] { return this.all().filter((c) => c.available); }

  /** What the CEO is shown. Plain text so the model reads it the way a person would. */
  describe(): string {
    return this.all().map((c) => {
      const inputs = Object.entries(c.inputs).map(([k, v]) => `    - ${k}${v.required ? " (required)" : ""}: ${v.description}`).join("\n");
      return `${c.id} — ${c.available ? "" : "[NOT BUILT YET, cannot be used] "}${c.title}\n  ${c.description}\n  Changes things outside Foreman: ${c.risk === "changes_data" ? "yes, needs approval" : "no"}\n  Inputs:\n${inputs || "    (none)"}`;
    }).join("\n\n");
  }
}
