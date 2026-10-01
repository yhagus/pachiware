import { Hono } from "hono";
import { queryClient } from "@pachiware/db";
import { redis } from "../cache/redis.js";
import { discordBotService } from "../discord/client.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  let dbStatus = "unknown";
  try {
    const res = await queryClient`SELECT 1 as alive`;
    dbStatus = res.length > 0 ? "healthy" : "degraded";
  } catch (err: any) {
    dbStatus = `unhealthy: ${err.message}`;
  }

  let redisStatus = "unknown";
  try {
    const pong = await redis.ping();
    redisStatus = pong === "PONG" ? "healthy" : "degraded";
  } catch (err: any) {
    redisStatus = `unhealthy: ${err.message}`;
  }

  const discordStatus = discordBotService.getStatus();

  return c.json({
    status: dbStatus === "healthy" && redisStatus === "healthy" ? "ok" : "degraded",
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
