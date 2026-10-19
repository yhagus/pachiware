import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.js";
import { configRoutes } from "./routes/v1/config.js";
import { chatRoutes } from "./routes/v1/chat.js";
import { conversationRoutes } from "./routes/v1/conversations.js";
import { skillRoutes } from "./routes/v1/skills.js";
import { taskRoutes } from "./routes/v1/tasks.js";
import { botRoutes } from "./routes/v1/bots.js";
import { tenantRoutes } from "./routes/v1/tenants.js";
import { availabilityTenantRoutes } from "./routes/v1/availability.js";
import { tenantAdminRoutes } from "./routes/admin/tenants.js";
import { apiKeyAdminRoutes } from "./routes/admin/apiKeys.js";
import { botAdminRoutes } from "./routes/admin/bots.js";
import { profileAdminRoutes } from "./routes/admin/profiles.js";
import { gitAccountAdminRoutes } from "./routes/admin/gitAccounts.js";
import { planeAccountAdminRoutes } from "./routes/admin/planeAccounts.js";
import { skillAdminRoutes } from "./routes/admin/skills.js";
import { workspaceAdminRoutes } from "./routes/admin/workspace.js";
import { gitOAuthAppAdminRoutes } from "./routes/admin/gitOAuthApps.js";
import { oauthRoutes } from "./routes/oauth.js";
import { usageAdminRoutes } from "./routes/admin/usage.js";
import { infrastructureRoutes } from "./routes/admin/infrastructure.js";
import { statsAdminRoutes } from "./routes/admin/stats.js";
import { logAdminRoutes } from "./routes/admin/logs.js";
import { logAt } from "./logs/agentLog.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import { platformAdminMiddleware } from "./middleware/platformAdmin.js";
import { HTTPException } from "hono/http-exception";

export function createServer() {
  const app = new Hono();

  // Middleware: CORS
  app.use(
    "*",
    cors({
      origin: (origin) => origin || "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Platform-Key"],
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
    // The Console page's own requests would fill the log it shows.
    if (!c.req.path.startsWith("/api/health") && !c.req.path.startsWith("/api/admin/logs")) {
      // A refused request is kept as a warning and a failed one as an error, so the Console page's level filter finds them;
      // the terminal gets every one on standard output as before.
      logAt(c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info", `[HTTP] ${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`);
    }
  });

  // Mount API modules
  app.route("/api/health", healthRoutes);
  app.use("/api/v1/*", tenantMiddleware);
  app.use("/api/admin/*", platformAdminMiddleware);
  app.route("/api/v1/config", configRoutes);
  app.route("/api/v1/chat", chatRoutes);
  app.route("/api/v1/conversations", conversationRoutes);
  app.route("/api/v1/skills", skillRoutes);
  app.route("/api/v1/tasks", taskRoutes);
  app.route("/api/v1/bots", botRoutes);
  app.route("/api/v1/tenants", tenantRoutes);
  app.route("/api/v1/availability", availabilityTenantRoutes);
  app.route("/api/admin/tenants", tenantAdminRoutes);
  app.route("/api/admin", apiKeyAdminRoutes);
  app.route("/api/admin", botAdminRoutes);
  app.route("/api/admin", profileAdminRoutes);
  app.route("/api/admin", gitAccountAdminRoutes);
  app.route("/api/admin", planeAccountAdminRoutes);
  app.route("/api/admin", skillAdminRoutes);
  app.route("/api/admin", workspaceAdminRoutes);
  app.route("/api/admin", gitOAuthAppAdminRoutes);
  app.route("/api/oauth", oauthRoutes);
  app.route("/api/admin", usageAdminRoutes);
  app.route("/api/admin", statsAdminRoutes);
  app.route("/api/admin", logAdminRoutes);
  app.route("/api/admin/infrastructure", infrastructureRoutes);

  // Fallback root endpoint
  app.get("/", (c) => {
    return c.json({
      name: "Pachiware Agent Engine",
      version: "1.0.0",
      status: "running",
      endpoints: {
        health: "/api/health",
        agentConfig: "/api/v1/config",
        agentChat: "/api/v1/chat",
        skills: "/api/v1/skills",
        tasks: "/api/v1/tasks",
      },
    });
  });

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ success: false, error: err.message }, err.status);
    if (err instanceof SyntaxError) return c.json({ success: false, error: "Invalid JSON body" }, 400);
    const message = String(err.message || "");
    if (/unique constraint|duplicate key/i.test(message)) return c.json({ success: false, error: "Resource already exists" }, 409);
    console.error("[http] Unhandled API error on", c.req.method, c.req.path);
    return c.json(
      {
        success: false,
        error: "Internal Server Error",
      },
      500
    );
  });

  return app;
}
