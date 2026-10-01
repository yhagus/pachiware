import { Hono } from "hono";
import {
  db,
  agentsConfig,
  conversations,
  messages as messagesTable,
  getInfraConfig,
  saveInfraConfig,
  testPostgresConnection,
} from "@pachiware/db";
import { eq, desc } from "drizzle-orm";
import { CacheService, redis } from "../cache/redis.js";
import { agentReActLoop } from "../loop/react.js";
import { discordBotService } from "../discord/client.js";
import { LLMRouter } from "../llm/router.js";

export const agentRoutes = new Hono();

function maskSecret(val: string | null | undefined): string | null {
  if (!val) return null;
  if (val.length <= 8) return "••••••••";
  return "••••••••" + val.slice(-4);
}

function maskConnectionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "••••••••";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:([^:@]+)@/, ":••••••••@");
  }
}

// Get agent configuration with masked credentials
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

  const safeConfig = config
    ? {
        ...config,
        openaiApiKey: maskSecret(config.openaiApiKey),
        anthropicApiKey: maskSecret(config.anthropicApiKey),
        customApiKey: maskSecret(config.customApiKey),
        discordBotToken: maskSecret(config.discordBotToken),
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

  // OpenAI fields
  if (body.openaiApiKey !== undefined && !body.openaiApiKey.includes("••••")) {
    updatePayload.openaiApiKey = body.openaiApiKey.trim() || null;
  }
  if (body.openaiBaseUrl !== undefined) updatePayload.openaiBaseUrl = body.openaiBaseUrl.trim() || null;
  if (body.openaiModel !== undefined) updatePayload.openaiModel = body.openaiModel.trim() || null;

  // Anthropic fields
  if (body.anthropicApiKey !== undefined && !body.anthropicApiKey.includes("••••")) {
    updatePayload.anthropicApiKey = body.anthropicApiKey.trim() || null;
  }
  if (body.anthropicBaseUrl !== undefined) updatePayload.anthropicBaseUrl = body.anthropicBaseUrl.trim() || null;
  if (body.anthropicModel !== undefined) updatePayload.anthropicModel = body.anthropicModel.trim() || null;

  // Custom / 9router fields
  if (body.customBaseUrl !== undefined) updatePayload.customBaseUrl = body.customBaseUrl.trim() || null;
  if (body.customApiKey !== undefined && !body.customApiKey.includes("••••")) {
    updatePayload.customApiKey = body.customApiKey.trim() || null;
  }
  if (body.customModel !== undefined) updatePayload.customModel = body.customModel.trim() || null;

  // Discord Gateway fields
  let discordChanged = false;
  if (body.discordBotToken !== undefined && !body.discordBotToken.includes("••••")) {
    updatePayload.discordBotToken = body.discordBotToken.trim() || null;
    discordChanged = true;
  }
  if (body.discordClientId !== undefined) {
    updatePayload.discordClientId = body.discordClientId.trim() || null;
  }
  if (body.discordGuildId !== undefined) {
    updatePayload.discordGuildId = body.discordGuildId.trim() || null;
    discordChanged = true;
  }

  if (body.settings !== undefined) updatePayload.settings = body.settings;

  const [updated] = await db
    .update(agentsConfig)
    .set(updatePayload)
    .where(eq(agentsConfig.id, "default"))
    .returning();

  // Invalidate redis cache immediately
  await CacheService.del("agent:config:default");

  // If Discord credentials were updated, reload gateway bot in background
  if (discordChanged) {
    discordBotService.restart().catch((err) => {
      console.warn("Notice during Discord dynamic reload:", err.message);
    });
  }

  return c.json({
    success: true,
    message: "Configuration updated successfully.",
    config: {
      ...updated,
      openaiApiKey: maskSecret(updated.openaiApiKey),
      anthropicApiKey: maskSecret(updated.anthropicApiKey),
      customApiKey: maskSecret(updated.customApiKey),
      discordBotToken: maskSecret(updated.discordBotToken),
    },
  });
});

