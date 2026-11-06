import { Router } from "express";
import { config } from "../config.js";
import { remoteStatus } from "../remote.js";

/**
 * What the Command screen shows under "Connect Claude": the connector address
 * and, honestly, who can reach it. Behind the master access code, because it
 * contains the connector token.
 */
export const mcpInfoRoutes = Router();

mcpInfoRoutes.get("/mcp/info", (_req, res) => {
  const token = process.env.MCP_TOKEN;
  const enabled = Boolean(token && token.length >= 20);
  const publicBase = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const r = remoteStatus();
  const remote = publicBase ? { kind: "public" as const, url: publicBase } : r.mode === "tunnel" && r.url ? { kind: "tunnel" as const, url: r.url } : r.mode === "tailscale" && r.url ? { kind: "tailscale" as const, url: r.url } : undefined;
  res.json({
    enabled,
    allowApprove: process.env.MCP_ALLOW_APPROVE === "1",
    local: enabled ? `http://localhost:${config.port}/mcp/${token}` : undefined,
    remote: enabled && remote ? { ...remote, mcp: `${remote.url}/mcp/${token}`,
      // Claude's own apps call from Anthropic's servers, so only a public https address is reachable by them. Tailscale is private to your devices.
      reachableFromClaudeApps: remote.kind !== "tailscale" && remote.url.startsWith("https://") } : undefined,
    claudeCode: enabled ? `claude mcp add --transport http foreman http://localhost:${config.port}/mcp --header "Authorization: Bearer ${token}"` : undefined,
  });
});
