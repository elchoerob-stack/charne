import type { FormField } from "./types.js";

/**
 * Reading and comparing the form on screen.
 *
 * This is what makes "approve before the final Save" mean something: the person
 * is shown the fields as they really stand in the browser, not what Foreman
 * hopes it typed. At apply time the form is read again and must still match,
 * and anything that has changed in between (a new pre-filled default, a field
 * that has moved) stops the save rather than saving something nobody saw.
 */

export const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/*
 * The two scripts below run inside the page, so they are plain text rather than
 * functions. A function written here would be rewritten by the build tools (they
 * add helpers such as __name) and then fail in the browser, where those helpers
 * do not exist.
 */
const READ_FORM = `(() => {
  const out = [];
  const seenRadio = new Set();
  const text = (n) => ((n && n.textContent) || "").replace(/\\s+/g, " ").trim();
  const skip = ["hidden", "password", "submit", "button", "image", "reset", "file"];
  for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
    const type = (el.getAttribute("type") || el.tagName).toLowerCase();
    if (skip.includes(type)) continue;
    if (el.disabled || el.readOnly) continue;
    if (!el.getClientRects().length) continue;
    const forLabel = el.id ? text(document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) : "";
    const label = el.getAttribute("aria-label") || forLabel || text(el.closest("label")) || el.getAttribute("placeholder") || el.getAttribute("name") || el.id || type;
    let value;
    if (el.tagName === "SELECT") value = el.selectedOptions && el.selectedOptions[0] ? text(el.selectedOptions[0]) : "";
    else if (type === "checkbox") value = el.checked ? "checked" : "unchecked";
    else if (type === "radio") {
      const group = el.name || label;
      if (!el.checked || seenRadio.has(group)) continue;
      seenRadio.add(group);
      out.push({ label: group, value: text(el.closest("label")) || el.value });
      continue;
    } else value = String(el.value == null ? "" : el.value);
    out.push({ label: label.slice(0, 80), value: value.slice(0, 200) });
    if (out.length >= 60) break;
  }
  return out;
})()`;

const FIND_ERRORS = `(() => {
  const sel = '[role="alert"], .alert-danger, .alert-error, .error-message, .field-validation-error, .validation-summary-errors, .toast-error, .Toastify__toast--error, .notification-error, [class*="error-message"]';
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (!el.getClientRects().length) continue;
    const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (t) seen.add(t.slice(0, 200));
  }
  return Array.from(seen).slice(0, 3);
})()`;

/**
 * Every editable control the person could see and change: what it is called
 * and what it holds. Passwords, hidden, read-only and disabled controls are left
 * out: they are not what was chosen, and some change on their own.
 */
export async function readForm(page: any): Promise<FormField[]> {
  return page.evaluate(READ_FORM);
}

/** Messages the page is showing that mean "that did not work". Conservative: only the usual error containers. */
export async function findErrors(page: any): Promise<string[]> {
  return page.evaluate(FIND_ERRORS);
}

/** Keys a field by its label and which of that label it is, so two "Name" boxes do not collapse into one. Keeps the label as the page shows it. */
function keyed(fields: FormField[]): Map<string, FormField> {
  const count = new Map<string, number>();
  const m = new Map<string, FormField>();
  for (const f of fields) {
    const l = norm(f.label);
    const n = (count.get(l) ?? 0) + 1; count.set(l, n);
    m.set(`${l}#${n}`, f);
  }
  return m;
}

/**
 * What is different between the form as approved and the form as it now stands.
 * Empty means they match. Both directions count: a field that has changed,
 * vanished, or turned up with a value nobody chose.
 */
export function compareForms(approved: FormField[], now: FormField[]): string[] {
  const a = keyed(approved), b = keyed(now);
  const diffs: string[] = [];
  for (const [k, f] of a) {
    const g = b.get(k);
    if (!g) { if (norm(f.value)) diffs.push(`"${f.label}" is no longer on the form (it held "${f.value}")`); continue; }
    if (norm(g.value) !== norm(f.value)) diffs.push(`"${f.label}" was "${f.value}" and is now "${g.value}"`);
  }
  for (const [k, g] of b) if (!a.has(k) && norm(g.value)) diffs.push(`"${g.label}" has appeared with "${g.value}"`);
  return diffs;
}
