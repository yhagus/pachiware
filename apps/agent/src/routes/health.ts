import { Hono } from "hono";
import { pingDatabase, activeDialect } from "@pachiware/db";
import { redis, isRedisConnected } from "../cache/redis.js";
import { discordBotService } from "../discord/client.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  let dbStatus = "unknown";
  try {
    const alive = await pingDatabase();
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

  const discordStatus = discordBotService.getStatus();
  const setupRequired = dbStatus !== "healthy";

  return c.json({
    status: setupRequired ? "setup_required" : "ok",
    setupRequired,
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      database: dbStatus,
      databaseDialect: activeDialect,
      redis: redisStatus,
      discord: discordStatus,
    },
  });
});