// Test connection endpoint for LLM providers
agentRoutes.post("/test/llm", async (c) => {
  const body = await c.req.json();
  const { provider, apiKey, baseUrl } = body;

  let keyToUse = apiKey;
  let urlToUse = baseUrl;

  // If apiKey contains mask, resolve real key from DB
  if (!keyToUse || keyToUse.includes("••••")) {
    const rows = await db.select().from(agentsConfig).where(eq(agentsConfig.id, "default")).limit(1);
    const cfg = rows[0];
    if (provider === "openai") {
      keyToUse = cfg?.openaiApiKey;
      urlToUse = urlToUse || cfg?.openaiBaseUrl;
    } else if (provider === "anthropic") {
      keyToUse = cfg?.anthropicApiKey;
      urlToUse = urlToUse || cfg?.anthropicBaseUrl;
    } else {
      keyToUse = cfg?.customApiKey;
      urlToUse = urlToUse || cfg?.customBaseUrl;
    }
  }

  if (!keyToUse) {
    return c.json({ success: false, message: `No API key provided or found in database for ${provider}.` }, 400);
  }

  if (provider === "anthropic") {
    const result = await LLMRouter.testAnthropic(keyToUse, urlToUse);
    return c.json(result);
  } else if (provider === "custom") {
    const result = await LLMRouter.testCustom(keyToUse, urlToUse);
    return c.json(result);
  } else {
    const result = await LLMRouter.testOpenAI(keyToUse, urlToUse);
    return c.json(result);
  }
});

// Test connection endpoint for Discord
agentRoutes.post("/test/discord", async (c) => {
  const body = await c.req.json();
  let token = body.token;

  if (!token || token.includes("••••")) {
    const rows = await db.select().from(agentsConfig).where(eq(agentsConfig.id, "default")).limit(1);
    token = rows[0]?.discordBotToken;
  }

  if (!token) {
    return c.json({ success: false, error: "No Discord bot token provided or found in database." }, 400);
  }

  const result = await DiscordBotService.testToken(token);
  return c.json(result);
});

// Restart Discord bot gateway
agentRoutes.post("/discord/restart", async (c) => {
  const res = await discordBotService.restart();
  return c.json(res);
});

// Get infrastructure configuration
agentRoutes.get("/infrastructure", async (c) => {
  const infra = getInfraConfig();
  return c.json({
    success: true,
    infrastructure: {
      databaseUrl: maskConnectionUrl(infra.databaseUrl),
      rawDatabaseUrl: infra.databaseUrl,
      redisUrl: maskConnectionUrl(infra.redisUrl),
      rawRedisUrl: infra.redisUrl,
      isFromRuntimeStore: infra.isFromRuntimeStore,
      updatedAt: infra.updatedAt,
      notice: ".env is protected and read-only. Runtime changes are persisted to runtime-config.json.",
    },
  });
});

// Test infrastructure PostgreSQL connection
agentRoutes.post("/infrastructure/test-db", async (c) => {
  const body = await c.req.json();
  let url = body.databaseUrl;
  if (!url || url.includes("••••")) {
    const infra = getInfraConfig();
    url = infra.databaseUrl;
  }

  const result = await testPostgresConnection(url);
  return c.json(result);
});

// Test infrastructure Redis connection
agentRoutes.post("/infrastructure/test-redis", async (c) => {
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
agentRoutes.put("/infrastructure", async (c) => {
  const body = await c.req.json();
  const updates: { databaseUrl?: string; redisUrl?: string } = {};

  if (body.databaseUrl && !body.databaseUrl.includes("••••")) {
    updates.databaseUrl = body.databaseUrl.trim();
  }
  if (body.redisUrl && !body.redisUrl.includes("••••")) {
    updates.redisUrl = body.redisUrl.trim();
  }

  const updated = saveInfraConfig(updates);
  return c.json({
    success: true,
    message: "Infrastructure settings successfully saved to persistent runtime store (runtime-config.json).",
    infrastructure: {
      databaseUrl: maskConnectionUrl(updated.databaseUrl),
      redisUrl: maskConnectionUrl(updated.redisUrl),
      isFromRuntimeStore: true,
      updatedAt: updated.updatedAt,
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
