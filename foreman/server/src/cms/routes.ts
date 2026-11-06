import { Router } from "express";
import { listTasks } from "../tasks/store.js";
import { ACTIONS, ACTION_IDS, INPUT_KEYS, bindingIssues, deleteBinding, getBinding, saveBinding, suggestBinding, type InputKey, type UserAction } from "./bindings.js";

/** Set-up for the CMS admin workers: which recorded workflow does which job. */
export const cmsRoutes = Router();

cmsRoutes.get("/cms/workflows", (_req, res) => {
  const tasks = listTasks();
  res.json({
    actions: ACTION_IDS.map((a) => {
      const b = getBinding(a);
      return { action: a, ...ACTIONS[a], binding: b ?? null, issues: b ? bindingIssues(b) : null, usable: b ? bindingIssues(b).errors.length === 0 : false };
    }),
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, startUrl: t.startUrl,
      steps: t.steps.map((s) => ({ n: s.n, action: s.action, text: s.text })),
      variables: t.variables.map((v) => ({ name: v.name, label: v.label, example: v.sensitive ? "" : v.example, sensitive: Boolean(v.sensitive) })),
      suggestion: suggestBinding(t),
    })),
  });
});

cmsRoutes.put("/cms/workflows/:action", (req, res) => {
  const action = req.params.action as UserAction;
  if (!ACTION_IDS.includes(action)) return res.status(404).json({ error: "Unknown job type" });
  const { taskId, commitStep, fieldMap, expectText } = req.body ?? {};
  if (typeof taskId !== "string" || !Number.isInteger(commitStep)) return res.status(400).json({ error: "taskId and commitStep (a step number) are required" });
  const map: Partial<Record<InputKey, string>> = {};
  for (const k of INPUT_KEYS) if (fieldMap && typeof fieldMap[k] === "string" && fieldMap[k]) map[k] = fieldMap[k];
  const candidate = { action, taskId, commitStep: Number(commitStep), fieldMap: map, expectText: typeof expectText === "string" ? expectText : "" };
  const issues = bindingIssues(candidate);
  if (issues.errors.length) return res.status(400).json({ error: issues.errors[0], issues });
  res.json({ binding: saveBinding(candidate), issues });
});

cmsRoutes.delete("/cms/workflows/:action", (req, res) => res.json({ removed: deleteBinding(req.params.action) }));
