import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db, profiles, getTenantById, encryptSecret, decryptSecret, eq } from "@pachiware/db";
import { desc } from "drizzle-orm";
import { object, string } from "../validation.js";
import { LLMRouter, providerBaseUrl, providerHeaders } from "../../llm/router.js";

export const profileAdminRoutes = new Hono();
const PROVIDERS = ["openai", "anthropic", "custom"];

const publicProfile = ({ apiKeyEncrypted, ...p }: any) => ({ ...p, hasApiKey: Boolean(apiKeyEncrypted) });
function fields(body: Record<string, any>, creating: boolean) {
  const out: Record<string, any> = {};
  if (creating || body.name !== undefined) out.name = string(body.name, "name");
  if (creating || body.model !== undefined) out.model = string(body.model, "model");
  if (creating || body.provider !== undefined) {
    out.provider = string(body.provider, "provider");
    if (!PROVIDERS.includes(out.provider)) throw new HTTPException(400, { message: "provider must be openai, anthropic, or custom" });
  }
  if (body.baseUrl !== undefined) {
    out.baseUrl = body.baseUrl === null || body.baseUrl === "" ? null : string(body.baseUrl, "baseUrl");
    if (out.baseUrl && !/^https?:\/\//i.test(out.baseUrl)) throw new HTTPException(400, { message: "baseUrl must start with http:// or https://" });
  }
  if (body.acceptsImages !== undefined) {
    if (typeof body.acceptsImages !== "boolean") throw new HTTPException(400, { message: "acceptsImages must be true or false" });
    out.acceptsImages = body.acceptsImages;
  }
  if (body.apiKey !== undefined && !String(body.apiKey).includes("••••")) out.apiKeyEncrypted = body.apiKey ? encryptSecret(string(body.apiKey, "apiKey")!) : null;
  return out;
}

profileAdminRoutes.get("/tenants/:id/profiles", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ success: true, profiles: (await db.select().from(profiles).where(eq(profiles.tenantId, c.req.param("id"))).orderBy(desc(profiles.createdAt)).limit(500)).map(publicProfile) });
});
profileAdminRoutes.post("/tenants/:id/profiles", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const values = fields(object(await c.req.json(), "body"), true);
  if (values.provider === "custom" && !values.baseUrl) throw new HTTPException(400, { message: "A custom provider needs a baseUrl" });
  const [row] = await db.insert(profiles).values({ tenantId: c.req.param("id"), ...values }).returning();
  return c.json({ success: true, profile: publicProfile(row) }, 201);
});
profileAdminRoutes.patch("/profiles/:profileId", async (c) => {
  const id = c.req.param("profileId");
  const [current] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  if (!current) return c.json({ error: "Profile not found" }, 404);
  const values = fields(object(await c.req.json(), "body"), false);
  if ((values.provider ?? current.provider) === "custom" && !(values.baseUrl !== undefined ? values.baseUrl : current.baseUrl)) throw new HTTPException(400, { message: "A custom provider needs a baseUrl" });
  const [row] = await db.update(profiles).set({ ...values, updatedAt: new Date() }).where(eq(profiles.id, id)).returning();
  return c.json({ success: true, profile: publicProfile(row) });
});
// Integrations using the profile fall back to the tenant default (FK is ON DELETE SET NULL).
profileAdminRoutes.delete("/profiles/:profileId", async (c) => {
  const [row] = await db.delete(profiles).where(eq(profiles.id, c.req.param("profileId")!)).returning();
  return row ? c.json({ success: true }) : c.json({ error: "Profile not found" }, 404);
});
// Models and Test requests carry the form's unsaved values. The key stays server-side; a blank key reuses the saved profile's key.
async function connection(body: Record<string, any>) {
  const provider = string(body.provider, "provider")!;
  if (!PROVIDERS.includes(provider)) throw new HTTPException(400, { message: "provider must be openai, anthropic, or custom" });
  const baseUrl = providerBaseUrl(provider, typeof body.baseUrl === "string" ? body.baseUrl : null);
  if (!/^https?:\/\//i.test(baseUrl)) throw new HTTPException(400, { message: "A base URL is required" });
  if (typeof body.apiKey === "string" && body.apiKey && !body.apiKey.includes("••••")) return { provider, baseUrl, key: body.apiKey.trim() };
  const [row] = typeof body.profileId === "string" ? await db.select().from(profiles).where(eq(profiles.id, body.profileId)).limit(1) : [];
  return { provider, baseUrl, key: row?.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null };
}
profileAdminRoutes.post("/profiles/models", async (c) => {
  const { provider, baseUrl, key } = await connection(object(await c.req.json(), "body"));
  try {
    const res = await fetch(`${baseUrl}/models${provider === "anthropic" ? "?limit=1000" : ""}`, { headers: providerHeaders(provider, key), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return c.json({ success: false, error: `Provider returned ${res.status}. Check the base URL and API key.` }, 502);
    const data: any = await res.json();
    const models = (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []).map((m: any) => (typeof m === "string" ? m : m?.id)).filter((m: unknown): m is string => typeof m === "string" && !!m);
    return c.json({ success: true, models: [...new Set(models)].sort() });
  } catch { return c.json({ success: false, error: "Could not reach the provider." }, 502); }
});
profileAdminRoutes.post("/profiles/test", async (c) => {
  const body = object(await c.req.json(), "body");
  const { provider, baseUrl, key } = await connection(body);
  const result = await LLMRouter.probeProfile(provider, string(body.model, "model")!, key, baseUrl);
  return c.json({ success: result.text.ok, ...result });
});
