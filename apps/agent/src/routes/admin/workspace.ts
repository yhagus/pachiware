import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { getTenantById } from "@pachiware/db";
import { workspaceStore, WorkspaceConflict, checkSegments, builtinPlaybooks, loadPlaybook, listBuiltinPlaybookDir, readBuiltinPlaybookFile, builtinPlaybookFiles, playbooksChanged, playbookSaveProblem, TENANT_PLAYBOOKS_DIR, PLAYBOOK_FILE } from "@pachiware/skills";
import { object, string } from "../validation.js";
import { slashNameUsable } from "../../discord/commands.js";

export const workspaceAdminRoutes = new Hono();

/** Built-in playbooks ship with the code; the editor shows them under this read-only folder, beside the tenant's own files. */
const BUILTIN = "playbooks";

function clean(input: unknown, allowRoot = false): string {
  if (typeof input !== "string" || input.includes("\0") || input.includes("\\") || input.startsWith("/")) throw new RangeError("Invalid path");
  const parts = input.replace(/\/$/, "").split("/").filter(Boolean);
  if (!parts.length && !allowRoot) throw new RangeError("path is required");
  checkSegments(parts);
  return parts.join("/");
}
const builtinParts = (path: string) => { const parts = path.split("/"); return parts[0] === BUILTIN ? parts.slice(1) : null; };
function writable(input: unknown) {
  const path = clean(input);
  if (builtinParts(path)) throw new HTTPException(403, { message: "Built-in playbooks are read-only. Copy one as an override to change it." });
  return path;
}
/** A saved, moved, or deleted path that can change a playbook makes the tenant's bots register their commands again. */
const changed = (tenantId: string, ...paths: string[]) => {
  if (paths.some((p) => p === "shared" || p === TENANT_PLAYBOOKS_DIR || p.startsWith(`${TENANT_PLAYBOOKS_DIR}/`))) playbooksChanged(tenantId);
};

/** Runs a route for an existing tenant and turns the store's refusals into 400 and 409 answers. */
/** A saved or moved playbook a person can start whose name Discord cannot use still works by mention and menu, but gets no slash command: say so. */
async function slashWarning(tenantId: string, path: string) {
  const name = new RegExp(`^${TENANT_PLAYBOOKS_DIR}/([^/]+)(/${PLAYBOOK_FILE})?$`).exec(path)?.[1];
  const playbook = name && !slashNameUsable(name) ? await loadPlaybook(tenantId, name) : null;
  if (!playbook?.start) return {};
  const ways = [playbook.words.length && `by mention with ${playbook.words.map((w) => `"${w}:"`).join(" or ")}`, playbook.menu && `from the message menu "${playbook.menu}"`].filter(Boolean);
  const still = ways.length ? `It still starts ${ways.join(" and ")}.` : "Give it a trigger word or a menu label, or rename it, so people can start it.";
  return { warning: `${name} gets no slash command: Discord takes only names of 1 to 32 lowercase letters, digits, - or _. ${still}` };
}

