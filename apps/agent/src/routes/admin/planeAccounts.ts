import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { repositories, encryptSecret, decryptSecret, type PlaneAccount, type PlaneAccountUpdate, type PlaneWorkspace } from "@pachiware/db";
import { object, string } from "../validation.js";
import {
  planeBaseUrl, planeConnOf, verifyPlaneKey, checkPlaneWorkspace, listPlaneProjects, planeServerRelease, readPlaneServer,
  PLANE_VERSIONS, findPlaneVersion, newestPlaneVersion, versionForRelease, versionNote, type PlaneServerConn, type PlaneVersion,
} from "@pachiware/skills";

export const planeAccountAdminRoutes = new Hono();

/**
 * The key is write-only: a response says only that one is saved, behind a fixed mask. `versionNote` warns when the release the
 * Plane server reported is outside the account's Plane version.
 */
export const API_KEY_MASK = "••••••••";
const publicAccount = ({ apiKeyEncrypted, ...a }: PlaneAccount) => ({ ...a, hasApiKey: Boolean(apiKeyEncrypted), apiKey: API_KEY_MASK, versionNote: versionNote(a) });

const bad = (message: string) => new HTTPException(400, { message });
function baseUrlOf(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  try { return planeBaseUrl(string(value, "baseUrl")); } catch (e) { if (e instanceof HTTPException) throw e; throw bad((e as Error).message); }
}
/** A slug is the path segment of the Plane workspace's URL. */
function slugOf(value: unknown): string {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug)) throw bad("A Plane workspace slug must be as in the Plane workspace's URL (letters, digits, - and _)");
  return slug;
}
const MAX_PLANE_WORKSPACES = 20;
/**
 * The Plane workspaces an account lists: 1 to 20 slugs, none twice, each switched on unless `enabled` is false. Plane cannot list
 * the workspaces a key opens, so the admin types them.
 */
function workspacesOf(value: unknown): PlaneWorkspace[] {
  if (!Array.isArray(value) || !value.length) throw bad("workspaces must list at least one Plane workspace");
  if (value.length > MAX_PLANE_WORKSPACES) throw bad(`workspaces may list at most ${MAX_PLANE_WORKSPACES} Plane workspaces`);
  const out: PlaneWorkspace[] = [];
  for (const item of value) {
    const w = object(item, "workspace");
    const slug = slugOf(w.slug);
    if (out.some((x) => x.slug === slug)) throw bad(`The Plane workspace "${slug}" is listed twice`);
    out.push({ slug, enabled: w.enabled !== false });
  }
  return out;
}
/** The account's name, which the model may follow with "/" and a Plane workspace slug. */
function nameOf(value: unknown): string {
  const name = string(value, "name")!;
  if (name.includes("/")) throw bad("name must not contain /, which separates a Plane account from its Plane workspace");
  return name;
}
const ONE_OF_VERSIONS = `planeVersion must be one of: ${PLANE_VERSIONS.map((v) => v.id).join(", ")}`;
/** A Plane version from the list; left out, `fallback`. */
function versionOf(value: unknown, fallback: PlaneVersion = newestPlaneVersion()): PlaneVersion {
  if (value === undefined || value === null || value === "") return fallback;
  const version = typeof value === "string" ? findPlaneVersion(value.trim()) : null;
  if (!version) throw bad(ONE_OF_VERSIONS);
  return version;
}
/** A new key, or null when the field is empty or still holds the mask. */
function newKey(value: unknown): string | null {
  return typeof value === "string" && value.trim() && !value.includes("••••") ? value.trim() : null;
}
/** Asks Plane about the key, then about each of these Plane workspaces; a refusal is a 400 naming what failed. */
async function verify(conn: PlaneServerConn, workspaces: PlaneWorkspace[]) {
  try {
    const user = await verifyPlaneKey(conn);
    await checkWorkspaces(conn, workspaces);
    return user;
  } catch (e) { throw e instanceof HTTPException ? e : bad((e as Error).message); }
}
async function checkWorkspaces(conn: PlaneServerConn, workspaces: PlaneWorkspace[]) {
  try { for (const w of workspaces) await checkPlaneWorkspace(conn, w.slug); } catch (e) { throw bad((e as Error).message); }
}
const switchedOn = (workspaces: PlaneWorkspace[]) => workspaces.filter((w) => w.enabled);

