import { Hono } from "hono";
import { db, apiKeys, issueApiKey, listApiKeys, revokeApiKey, eq } from "@pachiware/db";
import { object, string } from "../validation.js";
export const apiKeyAdminRoutes = new Hono();
// ponytail: custom scopes deferred; keys always get ["*"].
apiKeyAdminRoutes.post("/api-keys", async (c) => {
  const body = object(await c.req.json(), "body");
  return c.json({ success: true, ...await issueApiKey(string(body.name, "name", true)) }, 201);
});
apiKeyAdminRoutes.get("/api-keys", async (c) => c.json({ success: true, apiKeys: await listApiKeys() }));
apiKeyAdminRoutes.delete("/api-keys/:keyId", async (c) => {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, c.req.param("keyId"))).limit(1);
  if (!key) return c.json({ error: "API key not found" }, 404);
  await revokeApiKey(key.id);
  return c.json({ success: true });
});
