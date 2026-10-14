import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { object } from "../validation.js";
import { DEFAULT_TIMEZONE, loadAllTasks, normalizeDueAt, parseAssignee, parseTask, PRIORITIES, render, slug, STATUSES, type Task, WorkspaceConflict, workspaceStore } from "@pachiware/skills";
import type { TenantEnv } from "../../middleware/tenant.js";

export const taskRoutes = new Hono<TenantEnv>();
const taskFile = (task: Task) => `shared/tasks/${slug(task.title)}-${task.id.replace(/-/g, "").slice(0, 8).toLowerCase()}.md`;
async function ensureLabel(tenantId: string, path: string, label: string) {
  const store = workspaceStore();
  try { if (!(await store.read(tenantId, `${path}/.name`))) await store.write(tenantId, `${path}/.name`, label); } catch {}
}
async function tenantTasks(tenantId: string) { return loadAllTasks(workspaceStore(), tenantId); }
async function findTask(tenantId: string, id: string) { return (await tenantTasks(tenantId)).find((f) => f.task.id === id); }

taskRoutes.get("/", async (c) => {
  const status = c.req.query("status"), priority = c.req.query("priority"), search = c.req.query("search")?.toLowerCase();
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50));
  const all = (await tenantTasks(c.get("tenantId"))).map((f) => f.task);
  const filtered = all.filter((task) => (!status || status === "all" || task.status === status) && (!priority || priority === "all" || task.priority === priority) && (!search || task.title.toLowerCase().includes(search))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ success: true, counts: { total: all.length, pending: all.filter((t) => t.status === "pending").length, in_progress: all.filter((t) => t.status === "in_progress").length, completed: all.filter((t) => t.status === "completed").length }, tasks: filtered.slice(0, limit) });
});

taskRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  validateTask(body);
  if (typeof body.title !== "string" || !body.title.trim()) return c.json({ success: false, error: "Task title is required." }, 400);
  const now = new Date().toISOString();
  const task: Task = { id: crypto.randomUUID(), title: body.title.trim(), description: body.description?.trim() || null, status: "pending", priority: body.priority || "medium", assignedTo: parseAssignee(body.assignedTo), dueAt: dueAtOf(body), createdBy: null, createdByName: null, createdAt: now, updatedAt: now };
  const tenantId = c.get("tenantId"), store = workspaceStore();
  await store.write(tenantId, taskFile(task), render(task));
  await ensureLabel(tenantId, "shared", "Shared"); await ensureLabel(tenantId, "shared/tasks", "Tasks");
  return c.json({ success: true, message: "Task created successfully.", task }, 201);
});

taskRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id"), body = object(await c.req.json(), "body");
  validateTask(body);
  const tenantId = c.get("tenantId"), hit = await findTask(tenantId, id);
  if (!hit) return c.json({ success: false, error: "Task not found." }, 404);
  const current = await workspaceStore().read(tenantId, hit.path), parsed = current && parseTask(current.content);
  if (!current || !parsed) return c.json({ success: false, error: "Task not found." }, 404);
  const next: Task = { ...parsed, ...(body.title === undefined ? {} : { title: body.title.trim() }), ...(body.description === undefined ? {} : { description: body.description }), ...(body.status === undefined ? {} : { status: body.status }), ...(body.priority === undefined ? {} : { priority: body.priority }), ...(body.assignedTo === undefined ? {} : { assignedTo: parseAssignee(body.assignedTo) }), ...(body.dueAt === undefined ? {} : { dueAt: dueAtOf(body) }), updatedAt: new Date().toISOString() };
  try { await workspaceStore().write(tenantId, hit.path, render(next), current.version); } catch (e) { if (e instanceof WorkspaceConflict) return c.json({ success: false, error: e.message }, 409); throw e; }
  return c.json({ success: true, message: "Task updated successfully.", task: next });
});

taskRoutes.delete("/:id", async (c) => {
  const tenantId = c.get("tenantId"), hit = await findTask(tenantId, c.req.param("id"));
  if (!hit) return c.json({ success: false, error: "Task not found." }, 404);
  await workspaceStore().remove(tenantId, hit.path);
  return c.json({ success: true, message: "Task deleted successfully." });
});

function validateTask(body: Record<string, any>) {
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) throw new HTTPException(400, { message: "Task title must be non-empty" });
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority)) throw new HTTPException(400, { message: "Invalid task priority" });
  if (body.status !== undefined && !STATUSES.includes(body.status)) throw new HTTPException(400, { message: "Invalid task status" });
  for (const field of ["description", "assignedTo", "discordChannelId"]) if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "string") throw new HTTPException(400, { message: `${field} must be a string or null` });
  if (body.dueAt !== undefined && body.dueAt !== null && body.dueAt !== "" && normalizeDueAt(body.dueAt, DEFAULT_TIMEZONE) === null) throw new HTTPException(400, { message: "dueAt must be a date (YYYY-MM-DD) or a date-time, or null" });
}
// The tenant API has no guild to take a zone from; a date-time without an offset is read in the default zone.
const dueAtOf = (body: Record<string, any>) => (body.dueAt ? normalizeDueAt(body.dueAt, DEFAULT_TIMEZONE) : null);
