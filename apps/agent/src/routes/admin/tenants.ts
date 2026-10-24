import { Hono } from "hono";
import { repositories, DEFAULT_CONVERSATION_IDLE_HOURS, DEFAULT_MODEL_RETRY_WAIT_SECONDS, DEFAULT_PLAYBOOK_WORKERS, DEFAULT_HISTORY_TOKENS, type AgentConfig, type AgentConfigUpdate } from "@pachiware/db";
import { discordBotManager } from "../../discord/client.js";
import { CacheService, tenantKey } from "../../cache/redis.js";
import { syncTenantSchedules } from "../../scheduler.js";
import { object, string, placeSettings, conversationIdleHours, modelRetryWaitSeconds, playbookWorkers, maxTokens, historyTokens } from "../validation.js";
export const tenantAdminRoutes = new Hono();
// The tenant's default time zone and language, which a guild may override on its own config, the quiet hours after which a conversation
// starts fresh, how long a worked-on Changelog draft waits to try the model once more (#358), and how many workers trace an API
// changelog's endpoints at once (#343), the most one model reply may hold, and how much stored conversation each model call carries.
const settingsOut = (row: AgentConfig) => ({
  timezone: row.timezone, language: row.language, conversationIdleHours: row.settings?.conversationIdleHours ?? DEFAULT_CONVERSATION_IDLE_HOURS,
  modelRetryWaitSeconds: row.settings?.modelRetryWaitSeconds ?? DEFAULT_MODEL_RETRY_WAIT_SECONDS,
  playbookWorkers: row.settings?.playbookWorkers ?? DEFAULT_PLAYBOOK_WORKERS,
  maxTokens: row.maxTokens, historyTokens: row.settings?.historyTokens ?? DEFAULT_HISTORY_TOKENS,
});
tenantAdminRoutes.get("/:id/settings", async (c) => {
  const row = await repositories().agentConfig.get(c.req.param("id"));
  return row && await repositories().tenants.get(c.req.param("id")) ? c.json({ success: true, settings: settingsOut(row) }) : c.json({ error: "Tenant not found" }, 404);
});
tenantAdminRoutes.put("/:id/settings", async (c) => {
  const tenantId = c.req.param("id");
  if (!await repositories().tenants.get(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const body = object(await c.req.json(), "body");
  const values: AgentConfigUpdate = placeSettings(body) as AgentConfigUpdate, hours = conversationIdleHours(body), wait = modelRetryWaitSeconds(body), workers = playbookWorkers(body);
  const output = maxTokens(body), history = historyTokens(body);
  if (output !== undefined) values.maxTokens = output;
  // settings is one JSON value, so the hours, the wait, the workers and the history budget go in beside what it already holds.
  if (hours !== undefined || wait !== undefined || workers !== undefined || history !== undefined) {
    values.settings = {
      ...(await repositories().agentConfig.get(tenantId))?.settings, ...(hours !== undefined ? { conversationIdleHours: hours } : {}), ...(wait !== undefined ? { modelRetryWaitSeconds: wait } : {}),
      ...(workers !== undefined ? { playbookWorkers: workers } : {}), ...(history !== undefined ? { historyTokens: history } : {}),
    };
  }
  const row = await repositories().agentConfig.update(tenantId, values);
  await CacheService.del(tenantKey(tenantId, "agent:config"));
  if (row && values.timezone) await syncTenantSchedules(tenantId, row.timezone);
  return row ? c.json({ success: true, settings: settingsOut(row) }) : c.json({ error: "Tenant not found" }, 404);
});
tenantAdminRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const name = string(body.name, "name")!;
  const slug = string(body.slug, "slug", true);
  if (slug && !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) return c.json({ error: "Invalid slug" }, 400);
  const { tenants } = repositories();
  if (slug && await tenants.getBySlug(slug)) return c.json({ error: "Slug is already taken" }, 409);
  const apiKeyId = string(body.apiKeyId, "apiKeyId", true) || undefined;
  if (apiKeyId && !await tenants.getApiKey(apiKeyId)) return c.json({ error: "API key not found" }, 404);
  const tenant = await tenants.create({ name, slug, apiKeyId, metadata: body.metadata === undefined ? undefined : object(body.metadata, "metadata") });
  return c.json({ success: true, tenant }, 201);
});
tenantAdminRoutes.get("/", async (c) => c.json({ success: true, tenants: await repositories().tenants.list() }));
tenantAdminRoutes.get("/:id", async (c) => {
  const tenant = await repositories().tenants.get(c.req.param("id"));
  return tenant ? c.json({ success: true, tenant }) : c.json({ error: "Tenant not found" }, 404);
});
tenantAdminRoutes.patch("/:id", async (c) => {
  const body = object(await c.req.json(), "body");
  if (body.status !== undefined && !["active", "suspended"].includes(body.status)) return c.json({ error: "Invalid status" }, 400);
  const tenant = await repositories().tenants.update(c.req.param("id"), { name: string(body.name, "name", true), status: body.status, metadata: body.metadata === undefined ? undefined : object(body.metadata, "metadata") });
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);
  if (tenant.status !== "active") await discordBotManager.stopTenant(tenant.id);
  else if (body.status === "active") void discordBotManager.startAll().catch(() => {});
  return c.json({ success: true, tenant });
});
tenantAdminRoutes.delete("/:id", async (c) => {
  const tenant = await repositories().tenants.remove(c.req.param("id"));
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);
  await discordBotManager.stopTenant(tenant.id);
  return c.json({ success: true });
});
