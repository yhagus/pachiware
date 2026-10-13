import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db, usageEvents, getTenantById } from "@pachiware/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
export const usageAdminRoutes = new Hono();
async function aggregate(tenantId: string | undefined, from?: string, to?: string) {
  const conditions = [];
  if (tenantId) conditions.push(eq(usageEvents.tenantId, tenantId));
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && start > end)) throw new HTTPException(400, { message: "Invalid usage date range" });
  if (start) conditions.push(gte(usageEvents.createdAt, start));
  if (end) conditions.push(lte(usageEvents.createdAt, end));
  const rows = await db.select({ tenantId: usageEvents.tenantId, type: usageEvents.type, provider: usageEvents.provider, model: usageEvents.model, events: sql<number>`count(*)`, promptTokens: sql<number>`coalesce(sum(${usageEvents.promptTokens}),0)`, completionTokens: sql<number>`coalesce(sum(${usageEvents.completionTokens}),0)`, cachedTokens: sql<number>`coalesce(sum(cast(${usageEvents.metadata}->>'cachedTokens' as integer)),0)` }).from(usageEvents).where(and(...conditions)).groupBy(usageEvents.tenantId, usageEvents.type, usageEvents.provider, usageEvents.model);
  return rows.map((row: any) => ({ ...row, events: Number(row.events), promptTokens: Number(row.promptTokens), completionTokens: Number(row.completionTokens), cachedTokens: Number(row.cachedTokens) }));
}
usageAdminRoutes.get("/tenants/:id/usage", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ success: true, usage: await aggregate(c.req.param("id"), c.req.query("from"), c.req.query("to")) });
});
usageAdminRoutes.get("/usage", async (c) => c.json({ success: true, usage: await aggregate(undefined, c.req.query("from"), c.req.query("to")) }));
