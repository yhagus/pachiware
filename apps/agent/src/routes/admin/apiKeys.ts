import { Hono } from "hono";
import { db, apiKeys, getTenantById, issueApiKey, listApiKeysForTenant, revokeApiKey, eq } from "@pachiware/db";
import { object, string, stringArray } from "../validation.js";
export const apiKeyAdminRoutes = new Hono();
apiKeyAdminRoutes.post("/tenants/:id/api-keys", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const body = object(await c.req.json(), "body");
  const issued = await issueApiKey(c.req.param("id"), string(body.name, "name", true), body.scopes === undefined ? [] : stringArray(body.scopes, "scopes"));
  return c.json({ success: true, ...issued }, 201);
});
apiKeyAdminRoutes.get("/tenants/:id/api-keys", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ success: true, apiKeys: await listApiKeysForTenant(c.req.param("id")) });
});
apiKeyAdminRoutes.delete("/api-keys/:keyId", async (c) => {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, c.req.param("keyId"))).limit(1);
  if (!key) return c.json({ error: "API key not found" }, 404);
  await revokeApiKey(key.id);
  return c.json({ success: true });
});