// The Plane versions an account can be set to, oldest first. They are hard-coded, since each needs its own tool code (ADR 0016).
// With `baseUrl` (empty for Plane's cloud), also the release that Plane reports and the version covering it, as a suggestion.
planeAccountAdminRoutes.get("/plane-versions", async (c) => {
  const planeVersions = PLANE_VERSIONS.map(({ id, label, checkedAgainst, auth }) => ({ id, label, checkedAgainst, auth }));
  const asked = c.req.query("baseUrl");
  if (asked === undefined) return c.json({ success: true, planeVersions });
  const release = await planeServerRelease(baseUrlOf(asked));
  return c.json({ success: true, planeVersions, server: release ? { release, suggested: versionForRelease(release)?.id ?? null } : null });
});

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
  const name = nameOf(body.name), baseUrl = baseUrlOf(body.baseUrl), workspaces = workspacesOf(body.workspaces);
  const apiKey = newKey(body.apiKey);
  if (!apiKey) throw bad("apiKey must be a non-empty string");
  // Left out, the version is the one covering the release the server reports, else the newest.
  const release = await planeServerRelease(baseUrl);
  const version = versionOf(body.planeVersion, versionForRelease(release) ?? newestPlaneVersion());
  // A switched-off Plane workspace is not asked about: it may be one the key's user has left.
  const user = await verify({ baseUrl, apiKey, version }, switchedOn(workspaces));
  try {
    const row = await repositories().plane.createAccount({ tenantId, name, baseUrl, workspaces, apiKeyEncrypted: encryptSecret(apiKey), planeUserId: user.id, planeUserName: user.name, planeVersion: version.id, planeServerVersion: release });
    return c.json({ success: true, planeAccount: publicAccount(row) }, 201);
  } catch { return c.json({ error: "A Plane account with this name already exists" }, 409); }
});

planeAccountAdminRoutes.patch("/plane-accounts/:accountId", async (c) => {
  const current = await repositories().plane.getAccount(c.req.param("accountId"));
  if (!current) return c.json({ error: "Plane account not found" }, 404);
  const body = object(await c.req.json(), "body");
  const values: PlaneAccountUpdate = {};
  if (body.name !== undefined) values.name = nameOf(body.name);
  const baseUrl = body.baseUrl !== undefined ? baseUrlOf(body.baseUrl) : current.baseUrl;
  const workspaces = body.workspaces !== undefined ? workspacesOf(body.workspaces) : current.workspaces;
  const apiKey = newKey(body.apiKey);
  // An account left on a version this server does not know can be edited only by choosing one it knows.
  const version = body.planeVersion !== undefined ? versionOf(body.planeVersion) : findPlaneVersion(current.planeVersion);
  const unknown = () => bad(`This account is set to Plane version "${current.planeVersion}", which this server does not know; ${ONE_OF_VERSIONS}`);
  // The saved key must never be sent to a host it was not entered for.
  if (baseUrl !== current.baseUrl && !apiKey) throw bad("Changing the base URL requires entering the API key again");
  // A new key, host or version is checked with every switched-on Plane workspace; otherwise only the workspaces this save
  // switches on are asked about, so switching off one that Plane now refuses still saves.
  const wasOn = new Set(switchedOn(current.workspaces).map((w) => w.slug));
  if (apiKey || baseUrl !== current.baseUrl || version?.id !== current.planeVersion) {
    if (!version) throw unknown();
    const user = await verify({ baseUrl, apiKey: apiKey ?? decryptSecret(current.apiKeyEncrypted), version }, switchedOn(workspaces));
    Object.assign(values, { baseUrl, planeUserId: user.id, planeUserName: user.name, planeVersion: version.id });
    if (apiKey) values.apiKeyEncrypted = encryptSecret(apiKey);
  } else {
    const newlyOn = switchedOn(workspaces).filter((w) => !wasOn.has(w.slug));
    if (newlyOn.length) {
      if (!version) throw unknown();
      await checkWorkspaces({ baseUrl, apiKey: decryptSecret(current.apiKeyEncrypted), version }, newlyOn);
    }
  }
  if (body.workspaces !== undefined) values.workspaces = workspaces;
  // Read again on every save, so saving an account unchanged refreshes it after a Plane upgrade.
  values.planeServerVersion = await planeServerRelease(baseUrl);
  try {
    const row = await repositories().plane.updateAccount(current.id, values);
    return c.json({ success: true, planeAccount: publicAccount(row!) });
  } catch { return c.json({ error: "A Plane account with this name already exists" }, 409); }
});

type CheckStatus = "ok" | "warning" | "failed" | "skipped";
type Check = { status: CheckStatus; message: string };
const skipped = (message: string): Check => ({ status: "skipped", message });

/**
 * Tries an account's settings, saved or not, without saving: the Plane server, the Plane version against the release it reports,
 * the key's Plane user, then each listed Plane workspace, switched on or not. A step after one that failed is skipped. With
 * `accountId` and no key, the saved key is used, but only on the host it was saved for: it is never sent anywhere else.
 */
