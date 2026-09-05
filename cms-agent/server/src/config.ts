import "dotenv/config";
import path from "node:path";
import { dataDir } from "./paths.js";

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return !["0", "off", "false", "no"].includes(value.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  dbPath: process.env.CMS_AGENT_DB ?? path.join(dataDir(), "cms-agent.db"),
  webSearch: flag(process.env.WEB_SEARCH, true),
  token: process.env.CMS_AGENT_TOKEN || undefined,
  /** Loopback only unless asked otherwise: a laptop on dealer Wi-Fi is not a safe place to listen on every interface. */
  bindHost: process.env.FOREMAN_BIND || (process.env.FOREMAN_LAN ? "0.0.0.0" : "127.0.0.1"),
  evolveHealthUrl: process.env.EVOLVE_HEALTH_URL || undefined,
  infomediaHealthUrl: process.env.INFOMEDIA_HEALTH_URL || undefined,
  /** Hard ceiling on tool-use iterations per turn, per mode. */
  maxIterations: { quick: 6, think: 12, deep: 24, council: 16 } as const,
};

export type AgentMode = keyof typeof config.maxIterations;

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && value in config.maxIterations;
}
