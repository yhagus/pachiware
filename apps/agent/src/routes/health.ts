import { Hono } from "hono";
import { config } from "../config.js";
import { activeEngine, repositories } from "@pachiware/db";
import { redis, isRedisConnected } from "../cache/redis.js";
import { discordBotManager } from "../discord/client.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  let dbStatus = "unknown";
  try {
    const alive = await repositories().stats.ping();
    dbStatus = alive ? "healthy" : "degraded";
  } catch {
    dbStatus = "unreachable";
  }

  let redisStatus = "healthy (in-memory fallback)";
  if (isRedisConnected()) {
    try {
      const pong = await redis.ping();
      redisStatus = pong === "PONG" ? "healthy (external redis)" : "healthy (in-memory fallback)";
    } catch {
      redisStatus = "healthy (in-memory fallback)";
    }
  }

  const discordStatus = discordBotManager.getAggregateStatus();
  let tenantCount = 0;
  let schemaReady = false;
  try { tenantCount = await repositories().tenants.count(); schemaReady = true; } catch {}
  const setupRequired = dbStatus !== "healthy" || !schemaReady || tenantCount === 0;

  return c.json({
    status: setupRequired ? "setup_required" : "ok",
    setupRequired,
    hasTenants: tenantCount > 0,
    hasEncryptionKey: config.hasEncryptionKey,
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      database: dbStatus,
      databaseEngine: activeEngine,
      redis: redisStatus,
      discord: discordStatus,
    },
  });
});
