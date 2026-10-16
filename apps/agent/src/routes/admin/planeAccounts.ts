import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { repositories, encryptSecret, type PlaneAccount, type PlaneAccountUpdate } from "@pachiware/db";
import { object, string } from "../validation.js";
import { planeBaseUrl, planeConnOf, verifyPlaneAccount, listPlaneProjects, type PlaneConn } from "@pachiware/skills";

export const planeAccountAdminRoutes = new Hono();

/** The key is write-only: a response says only that one is saved, behind a fixed mask. */
export const API_KEY_MASK = "••••••••";
const publicAccount = ({ apiKeyEncrypted, ...a }: PlaneAccount) => ({ ...a, hasApiKey: Boolean(apiKeyEncrypted), apiKey: API_KEY_MASK });

const bad = (message: string) => new HTTPException(400, { message });
function baseUrlOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  try { return planeBaseUrl(string(value, "baseUrl")); } catch (e) { if (e instanceof HTTPException) throw e; throw bad((e as Error).message); }
}
/** A slug is the path segment of the Plane workspace's URL. */
function slugOf(value: unknown): string {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug)) throw bad("workspaceSlug must be the Plane workspace's slug, as in its URL (letters, digits, - and _)");
  return slug;
}
/** A new key, or null when the field is empty or still holds the mask. */
function newKey(value: unknown): string | null {
  return typeof value === "string" && value.trim() && !value.includes("••••") ? value.trim() : null;
}
async function verify(conn: PlaneConn) {
  try { return await verifyPlaneAccount(conn); } catch (e) { throw bad((e as Error).message); }
}

planeAccountAdminRoutes.get("/tenants/:id/plane-accounts", async (c) => {
  const tenantId = c.req.param("id");
  if (!await repositories().tenants.get(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const { plane } = repositories();
  const used = await plane.botsByAccount(tenantId);
  return c.json({ success: true, planeAccounts: (await plane.listAccounts(tenantId)).map((r) => ({ ...publicAccount(r), bots: used[r.id] ?? [] })) });
});

planeAccountAdminRoutes.post("/tenants/:id/plane-accounts", async (c) => {
  const tenantId = c.req.param("id");
  if (!await repositories().tenants.get(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const body = object(await c.req.json(), "body");
  const name = string(body.name, "name")!, baseUrl = baseUrlOf(body.baseUrl), workspaceSlug = slugOf(body.workspaceSlug);
  const apiKey = newKey(body.apiKey);
  if (!apiKey) throw bad("apiKey must be a non-empty string");
  const { user } = await verify({ baseUrl, workspaceSlug, apiKey });
  try {
    const row = await repositories().plane.createAccount({ tenantId, name, baseUrl, workspaceSlug, apiKeyEncrypted: encryptSecret(apiKey), planeUserId: user.id, planeUserName: user.name });
    return c.json({ success: true, planeAccount: publicAccount(row) }, 201);
  } catch { return c.json({ error: "A Plane account with this name already exists" }, 409); }
});

planeAccountAdminRoutes.patch("/plane-accounts/:accountId", async (c) => {
  const current = await repositories().plane.getAccount(c.req.param("accountId"));
  if (!current) return c.json({ error: "Plane account not found" }, 404);
  const body = object(await c.req.json(), "body");
  const values: PlaneAccountUpdate = {};
  if (body.name !== undefined) values.name = string(body.name, "name");
  const baseUrl = body.baseUrl !== undefined ? baseUrlOf(body.baseUrl) : current.baseUrl;
  const workspaceSlug = body.workspaceSlug !== undefined ? slugOf(body.workspaceSlug) : current.workspaceSlug;
  const apiKey = newKey(body.apiKey);
  // The saved key must never be sent to a host it was not entered for.
  if (baseUrl !== current.baseUrl && !apiKey) throw bad("Changing the base URL requires entering the API key again");
  if (apiKey || workspaceSlug !== current.workspaceSlug || baseUrl !== current.baseUrl) {
    const key = apiKey ?? planeConnOf(current).apiKey;
    const { user } = await verify({ baseUrl, workspaceSlug, apiKey: key });
    Object.assign(values, { baseUrl, workspaceSlug, planeUserId: user.id, planeUserName: user.name });
    if (apiKey) values.apiKeyEncrypted = encryptSecret(apiKey);
  }
  try {
    const row = await repositories().plane.updateAccount(current.id, values);
    return c.json({ success: true, planeAccount: publicAccount(row!) });
  } catch { return c.json({ error: "A Plane account with this name already exists" }, 409); }
});

planeAccountAdminRoutes.delete("/plane-accounts/:accountId", async (c) => {
  const id = c.req.param("accountId");
  const { plane } = repositories();
  const acc = await plane.getAccount(id);
  if (!acc) return c.json({ error: "Plane account not found" }, 404);
  const using = (await plane.botsByAccount(acc.tenantId))[id] ?? [];
  if (using.length) return c.json({ error: "Plane account is still used by bots; detach it from them first", bots: using }, 409);
  return await plane.deleteAccount(id) ? c.json({ success: true }) : c.json({ error: "Plane account not found" }, 404);
});

// The Plane projects the account's Plane user can see, for choosing a Plane scope.
planeAccountAdminRoutes.get("/plane-accounts/:accountId/projects", async (c) => {
  const acc = await repositories().plane.getAccount(c.req.param("accountId"));
  if (!acc) return c.json({ error: "Plane account not found" }, 404);
  try { return c.json({ success: true, projects: await listPlaneProjects(planeConnOf(acc)) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 502); }
});
