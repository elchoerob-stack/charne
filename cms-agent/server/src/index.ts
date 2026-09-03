import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { apiRoutes } from "./routes.js";
import { recorderRoutes } from "./recorder/routes.js";
import { reportRoutes } from "./reports/routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "60mb" })); // recordings carry screenshots

if (config.token) {
  app.use("/api", (req, res, next) => {
    const auth = req.header("authorization") ?? "";
    if (auth === `Bearer ${config.token}`) return next();
    res.status(401).json({ error: "unauthorised" });
  });
}

app.use("/api", apiRoutes);
app.use("/api", recorderRoutes);
app.use("/api", reportRoutes);

// The console is a static single-page app in ../web (served from dist or src).
const webDir = [path.join(here, "../../web"), path.join(here, "../web")].find((p) => p) as string;
app.use(express.static(webDir));

app.listen(config.port, () => {
  console.log(`Foreman (CMS Agent) listening on http://localhost:${config.port}  (model ${config.model})`);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("No ANTHROPIC_API_KEY set: the SDK will look for an `ant auth login` profile. Chat will fail without credentials; recordings, SOPs and /api/diagnose still work.");
  }
});
