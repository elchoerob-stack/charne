import express, { Router } from "express";
import fs from "node:fs";
import { buildReport, getReport, listFiles, listReports, reportArtifact, storeFile, type ReportKind } from "./store.js";

export const reportRoutes = Router();

/** Upload a workbook as a raw body. Headers: X-File-Name, optional X-Dealer, X-Kind. Query ?build=1 builds immediately. */
reportRoutes.post("/files", express.raw({ type: () => true, limit: "80mb" }), (req, res) => {
  const name = decodeURIComponent(req.header("x-file-name") ?? "upload.xlsx");
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: "empty body" });
  try {
    const file = storeFile(name, buf, { mime: req.header("content-type") ?? undefined, dealer: req.header("x-dealer") || undefined, kind: req.header("x-kind") || undefined });
    if (req.query.build) {
      const kind = (req.query.kind as ReportKind | undefined) ?? (file.kind === "contacts" ? "campaign" : "workshop");
      const built = buildReport(file.id, kind, { dealer: file.dealer ?? undefined });
      return res.status(201).json({ file, report: built.report, warnings: built.warnings });
    }
    res.status(201).json({ file });
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
  }
});

reportRoutes.get("/files", (_req, res) => res.json(listFiles()));

reportRoutes.post("/reports/build", (req, res) => {
  const { file_id, kind, title, dealer } = req.body ?? {};
  if (!file_id) return res.status(400).json({ error: "file_id required" });
  try {
    const built = buildReport(String(file_id), kind === "campaign" || kind === "workshop" ? kind : undefined, { title, dealer });
    res.status(201).json({ report: built.report, warnings: built.warnings });
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
  }
});

reportRoutes.get("/reports", (req, res) => res.json(listReports(req.query.kind === "workshop" || req.query.kind === "campaign" ? req.query.kind : undefined)));

reportRoutes.get("/reports/:id", (req, res) => {
  const r = getReport(req.params.id);
  if (!r) return res.status(404).json({ error: "not found" });
  res.json({ ...r, summary: JSON.parse(r.summary) });
});

reportRoutes.get("/reports/:id/:artifact(html|xlsx|sms.csv|email.csv)", (req, res) => {
  const p = reportArtifact(req.params.id, req.params.artifact as "html");
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: "not found" });
  const r = getReport(req.params.id)!;
  const base = r.title.replace(/[^A-Za-z0-9]+/g, "_");
  if (req.params.artifact === "html") return res.type("html").send(fs.readFileSync(p, "utf8"));
  if (req.params.artifact === "xlsx") { res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`); return res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(fs.readFileSync(p)); }
  res.setHeader("Content-Disposition", `attachment; filename="${base}_${req.params.artifact}"`);
  res.type("text/csv").send(fs.readFileSync(p, "utf8"));
});