const route = (job: (c: Context, tenantId: string) => Promise<Response>) => async (c: Context) => {
  const tenantId = c.req.param("id")!;
  if (!await getTenantById(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  try { return await job(c, tenantId); }
  catch (e: any) {
    if (e instanceof WorkspaceConflict) return c.json({ error: e.message }, 409);
    if (e?.status) throw e;
    return c.json({ error: e?.message || "Workspace error" }, 400);
  }
};

async function builtinTree(tenantId: string, parts: string[]) {
  if (!parts.length) return Promise.all(builtinPlaybooks().map(async (p) => ({ path: `${BUILTIN}/${p.name}`, type: "dir" as const, readOnly: true, overridden: (await loadPlaybook(tenantId, p.name))?.source === "tenant" })));
  const entries = listBuiltinPlaybookDir(parts[0]!, parts.slice(1).join("/"));
  return entries?.map((e) => ({ ...e, path: `${BUILTIN}/${parts[0]}/${e.path}`, readOnly: true })) ?? null;
}

workspaceAdminRoutes.get("/tenants/:id/workspace/tree", route(async (c, t) => {
  const path = clean(c.req.query("path") ?? "", true), parts = builtinParts(path);
  if (parts) { const entries = await builtinTree(t, parts); return entries ? c.json({ success: true, entries }) : c.json({ error: "Folder not found" }, 404); }
  const entries = await workspaceStore().list(t, path);
  return c.json({ success: true, entries: path ? entries : [...entries.filter((e) => e.path !== BUILTIN), { path: BUILTIN, type: "dir", readOnly: true }] });
}));
workspaceAdminRoutes.get("/tenants/:id/workspace/file", route(async (c, t) => {
  const path = clean(c.req.query("path")), parts = builtinParts(path);
  if (parts) {
    const content = parts.length > 1 ? readBuiltinPlaybookFile(parts[0]!, parts.slice(1).join("/")) : null;
    return content === null ? c.json({ error: "File not found" }, 404) : c.json({ success: true, content, version: "builtin", readOnly: true });
  }
  const file = await workspaceStore().read(t, path);
  return file ? c.json({ success: true, ...file }) : c.json({ error: "File not found" }, 404);
}));
workspaceAdminRoutes.put("/tenants/:id/workspace/file", route(async (c, t) => {
  const body = object(await c.req.json(), "body");
  if (typeof body.content !== "string") throw new RangeError("content is required");
  const version = body.version === undefined ? undefined : string(body.version, "version")!;
  const path = writable(body.path), problem = await playbookSaveProblem(t, path, body.content);
  if (problem) return c.json({ error: `Not saved: ${problem}.` }, 400);
  const saved = await workspaceStore().write(t, path, body.content, version);
  changed(t, path);
  return c.json({ success: true, ...saved, ...await slashWarning(t, path) });
}));
workspaceAdminRoutes.post("/tenants/:id/workspace/move", route(async (c, t) => {
  const body = object(await c.req.json(), "body"), from = writable(body.from), to = writable(body.to);
  await workspaceStore().move(t, from, to);
  changed(t, from, to);
  return c.json({ success: true, ...await slashWarning(t, to) });
}));
workspaceAdminRoutes.delete("/tenants/:id/workspace/file", route(async (c, t) => {
  const path = writable(c.req.query("path"));
  await workspaceStore().remove(t, path);
  changed(t, path);
  return c.json({ success: true });
}));

/** Copies a built-in playbook's files into the tenant's playbooks folder, where they can be edited. */
workspaceAdminRoutes.post("/tenants/:id/workspace/playbooks/:name/override", route(async (c, t) => {
  const name = c.req.param("name")!, dir = `${TENANT_PLAYBOOKS_DIR}/${clean(name)}`;
  if (!builtinPlaybooks().some((p) => p.name === name)) return c.json({ error: "No built-in playbook has that name" }, 404);
  if ((await workspaceStore().list(t, TENANT_PLAYBOOKS_DIR)).some((e) => e.path === dir)) return c.json({ error: "This playbook already has an override. Delete it first to start again from the built-in." }, 409);
  for (const file of builtinPlaybookFiles(name)) await workspaceStore().write(t, `${dir}/${file}`, readBuiltinPlaybookFile(name, file)!);
  playbooksChanged(t);
  return c.json({ success: true, path: dir });
}));
/** Deletes a tenant playbook folder with everything in it; a built-in of the same name takes effect again. */
workspaceAdminRoutes.delete("/tenants/:id/workspace/playbooks/:name", route(async (c, t) => {
  const dir = `${TENANT_PLAYBOOKS_DIR}/${clean(c.req.param("name"))}`;
  if (!(await workspaceStore().list(t, TENANT_PLAYBOOKS_DIR)).some((e) => e.path === dir && e.type === "dir")) return c.json({ error: "This tenant has no playbook with that name" }, 404);
  const removeTree = async (path: string): Promise<void> => {
    for (const e of await workspaceStore().list(t, path)) await (e.type === "dir" ? removeTree(e.path) : workspaceStore().remove(t, e.path));
    await workspaceStore().remove(t, path);
  };
  await removeTree(dir);
  playbooksChanged(t);
  return c.json({ success: true });
}));
