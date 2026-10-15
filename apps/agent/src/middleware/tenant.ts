import { createMiddleware } from "hono/factory";
import { repositories, type Tenant, type ApiKey } from "@pachiware/db";

export type TenantEnv = { Variables: { tenant: Tenant; tenantId: string; apiKey: ApiKey } };
// Keys are global: every request authenticates the key, then (except key-level routes) picks a tenant under it via X-Tenant-Id (id or slug).
export const tenantMiddleware = createMiddleware<TenantEnv>(async (c, next) => {
  const match = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return c.json({ success: false, error: "API key required" }, 401);
  const { tenants } = repositories();
  const apiKey = await tenants.resolveApiKey(match[1]);
  if (!apiKey) return c.json({ success: false, error: "Invalid or revoked API key" }, 401);
  const scopes = apiKey.scopes;
  const resource = c.req.path.split("/")[3];
  if (scopes.length && !scopes.includes("*")) {
    const action = c.req.method === "GET" ? "read" : "write";
    if (!scopes.includes(`${resource}:${action}`)) return c.json({ success: false, error: "API key scope does not allow this operation" }, 403);
  }
  c.set("apiKey", apiKey);
  if (resource !== "tenants") {
    const ref = c.req.header("X-Tenant-Id")?.trim();
    if (!ref) return c.json({ success: false, error: "X-Tenant-Id header required" }, 400);
    const tenant = await tenants.getForApiKey(apiKey.id, ref);
    if (!tenant) return c.json({ success: false, error: "Tenant not found for this API key" }, 404);
    if (tenant.status !== "active") return c.json({ success: false, error: "Tenant is suspended" }, 403);
    c.set("tenant", tenant);
    c.set("tenantId", tenant.id);
  }
  void tenants.touchApiKey(apiKey.id).catch(() => {});
  await next();
});
