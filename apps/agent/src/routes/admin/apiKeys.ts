import { Hono } from "hono";
import { repositories } from "@pachiware/db";
import { object, string } from "../validation.js";
export const apiKeyAdminRoutes = new Hono();
// ponytail: custom scopes deferred; keys always get ["*"].
apiKeyAdminRoutes.post("/api-keys", async (c) => {
  const body = object(await c.req.json(), "body");
  return c.json({ success: true, ...await repositories().tenants.issueApiKey(string(body.name, "name", true)) }, 201);
});
apiKeyAdminRoutes.get("/api-keys", async (c) => c.json({ success: true, apiKeys: await repositories().tenants.listApiKeys() }));
apiKeyAdminRoutes.delete("/api-keys/:keyId", async (c) => {
  const { tenants } = repositories();
  const key = await tenants.getApiKey(c.req.param("keyId"));
  if (!key) return c.json({ error: "API key not found" }, 404);
  await tenants.revokeApiKey(key.id);
  return c.json({ success: true });
});
