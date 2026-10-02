import { Hono } from "hono";
import { queryClient } from "@pachiware/db";
import { redis, isRedisConnected } from "../cache/redis.js";
import { discordBotService } from "../discord/client.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  let dbStatus = "unknown";
  try {
    const res = await queryClient`SELECT 1 as alive`;
    dbStatus = res.length > 0 ? "healthy" : "degraded";
  } catch (err: any) {
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
      redis: redisStatus,
      discord: discordStatus,
    },
  });
});
