import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.js";
import { agentRoutes } from "./routes/agent.js";
import { skillRoutes } from "./routes/skills.js";
import { taskRoutes } from "./routes/tasks.js";

export function createServer() {
  const app = new Hono();

  // Middleware: CORS
  app.use(
    "*",
    cors({
      origin: (origin) => origin || "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    })
  );

  // Request logger
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    if (!c.req.path.startsWith("/api/health")) {
      console.log(`[HTTP] ${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`);
    }
  });

  // Mount API modules
  app.route("/api/health", healthRoutes);
  app.route("/api/agent", agentRoutes);
  app.route("/api/skills", skillRoutes);
  app.route("/api/tasks", taskRoutes);

  // Fallback root endpoint
  app.get("/", (c) => {
    return c.json({
      name: "Pachiware Agent Engine",
      version: "1.0.0",
      status: "running",
      endpoints: {
        health: "/api/health",
        agentConfig: "/api/agent/config",
        agentChat: "/api/agent/chat",
        skills: "/api/skills",
        tasks: "/api/tasks",
      },
    });
  });

  // Global error handler
  app.onError((err, c) => {
    console.error("Unhandled API error:", err);
    return c.json(
      {
        success: false,
        error: err.message || "Internal Server Error",
      },
      500
    );
  });

  return app;
}
