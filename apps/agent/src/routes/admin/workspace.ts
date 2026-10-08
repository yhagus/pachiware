import { Hono, type Context } from "hono";
import { getTenantById } from "@pachiware/db";
import { workspaceStore, WorkspaceConflict, checkSegments } from "@pachiware/skills";
import { object, string } from "../validation.js";

export const workspaceAdminRoutes = new Hono();

function clean(input: unknown, allowRoot = false): string {
  if (typeof input !== "string" || input.includes("\0") || input.includes("\\") || input.startsWith("/")) throw new RangeError("Invalid path");
  const parts = input.replace(/\/$/, "").split("/").filter(Boolean);
  if (!parts.length && !allowRoot) throw new RangeError("path is required");
  checkSegments(parts);
  return parts.join("/");
}

/** Runs a route for an existing tenant and turns the store's refusals into 400 and 409 answers. */
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
workspaceAdminRoutes.get("/tenants/:id/workspace/tree", route(async (c, t) => c.json({ success: true, entries: await workspaceStore().list(t, clean(c.req.query("path") ?? "", true)) })));
workspaceAdminRoutes.get("/tenants/:id/workspace/file", route(async (c, t) => {
  const file = await workspaceStore().read(t, clean(c.req.query("path")));
  return file ? c.json({ success: true, ...file }) : c.json({ error: "File not found" }, 404);
}));
workspaceAdminRoutes.put("/tenants/:id/workspace/file", route(async (c, t) => {
  const body = object(await c.req.json(), "body");
  if (typeof body.content !== "string") throw new RangeError("content is required");
  const version = body.version === undefined ? undefined : string(body.version, "version")!;
  return c.json({ success: true, ...await workspaceStore().write(t, clean(body.path), body.content, version) });
}));
workspaceAdminRoutes.post("/tenants/:id/workspace/move", route(async (c, t) => {
  const body = object(await c.req.json(), "body");
  await workspaceStore().move(t, clean(body.from), clean(body.to));
  return c.json({ success: true });
}));
workspaceAdminRoutes.delete("/tenants/:id/workspace/file", route(async (c, t) => {
  await workspaceStore().remove(t, clean(c.req.query("path")));
  return c.json({ success: true });
}));
