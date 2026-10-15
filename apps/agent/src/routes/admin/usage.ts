import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { repositories } from "@pachiware/db";
export const usageAdminRoutes = new Hono();
async function aggregate(tenantId: string | undefined, from?: string, to?: string) {
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && start > end)) throw new HTTPException(400, { message: "Invalid usage date range" });
  return repositories().usage.totals({ tenantId, from: start, to: end });
}
usageAdminRoutes.get("/tenants/:id/usage", async (c) => {
  if (!await repositories().tenants.get(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ success: true, usage: await aggregate(c.req.param("id"), c.req.query("from"), c.req.query("to")) });
});
usageAdminRoutes.get("/usage", async (c) => c.json({ success: true, usage: await aggregate(undefined, c.req.query("from"), c.req.query("to")) }));
