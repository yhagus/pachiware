import { Hono } from "hono";
import { db, agentsConfig, conversations, messages as messagesTable } from "@pachiware/db";
import { eq, desc } from "drizzle-orm";
import { CacheService } from "../cache/redis.js";
import { agentReActLoop } from "../loop/react.js";

export const agentRoutes = new Hono();

// Get agent configuration
agentRoutes.get("/config", async (c) => {
  let config = await CacheService.get<any>("agent:config:default");
  if (!config) {
    const rows = await db
      .select()
      .from(agentsConfig)
      .where(eq(agentsConfig.id, "default"))
      .limit(1);

    config = rows[0] || null;
    if (config) {
      await CacheService.set("agent:config:default", config, 120);
    }
  }

  // Mask secret keys for safe UI presentation
  const safeConfig = config
    ? {
        ...config,
        customApiKey: config.customApiKey ? "••••••••" + config.customApiKey.slice(-4) : null,
      }
    : null;

  return c.json({ success: true, config: safeConfig });
});

// Update agent configuration
agentRoutes.put("/config", async (c) => {
  const body = await c.req.json();

  const updatePayload: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) updatePayload.name = body.name;
  if (body.systemPrompt !== undefined) updatePayload.systemPrompt = body.systemPrompt;
  if (body.defaultProvider !== undefined) updatePayload.defaultProvider = body.defaultProvider;
  if (body.defaultModel !== undefined) updatePayload.defaultModel = body.defaultModel;
  if (body.temperature !== undefined) updatePayload.temperature = parseFloat(body.temperature);
  if (body.maxTokens !== undefined) updatePayload.maxTokens = parseInt(body.maxTokens, 10);
  if (body.customBaseUrl !== undefined) updatePayload.customBaseUrl = body.customBaseUrl;
  if (body.customApiKey !== undefined && !body.customApiKey.includes("••••")) {
    updatePayload.customApiKey = body.customApiKey;
  }
  if (body.settings !== undefined) updatePayload.settings = body.settings;

  const [updated] = await db
    .update(agentsConfig)
    .set(updatePayload)
    .where(eq(agentsConfig.id, "default"))
    .returning();

  // Invalidate redis cache immediately
  await CacheService.del("agent:config:default");

  return c.json({
    success: true,
    message: "Agent configuration updated successfully.",
    config: {
      ...updated,
      customApiKey: updated.customApiKey ? "••••••••" + updated.customApiKey.slice(-4) : null,
    },
  });
});

// Interactive Web Chat / Playground endpoint
agentRoutes.post("/chat", async (c) => {
  const body = await c.req.json();
  const { message, conversationId } = body;

  if (!message || typeof message !== "string") {
    return c.json({ success: false, error: "Field 'message' is required." }, 400);
  }

  const steps: any[] = [];

  const result = await agentReActLoop.run({
    message,
    conversationId,
    context: {
      platform: "web",
      userName: "Dashboard Admin",
      userId: "web-admin",
    },
    onStep: (step) => {
      steps.push(step);
    },
  });

  return c.json({
    success: true,
    reply: result.reply,
    conversationId: result.conversationId,
    iterations: result.iterations,
    toolsExecuted: result.toolCallsExecuted,
    steps,
  });
});

// Get conversation message history
agentRoutes.get("/conversations/:id/messages", async (c) => {
  const convId = c.req.param("id");
  const history = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, convId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(50);

  return c.json({ success: true, messages: history.reverse() });
});
