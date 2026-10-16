import { Hono } from "hono";
import { getInfraConfig, saveRedisUrl, getAllowedHosts, saveAllowedHosts, activeEngine, redactedDatabaseHost } from "@pachiware/db";
import { object } from "../validation.js";
import { redis, reconnectRedis } from "../../cache/redis.js";
export const infrastructureRoutes = new Hono();
function maskConnectionUrl(url: string): string {
  try { const parsed = new URL(url); if (parsed.password) parsed.password = "••••••••"; return parsed.toString(); }
  catch { return url; }
}
// Allowed hosts: the platform-wide list of self-hosted git and Plane servers (empty = unrestricted). "/git-hosts" is its older path.
const getHosts = (c: any) => c.json({ success: true, hosts: getAllowedHosts() });
const putHosts = async (c: any) => {
  const body = object(await c.req.json(), "body");
  if (!Array.isArray(body.hosts) || body.hosts.length > 50) return c.json({ error: "hosts must be an array of at most 50 entries" }, 400);
  const hosts: string[] = [];
  for (const raw of body.hosts) {
    const host = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    // host or host:port only; no scheme, path, or credentials.
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(host)) return c.json({ error: `Invalid host "${raw}". Use host or host:port, without https://` }, 400);
    if (!hosts.includes(host)) hosts.push(host);
  }
  return c.json({ success: true, hosts: saveAllowedHosts(hosts) });
};
for (const path of ["/allowed-hosts", "/git-hosts"]) {
  infrastructureRoutes.get(path, getHosts);
  infrastructureRoutes.put(path, putHosts);
}

// The database shows only its engine and host: it is chosen at setup and changed on the server (ADR 0010).
infrastructureRoutes.get("/", async (c) => {
  const infra = getInfraConfig();
  return c.json({
    success: true,
    infrastructure: {
      databaseEngine: activeEngine,
      databaseHost: redactedDatabaseHost(infra.databaseUrl),
      redisUrl: maskConnectionUrl(infra.redisUrl),
      rawRedisUrl: infra.redisUrl,
      isFromRuntimeStore: infra.isFromRuntimeStore,
      updatedAt: infra.updatedAt,
    },
  });
});

// Test infrastructure Redis connection
infrastructureRoutes.post("/test-redis", async (c) => {
  try {
    const startTime = Date.now();
    const ping = await redis.ping();
    const latencyMs = Date.now() - startTime;
    return c.json({
      success: ping === "PONG",
      message: `Redis responded with ${ping} (${latencyMs}ms)`,
      latencyMs,
    });
  } catch (err: any) {
    return c.json({ success: false, message: `Failed to ping Redis: ${err.message}` });
  }
});

// Update the Redis URL (persists to runtime-config.json, does NOT touch .env)
infrastructureRoutes.put("/", async (c) => {
  const body = object(await c.req.json(), "body");
  if (body.databaseUrl !== undefined) {
    return c.json({ error: "The database cannot be changed from the admin API. Its engine is fixed at setup; change its address in DATABASE_URL on the server." }, 400);
  }
  if (body.redisUrl !== undefined && typeof body.redisUrl !== "string") return c.json({ error: "redisUrl must be a string" }, 400);
  if (!body.redisUrl?.trim() || body.redisUrl.includes("••••")) return c.json({ error: "redisUrl is required" }, 400);

  const updated = saveRedisUrl(body.redisUrl);
  await reconnectRedis(updated.redisUrl);
  return c.json({
    success: true,
    message: "Redis URL saved to runtime-config.json.",
    infrastructure: {
      redisUrl: maskConnectionUrl(updated.redisUrl),
      isFromRuntimeStore: true,
      updatedAt: updated.updatedAt,
    },
  });
});
