import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { repositories, encryptSecret, decryptSecret, type NewProfile, type Profile, type ProfileUpdate } from "@pachiware/db";
import { object, string } from "../validation.js";
import { checkProfile, modelIds, sendToProfile } from "../../llm/probe.js";
import { apiFormatOf, formatHeaders, isApiFormat, isProvider, isReasoningEffort, providerBaseUrl, API_FORMAT_ERROR, MAX_PROFILE_MODELS, PROVIDER_ERROR, REASONING_EFFORT_ERROR } from "../../llm/providers.js";

export const profileAdminRoutes = new Hono();

const publicProfile = ({ apiKeyEncrypted, ...p }: any) => ({ ...p, hasApiKey: Boolean(apiKeyEncrypted) });
const BASE_URL_ERROR = "Only a BYOK profile takes a baseUrl";
const MODELS_ERROR = "fallbackModels must be a list of model names";
/** A reasoning effort as given: null for the provider's default, else the word trimmed. */
function effortOf(v: unknown): string | null {
  if (!isReasoningEffort(v)) throw new HTTPException(400, { message: REASONING_EFFORT_ERROR });
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function fields(body: Record<string, any>, creating: boolean): ProfileUpdate {
  const out: Record<string, any> = {};
  if (creating || body.name !== undefined) out.name = string(body.name, "name");
  if (creating || body.model !== undefined) out.model = string(body.model, "model");
  if (creating || body.provider !== undefined) {
    out.provider = string(body.provider, "provider");
    if (!isProvider(out.provider)) throw new HTTPException(400, { message: PROVIDER_ERROR });
  }
  if (body.baseUrl !== undefined) {
    out.baseUrl = body.baseUrl === null || body.baseUrl === "" ? null : string(body.baseUrl, "baseUrl");
    if (out.baseUrl && !/^https?:\/\//i.test(out.baseUrl)) throw new HTTPException(400, { message: "baseUrl must start with http:// or https://" });
  }
  if (body.apiFormat !== undefined) {
    if (!isApiFormat(body.apiFormat)) throw new HTTPException(400, { message: API_FORMAT_ERROR });
    out.apiFormat = body.apiFormat;
  }
  if (body.acceptsImages !== undefined) {
    if (typeof body.acceptsImages !== "boolean") throw new HTTPException(400, { message: "acceptsImages must be true or false" });
    out.acceptsImages = body.acceptsImages;
  }
  if (body.fallbackModels !== undefined) {
    if (!Array.isArray(body.fallbackModels) || body.fallbackModels.some((m: unknown) => typeof m !== "string" || !m.trim())) throw new HTTPException(400, { message: MODELS_ERROR });
    out.fallbackModels = body.fallbackModels.map((m: string) => m.trim());
  }
  if (body.reasoningEffort !== undefined) out.reasoningEffort = effortOf(body.reasoningEffort);
  if (body.apiKey !== undefined && !String(body.apiKey).includes("••••")) out.apiKeyEncrypted = body.apiKey ? encryptSecret(string(body.apiKey, "apiKey")!) : null;
  return out;
}

/**
 * Checks the profile a write leaves behind, given the stored one on update. Only BYOK names an address and needs one;
 * a profile moved off BYOK drops it. Each model appears once, at most MAX_PROFILE_MODELS in all.
 */
function settle(values: ProfileUpdate, current?: Profile): ProfileUpdate {
  const provider = values.provider ?? current?.provider;
  const baseUrl = values.baseUrl !== undefined ? values.baseUrl : current?.baseUrl;
  if (provider === "custom" && !baseUrl) throw new HTTPException(400, { message: "A custom provider needs a baseUrl" });
  if (provider !== "custom" && baseUrl) {
    if (values.baseUrl) throw new HTTPException(400, { message: BASE_URL_ERROR });
    values.baseUrl = null;
  }
  const models = [values.model ?? current!.model, ...(values.fallbackModels ?? current?.fallbackModels ?? [])];
  if (new Set(models).size !== models.length) throw new HTTPException(400, { message: "Each model may appear once" });
  if (models.length > MAX_PROFILE_MODELS) throw new HTTPException(400, { message: `A profile holds at most ${MAX_PROFILE_MODELS} models` });
  return values;
}

profileAdminRoutes.get("/tenants/:id/profiles", async (c) => {
  if (!await repositories().tenants.get(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ success: true, profiles: (await repositories().profiles.listForTenant(c.req.param("id"))).map(publicProfile) });
});
profileAdminRoutes.post("/tenants/:id/profiles", async (c) => {
  if (!await repositories().tenants.get(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const values = settle(fields(object(await c.req.json(), "body"), true));
  const row = await repositories().profiles.create(c.req.param("id"), values as NewProfile);
  return c.json({ success: true, profile: publicProfile(row) }, 201);
});
profileAdminRoutes.patch("/profiles/:profileId", async (c) => {
  const id = c.req.param("profileId");
  const current = await repositories().profiles.get(id);
  if (!current) return c.json({ error: "Profile not found" }, 404);
  const values = settle(fields(object(await c.req.json(), "body"), false), current);
  const row = await repositories().profiles.update(id, values);
  return c.json({ success: true, profile: publicProfile(row) });
});
// Integrations using the profile fall back to the tenant default.
profileAdminRoutes.delete("/profiles/:profileId", async (c) => {
  return await repositories().profiles.remove(c.req.param("profileId")!) ? c.json({ success: true }) : c.json({ error: "Profile not found" }, 404);
});
// Models and Test requests carry the form's unsaved values. The key stays server-side; a blank key reuses the saved profile's key.
async function connection(body: Record<string, any>) {
  const provider = string(body.provider, "provider")!;
  if (!isProvider(provider)) throw new HTTPException(400, { message: PROVIDER_ERROR });
  if (provider !== "custom" && typeof body.baseUrl === "string" && body.baseUrl.trim()) throw new HTTPException(400, { message: BASE_URL_ERROR });
  const baseUrl = providerBaseUrl(provider, typeof body.baseUrl === "string" ? body.baseUrl : null);
  if (!/^https?:\/\//i.test(baseUrl)) throw new HTTPException(400, { message: "A base URL is required" });
  if (body.apiFormat !== undefined && !isApiFormat(body.apiFormat)) throw new HTTPException(400, { message: API_FORMAT_ERROR });
  const format = apiFormatOf(provider, body.apiFormat), reasoningEffort = body.reasoningEffort === undefined ? null : effortOf(body.reasoningEffort);
  if (typeof body.apiKey === "string" && body.apiKey && !body.apiKey.includes("••••")) return { provider, format, baseUrl, key: body.apiKey.trim(), reasoningEffort };
  const row = typeof body.profileId === "string" ? await repositories().profiles.get(body.profileId) : null;
  return { provider, format, baseUrl, key: row?.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null, reasoningEffort };
}
profileAdminRoutes.post("/profiles/models", async (c) => {
  const { provider, format, baseUrl, key } = await connection(object(await c.req.json(), "body"));
  try {
    const res = await fetch(`${baseUrl}/models${format === "messages" ? "?limit=1000" : ""}`, { headers: formatHeaders(provider, format, key), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return c.json({ success: false, error: `Provider returned ${res.status}. Check the base URL and API key.` }, 502);
    const models = modelIds(await res.json()) ?? [];
    return c.json({ success: true, models: [...new Set(models)].sort() });
  } catch { return c.json({ success: false, error: "Could not reach the provider." }, 502); }
});
profileAdminRoutes.post("/profiles/test", async (c) => {
  const body = object(await c.req.json(), "body");
  const checks = await checkProfile({ ...await connection(body), model: string(body.model, "model")! });
  return c.json({ success: checks.text.status === "ok" || checks.text.status === "warning", checks });
});
const MAX_PLAYGROUND_PROMPT = 20_000;
profileAdminRoutes.post("/profiles/playground", async (c) => {
  const body = object(await c.req.json(), "body");
  const prompt = string(body.prompt, "prompt")!;
  const system = typeof body.system === "string" && body.system.trim() ? body.system.trim() : undefined;
  if (prompt.length + (system?.length ?? 0) > MAX_PLAYGROUND_PROMPT) throw new HTTPException(400, { message: `prompt and system together must be at most ${MAX_PLAYGROUND_PROMPT} characters` });
  const sent = await sendToProfile({ ...await connection(body), model: string(body.model, "model")! }, prompt, { system, maxTokens: 1024, timeoutMs: 60_000 });
  const { ok, ...result } = sent;
  return c.json({ success: ok, ...result });
});
