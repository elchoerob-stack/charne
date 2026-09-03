import { config } from "../config.js";

export type SystemName = "cms" | "evolve" | "infomedia" | "sms";
export type HealthState = "up" | "degraded" | "down";

export interface HealthResult {
  system: SystemName;
  state: HealthState;
  latencyMs?: number;
  detail: string;
  checkedAt: string;
  source: "live" | "simulated";
}

/**
 * Integration health adapters.
 *
 * With EVOLVE_HEALTH_URL / INFOMEDIA_HEALTH_URL configured the check is a real
 * HTTP GET with a timeout. Otherwise a simulated adapter answers, so the agent
 * and the diagnostic engine can be exercised end-to-end in a demo.
 *
 * Simulation is deterministic per 10-minute window so a demo can be reproduced:
 * pass `?force=down` style facts through the SIMULATED_STATE env var, e.g.
 * SIMULATED_STATE=evolve:down,sms:degraded
 */
export async function checkIntegration(system: SystemName): Promise<HealthResult> {
  const url = system === "evolve" ? config.evolveHealthUrl : system === "infomedia" ? config.infomediaHealthUrl : undefined;
  if (url) return liveCheck(system, url);
  return simulated(system);
}

async function liveCheck(system: SystemName, url: string): Promise<HealthResult> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const latencyMs = Date.now() - started;
    const state: HealthState = !res.ok ? "down" : latencyMs > 2500 ? "degraded" : "up";
    return { system, state, latencyMs, detail: `HTTP ${res.status} in ${latencyMs} ms`, checkedAt: new Date().toISOString(), source: "live" };
  } catch (err) {
    return { system, state: "down", latencyMs: Date.now() - started, detail: `request failed: ${(err as Error).message}`, checkedAt: new Date().toISOString(), source: "live" };
  } finally {
    clearTimeout(timer);
  }
}

function simulated(system: SystemName): HealthResult {
  const forced = (process.env.SIMULATED_STATE ?? "")
    .split(",")
    .map((s) => s.trim().split(":"))
    .find(([k]) => k === system)?.[1] as HealthState | undefined;
  const state: HealthState = forced ?? "up";
  const latencyMs = state === "up" ? 180 + (Date.now() % 90) : state === "degraded" ? 3200 : undefined;
  const detail = {
    up: `${label(system)} responded normally`,
    degraded: `${label(system)} is responding slowly; requests may time out`,
    down: `${label(system)} is not reachable`,
  }[state];
  return { system, state, latencyMs, detail: `${detail} (simulated adapter; configure a health URL for live checks)`, checkedAt: new Date().toISOString(), source: "simulated" };
}

function label(system: SystemName) {
  return { cms: "CMS platform", evolve: "Evolve DMS", infomedia: "Infomedia Superservice", sms: "SMS/WhatsApp gateway" }[system];
}
