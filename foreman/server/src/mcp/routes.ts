import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, type McpOptions } from "./server.js";

/**
 * The Claude connector endpoint (MCP over Streamable HTTP).
 *
 *   POST /mcp                 with  Authorization: Bearer <MCP_TOKEN>
 *   POST /mcp/<MCP_TOKEN>     for connectors that can only be given a URL (claude.ai, the phone app)
 *
 * It has its OWN token, never Foreman's master access code. A connector link
 * ends up in places a password should not (app settings, screenshots, chat),
 * and if it leaks it must not be able to reach the rest of the API. What a
 * leaked connector token can do is exactly what the tools can do: submit jobs
 * and read them. It cannot approve unless MCP_ALLOW_APPROVE is on.
 *
 * Stateless: every request is self-contained, so a restart or a changing
 * tunnel address never leaves a stale session behind.
 */

export interface McpRouterOptions extends McpOptions {
  /** The secret. Under 20 characters, or unset, switches the endpoint off. */
  token?: string;
  /** Failed attempts allowed per address per minute before it is blocked. */
  maxFailures?: number;
  now?: () => number;
}

const digest = (s: string) => crypto.createHash("sha256").update(s).digest();
export const safeEqual = (a: string, b: string): boolean => crypto.timingSafeEqual(digest(a), digest(b));

export function createMcpRouter(opts: McpRouterOptions): Router {
  const router = Router();
  const now = opts.now ?? Date.now;
  const maxFailures = opts.maxFailures ?? 10;
  const failures = new Map<string, { n: number; resetAt: number }>();

  const deny = (res: Response, status: number, message: string) => res.status(status).json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null });

  async function handle(req: Request, res: Response) {
    if (!opts.token || opts.token.length < 20) return res.status(404).json({ error: "The Claude connector is switched off. Set MCP_TOKEN (at least 20 characters) in server/.env and restart Foreman." });

    const ip = req.ip ?? "unknown";
    const rec = failures.get(ip);
    if (rec && rec.resetAt > now() && rec.n >= maxFailures) return deny(res, 429, "Too many wrong attempts. Wait a minute.");

    const header = req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : typeof req.params.token === "string" ? req.params.token : "";
    if (!presented || !safeEqual(presented, opts.token)) {
      const cur = rec && rec.resetAt > now() ? rec : { n: 0, resetAt: now() + 60_000 };
      cur.n++; failures.set(ip, cur);
      return deny(res, 401, "Unauthorised");
    }
    failures.delete(ip);

    if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });

    const server = buildMcpServer(opts);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("mcp:", (err as Error).message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }

  router.all("/mcp", handle);
  router.all("/mcp/:token", handle);
  return router;
}