planeAccountAdminRoutes.post("/plane-accounts/test", async (c) => {
  const body = object(await c.req.json(), "body");
  const saved = body.accountId !== undefined ? await repositories().plane.getAccount(string(body.accountId, "accountId")!) : null;
  if (body.accountId !== undefined && !saved) return c.json({ error: "Plane account not found" }, 404);
  // An account being written may have no Plane workspace yet; Test still reports the server, the version and the key.
  const toCheck = Array.isArray(body.workspaces) && body.workspaces.length ? workspacesOf(body.workspaces) : [];
  const workspacesSkipped = (why: string) => toCheck.map((w) => ({ ...w, ...skipped(why) }));
  const stop = (url: Check, version: Check, key: Check) => c.json({ success: true, checks: { url, version, key, workspaces: workspacesSkipped("Not checked until the API key passes.") } });

  let baseUrl: string | null;
  try { baseUrl = baseUrlOf(body.baseUrl); }
  catch (e) { return stop({ status: "failed", message: (e as Error).message }, skipped("Not checked."), skipped("Not checked.")); }
  const where = baseUrl ? `Plane at ${new URL(baseUrl).host}` : "Plane's cloud";
  const server = await readPlaneServer(baseUrl);
  if (!server.reached) return stop({ status: "failed", message: server.error ?? `${where} could not be reached.` }, skipped("Not checked."), skipped("Not checked."));
  const url: Check = { status: "ok", message: server.release ? `${where} answered and runs ${server.release}.` : `${where} answered without saying which release it runs.` };

  const planeVersion = typeof body.planeVersion === "string" && body.planeVersion.trim() ? findPlaneVersion(body.planeVersion.trim()) : versionForRelease(server.release) ?? newestPlaneVersion();
  if (!planeVersion) return stop(url, { status: "failed", message: ONE_OF_VERSIONS }, skipped("Not checked."));
  const note = versionNote({ baseUrl, planeVersion: planeVersion.id, planeServerVersion: server.release });
  const version: Check = !server.release ? skipped(`The release is unknown, so it was not compared with ${planeVersion.label}.`)
    : note ? { status: "warning", message: note } : { status: "ok", message: `${planeVersion.label} covers ${server.release}.` };

  const newApiKey = newKey(body.apiKey);
  if (!newApiKey && saved && saved.baseUrl !== baseUrl) return stop(url, version, { status: "failed", message: "Enter the API key again: the saved key is never sent to a different host." });
  const apiKey = newApiKey ?? (saved ? decryptSecret(saved.apiKeyEncrypted) : null);
  if (!apiKey) return stop(url, version, { status: "failed", message: "Enter the API key." });
  const conn = { baseUrl, apiKey, version: planeVersion };
  let key: Check;
  try { key = { status: "ok", message: `Connected as ${(await verifyPlaneKey(conn)).name}.` }; }
  catch (e) { return stop(url, version, { status: "failed", message: (e as Error).message }); }

  const workspaces = [];
  for (const w of toCheck) {
    try {
      const projects = await checkPlaneWorkspace(conn, w.slug);
      workspaces.push({ ...w, status: "ok" as const, message: `${projects.length} Plane ${projects.length === 1 ? "project" : "projects"} this Plane user can see.`, projectCount: projects.length });
    } catch (e) { workspaces.push({ ...w, status: "failed" as const, message: (e as Error).message }); }
  }
  return c.json({ success: true, checks: { url, version, key, workspaces } });
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

// The Plane projects the account's Plane user can see in one of its Plane workspaces, for choosing a Plane scope. `workspace`
// names a listed slug, switched on or not; it may be left out when the account lists one.
planeAccountAdminRoutes.get("/plane-accounts/:accountId/projects", async (c) => {
  const acc = await repositories().plane.getAccount(c.req.param("accountId"));
  if (!acc) return c.json({ error: "Plane account not found" }, 404);
  const asked = c.req.query("workspace")?.trim().toLowerCase();
  const slug = asked || (acc.workspaces.length === 1 ? acc.workspaces[0]!.slug : "");
  if (!slug) return c.json({ error: "workspace is required: this Plane account lists several Plane workspaces" }, 400);
  if (!acc.workspaces.some((w) => w.slug === slug)) return c.json({ error: `The Plane workspace "${slug}" is not listed on this Plane account` }, 400);
  try { return c.json({ success: true, projects: await listPlaneProjects(planeConnOf(acc, slug)) }); }
  catch (e) { return c.json({ error: (e as Error).message }, 502); }
});
