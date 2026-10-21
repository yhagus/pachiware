import { Hono } from "hono";
import { repositories, encryptSecret, decryptSecret } from "@pachiware/db";
import type { TenantEnv } from "../../middleware/tenant.js";
import { CacheService, tenantKey } from "../../cache/redis.js";
import { syncTenantSchedules } from "../../scheduler.js";
import { LLMRouter } from "../../llm/router.js";
import { isDefaultProvider } from "../../llm/providers.js";
import { maskConfig, object, placeSettings } from "../validation.js";

export const configRoutes = new Hono<TenantEnv>();
configRoutes.get("/", async (c) => {
  const row = await repositories().agentConfig.get(c.get("tenantId"));
  return c.json({ success: true, config: maskConfig(row) });
});
configRoutes.put("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const values: Record<string, any> = {};
  const textFields = ["name", "systemPrompt", "defaultModel", "openaiBaseUrl", "openaiModel", "anthropicBaseUrl", "anthropicModel", "customBaseUrl", "customModel"];
  for (const field of textFields) if (body[field] !== undefined) {
    if (typeof body[field] !== "string" && body[field] !== null) return c.json({ error: `${field} must be a string` }, 400);
    if (["name", "systemPrompt", "defaultModel"].includes(field) && !body[field]?.trim()) return c.json({ error: `${field} is required` }, 400);
    values[field] = body[field];
  }
  if (body.defaultProvider !== undefined) {
    if (!isDefaultProvider(body.defaultProvider)) return c.json({ error: "Invalid provider" }, 400);
    values.defaultProvider = body.defaultProvider;
  }
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== "number" || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2) return c.json({ error: "Temperature must be between 0 and 2" }, 400);
    values.temperature = body.temperature;
  }
  if (body.maxTokens !== undefined) {
    if (!Number.isInteger(body.maxTokens) || body.maxTokens < 1 || body.maxTokens > 1000000) return c.json({ error: "Invalid maxTokens" }, 400);
    values.maxTokens = body.maxTokens;
  }
  if (body.settings !== undefined) values.settings = object(body.settings, "settings");
  Object.assign(values, placeSettings(body));
  for (const field of ["openaiApiKeyEncrypted", "anthropicApiKeyEncrypted", "customApiKeyEncrypted"]) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") return c.json({ error: `${field} must be a string or null` }, 400);
    if (body[field]?.includes("••••")) continue;
    values[field] = body[field]?.trim() ? encryptSecret(body[field].trim()) : null;
  }
  const row = await repositories().agentConfig.update(c.get("tenantId"), values);
  await CacheService.del(tenantKey(c.get("tenantId"), "agent:config"));
  if (row && values.timezone) await syncTenantSchedules(c.get("tenantId"), row.timezone);
  return c.json({ success: true, message: "Configuration updated.", config: maskConfig(row) });
});
configRoutes.post("/test/llm", async (c) => {
  const body = object(await c.req.json(), "body");
  const { provider } = body;
  if (!isDefaultProvider(provider)) return c.json({ error: "Invalid provider" }, 400);
  const row: Record<string, any> | null = await repositories().agentConfig.get(c.get("tenantId"));
  const field = `${provider}ApiKeyEncrypted`;
  let key = body.apiKey;
  if (typeof key !== "string" || !key || key.includes("••••")) key = row?.[field] ? decryptSecret(row[field]) : null;
  if (!key) return c.json({ success: false, message: "Configure a tenant API key first." }, 400);
  const url = body.baseUrl || row?.[`${provider}BaseUrl`];
  const test = provider === "anthropic" ? LLMRouter.testAnthropic : provider === "custom" ? LLMRouter.testCustom : LLMRouter.testOpenAI;
  return c.json(await test(key, url));
});
