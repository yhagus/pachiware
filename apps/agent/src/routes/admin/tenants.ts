import { Hono } from "hono";
import { db, tenants, apiKeys, agentsConfig, createTenant, getTenantBySlug, getTenantById, updateTenant, deleteTenant } from "@pachiware/db";
import { eq, ne } from "drizzle-orm";
import { discordBotManager } from "../../discord/client.js";
import { CacheService, tenantKey } from "../../cache/redis.js";
import { object, string, placeSettings } from "../validation.js";
export const tenantAdminRoutes = new Hono();
// The tenant's default time zone and language; a guild may override both on its own config.
const settingsOut = (row: { timezone: string; language: string }) => ({ timezone: row.timezone, language: row.language });
tenantAdminRoutes.get("/:id/settings", async (c) => {
  const [row] = await db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, c.req.param("id"))).limit(1);
  return row && await getTenantById(c.req.param("id")) ? c.json({ success: true, settings: settingsOut(row) }) : c.json({ error: "Tenant not found" }, 404);
});
tenantAdminRoutes.put("/:id/settings", async (c) => {
  const tenantId = c.req.param("id");
  if (!await getTenantById(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const values = placeSettings(object(await c.req.json(), "body"));
  const [row] = await db.update(agentsConfig).set({ ...values, updatedAt: new Date() }).where(eq(agentsConfig.tenantId, tenantId)).returning();
  await CacheService.del(tenantKey(tenantId, "agent:config"));
  return row ? c.json({ success: true, settings: settingsOut(row) }) : c.json({ error: "Tenant not found" }, 404);
});
tenantAdminRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const name = string(body.name, "name")!;
  const slug = string(body.slug, "slug", true);
  if (slug && !/^[a-z0-9][a-z0-9_-]*$/.test(slug)) return c.json({ error: "Invalid slug" }, 400);
  if (slug && await getTenantBySlug(slug)) return c.json({ error: "Slug is already taken" }, 409);
  const apiKeyId = string(body.apiKeyId, "apiKeyId", true) || undefined;
  if (apiKeyId && !(await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).limit(1)).length) return c.json({ error: "API key not found" }, 404);
  const tenant = await createTenant({ name, slug, apiKeyId, metadata: body.metadata === undefined ? undefined : object(body.metadata, "metadata") });
  return c.json({ success: true, tenant }, 201);
});
tenantAdminRoutes.get("/", async (c) => c.json({ success: true, tenants: await db.select().from(tenants).where(ne(tenants.status, "deleted")).limit(1000) }));
tenantAdminRoutes.get("/:id", async (c) => {
  const tenant = await getTenantById(c.req.param("id"));
  return tenant ? c.json({ success: true, tenant }) : c.json({ error: "Tenant not found" }, 404);
});
tenantAdminRoutes.patch("/:id", async (c) => {
  const body = object(await c.req.json(), "body");
  if (body.status !== undefined && !["active", "suspended"].includes(body.status)) return c.json({ error: "Invalid status" }, 400);
  const tenant = await updateTenant(c.req.param("id"), { name: string(body.name, "name", true), status: body.status, metadata: body.metadata === undefined ? undefined : object(body.metadata, "metadata") });
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);
  if (tenant.status !== "active") await discordBotManager.stopTenant(tenant.id);
  else if (body.status === "active") void discordBotManager.startAll().catch(() => {});
  return c.json({ success: true, tenant });
});
tenantAdminRoutes.delete("/:id", async (c) => {
  const tenant = await deleteTenant(c.req.param("id"));
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);
  await discordBotManager.stopTenant(tenant.id);
  return c.json({ success: true });
});
