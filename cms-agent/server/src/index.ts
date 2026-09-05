import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { apiRoutes } from "./routes.js";
import { recorderRoutes } from "./recorder/routes.js";
import { reportRoutes } from "./reports/routes.js";
import { reviewRoutes } from "./review.js";
import { taskRoutes } from "./tasks/routes.js";
import { boardRoutes, tickAgents } from "./tasks/board-routes.js";
import { startScheduler } from "./tasks/scheduler.js";
import { listTasks } from "./tasks/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "60mb" })); // recordings carry screenshots

if (config.token) {
  // Accept the token as a bearer header (extension, scripts), a cookie (console and
  // plain download links), or a ?token= query parameter (first visit from the phone).
  app.use("/api", (req, res, next) => {
    const auth = req.header("authorization") ?? "";
    const cookie = /(?:^|;\s*)foreman_token=([^;]+)/.exec(req.header("cookie") ?? "")?.[1];
    const query = typeof req.query.token === "string" ? req.query.token : undefined;
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : cookie ? decodeURIComponent(cookie) : query;
    if (presented === config.token) return next();
    res.status(401).json({ error: "unauthorised", hint: "Send Authorization: Bearer <CMS_AGENT_TOKEN>, or enter the token in the console." });
  });
}

app.use("/api", apiRoutes);
app.use("/api", recorderRoutes);
app.use("/api", reportRoutes);
app.use("/api", reviewRoutes);
app.use("/api", taskRoutes);
app.use("/api", boardRoutes);

// The console is a static single-page app in ../web (served from dist or src).
const webDir = [path.join(here, "../../web"), path.join(here, "../web")].find((p) => p) as string;
app.use(express.static(webDir));

// Time-based triggers for tasks and agents. Runs every 30 s; a due task or
// agent is queued exactly once and its schedule rolled forward.
startScheduler(listTasks);
setInterval(() => { try { tickAgents(); } catch (err) { console.error("agent tick failed:", (err as Error).message); } }, 30_000).unref();

app.listen(config.port, () => {
  console.log(`Foreman listening on http://localhost:${config.port}  (model ${config.model})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("No ANTHROPIC_API_KEY set: the SDK will look for an `ant auth login` profile. Chat will fail without credentials; recordings, SOPs and /api/diagnose still work.");
  }
});
