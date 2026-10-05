import { createMiddleware } from "hono/factory";
import { getTenantByApiKey, touchApiKeyLastUsed, type Tenant, type ApiKey } from "@pachiware/db";

export type TenantEnv = { Variables: { tenant: Tenant; tenantId: string; apiKey: ApiKey } };
export const tenantMiddleware = createMiddleware<TenantEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return c.json({ success: false, error: "Tenant API key required" }, 401);
  const resolved = await getTenantByApiKey(match[1], true);
  if (!resolved) return c.json({ success: false, error: "Invalid or revoked API key" }, 401);
  if (resolved.tenant.status !== "active") return c.json({ success: false, error: "Tenant is suspended" }, 403);
  c.set("tenant", resolved.tenant);
  c.set("tenantId", resolved.tenant.id);
  c.set("apiKey", resolved.apiKey);
  const scopes = resolved.apiKey.scopes;
  if (scopes.length && !scopes.includes("*")) {
    const resource = c.req.path.split("/")[3];
    const action = c.req.method === "GET" ? "read" : "write";
    if (!scopes.includes(`${resource}:${action}`)) return c.json({ success: false, error: "API key scope does not allow this operation" }, 403);
  }
  void touchApiKeyLastUsed(resolved.apiKey.id).catch(() => {});
  await next();
});
