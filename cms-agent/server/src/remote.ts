import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { config } from "./config.js";

/**
 * Remote access so the phone works away from the Wi-Fi.
 *
 * Two supported routes:
 *
 *  1. Tailscale (recommended). Nothing here to do: install it on the laptop and
 *     the phone and the LAN address simply keeps working from anywhere. Private
 *     by construction — nothing is exposed to the internet.
 *  2. Cloudflare Tunnel. Foreman launches `cloudflared` and gets a public
 *     https://….trycloudflare.com address. That IS exposed to the internet, so
 *     it is refused unless a strong CMS_AGENT_TOKEN is set. Use it when you
 *     want a link that works on any device with nothing installed.
 */

export interface RemoteStatus {
  mode: "tailscale" | "tunnel" | "none";
  url?: string;
  tokenOk: boolean;
  cloudflaredInstalled: boolean;
  tailscaleIp?: string;
  error?: string;
  since?: string;
}

let proc: ChildProcess | undefined;
let tunnelUrl: string | undefined;
let tunnelError: string | undefined;
let since: string | undefined;

export const tokenIsStrong = (): boolean => Boolean(config.token && config.token.length >= 20);

function which(bin: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch { return false; }
}

/** Tailscale assigns a stable 100.x address; report it if the client is present and up. */
export function tailscaleIp(): string | undefined {
  if (!which("tailscale")) return undefined;
  try {
    const out = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8", timeout: 3000 }).trim().split("\n")[0];
    return /^100\./.test(out) ? out : undefined;
  } catch { return undefined; }
}

export function remoteStatus(): RemoteStatus {
  const ts = tailscaleIp();
  if (tunnelUrl) return { mode: "tunnel", url: tunnelUrl, tokenOk: tokenIsStrong(), cloudflaredInstalled: true, tailscaleIp: ts, since };
  if (ts) return { mode: "tailscale", url: `http://${ts}:${config.port}`, tokenOk: tokenIsStrong(), cloudflaredInstalled: which("cloudflared"), tailscaleIp: ts };
  return { mode: "none", tokenOk: tokenIsStrong(), cloudflaredInstalled: which("cloudflared"), error: tunnelError };
}

export async function startTunnel(): Promise<RemoteStatus> {
  if (tunnelUrl) return remoteStatus();
  if (!tokenIsStrong()) {
    throw new Error("Refusing to expose Foreman to the internet without a strong access token. Set CMS_AGENT_TOKEN in server/.env to at least 20 random characters (the installer generates one) and restart.");
  }
  if (!which("cloudflared")) {
    throw new Error("cloudflared is not installed. Windows: `winget install Cloudflare.cloudflared`. Mac: `brew install cloudflared`. Then try again. Or install Tailscale on the laptop and phone instead — no tunnel needed.");
  }
  tunnelError = undefined;
  proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${config.port}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
  const found = new Promise<string>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(chunk.toString());
      if (m) { resolve(m[0]); }
    };
    proc!.stdout?.on("data", onData);
    proc!.stderr?.on("data", onData);
    proc!.on("exit", (code) => reject(new Error(`cloudflared exited (code ${code}) before a URL was assigned`)));
    setTimeout(() => reject(new Error("cloudflared did not report a URL within 40 seconds")), 40_000);
  });
  try {
    tunnelUrl = await found;
    since = new Date().toISOString();
    proc.on("exit", () => { tunnelUrl = undefined; since = undefined; proc = undefined; });
  } catch (err) {
    tunnelError = (err as Error).message;
    proc?.kill();
    proc = undefined;
    throw err;
  }
  return remoteStatus();
}

export function stopTunnel(): RemoteStatus {
  proc?.kill();
  proc = undefined;
  tunnelUrl = undefined;
  since = undefined;
  return remoteStatus();
}

/** Best address for a device that is not on the LAN, if any. */
export function remoteUrl(): string | undefined {
  return remoteStatus().url;
}
