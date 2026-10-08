import { Hono } from "hono";
import { getInfraConfig, saveInfraConfig, getGitAllowedHosts, saveGitAllowedHosts, testDatabaseConnection, reconnectDatabase, runMigrations, runSeed, activeDialect } from "@pachiware/db";
import { discordBotManager } from "../../discord/client.js";
import { object } from "../validation.js";
import { redis, reconnectRedis } from "../../cache/redis.js";
export const infrastructureRoutes = new Hono();
function maskConnectionUrl(url: string): string {
  try { const parsed = new URL(url); if (parsed.password) parsed.password = "••••••••"; return parsed.toString(); }
  catch { return url; }
}
// Platform-wide allowlist for self-hosted git hosts (empty = unrestricted).
infrastructureRoutes.get("/git-hosts", (c) => c.json({ success: true, hosts: getGitAllowedHosts() }));
infrastructureRoutes.put("/git-hosts", async (c) => {
  const body = object(await c.req.json(), "body");
  if (!Array.isArray(body.hosts) || body.hosts.length > 50) return c.json({ error: "hosts must be an array of at most 50 entries" }, 400);
  const hosts: string[] = [];
  for (const raw of body.hosts) {
    const host = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    // host or host:port only; no scheme, path, or credentials.
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(host)) return c.json({ error: `Invalid host "${raw}". Use host or host:port, without https://` }, 400);
    if (!hosts.includes(host)) hosts.push(host);
  }
  return c.json({ success: true, hosts: saveGitAllowedHosts(hosts) });
});

// Get infrastructure configuration
infrastructureRoutes.get("/", async (c) => {
  const infra = getInfraConfig();
  return c.json({
    success: true,
    infrastructure: {
      databaseUrl: maskConnectionUrl(infra.databaseUrl),
      rawDatabaseUrl: infra.databaseUrl,
      databaseDialect: activeDialect,
      redisUrl: maskConnectionUrl(infra.redisUrl),
      rawRedisUrl: infra.redisUrl,
      isFromRuntimeStore: infra.isFromRuntimeStore,
      updatedAt: infra.updatedAt,
      notice: ".env is protected and read-only. Runtime changes are persisted to runtime-config.json.",
    },
  });
});

// Test infrastructure database connection (dialect-aware: sqlite or postgres)
infrastructureRoutes.post("/test-db", async (c) => {
  const body = object(await c.req.json(), "body");
  let url = body.databaseUrl;
  if (!url || url.includes("••••")) {
    const infra = getInfraConfig();
    url = infra.databaseUrl;
  }

  const result = await testDatabaseConnection(url);
  return c.json(result);
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

// Update infrastructure configuration (persists to runtime-config.json, does NOT touch .env)
infrastructureRoutes.put("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const updates: { databaseUrl?: string; redisUrl?: string } = {};

  if (body.databaseUrl !== undefined && typeof body.databaseUrl !== "string") return c.json({ error: "databaseUrl must be a string" }, 400);
  if (body.redisUrl !== undefined && typeof body.redisUrl !== "string") return c.json({ error: "redisUrl must be a string" }, 400);
  if (body.databaseUrl && !body.databaseUrl.includes("••••")) {
    updates.databaseUrl = body.databaseUrl.trim();
  }
  if (body.redisUrl && !body.redisUrl.includes("••••")) {
    updates.redisUrl = body.redisUrl.trim();
  }

  if (updates.databaseUrl) {
    const tested = await testDatabaseConnection(updates.databaseUrl);
    if (!tested.success) return c.json({ success: false, message: tested.message }, 400);
  }
  const updated = saveInfraConfig(updates);
  let statusMessage = "Infrastructure settings successfully saved to persistent runtime store (runtime-config.json).";

  if (updates.databaseUrl) {
    try {
      const running = discordBotManager.getAggregateStatus() as any[];
      await Promise.all(running.map((bot) => discordBotManager.stopBot(bot.botId)));
      reconnectDatabase(updated.databaseUrl);
      await runMigrations();
      await runSeed();
      statusMessage = "Database connected; migrations and seed completed.";
      void discordBotManager.startAll().catch(() => {});
    } catch (err: any) {
      return c.json(
        {
          success: false,
          message: `Saved configuration, but failed to connect or migrate PostgreSQL: ${err.message}`,
          error: err.message,
        },
        400
      );
    }
  }

  if (updates.redisUrl) await reconnectRedis(updated.redisUrl);
  return c.json({
    success: true,
    message: statusMessage,
    infrastructure: {
      databaseUrl: maskConnectionUrl(updated.databaseUrl),
      redisUrl: maskConnectionUrl(updated.redisUrl),
      isFromRuntimeStore: true,
      updatedAt: updated.updatedAt,
    },
  });
});


