import type { SkillModule, SkillContext } from "../types.js";
import { visibleRoots } from "../workspace/paths.js";
import { workspaceStore, WorkspaceConflict, type WorkspaceStore } from "../workspace/store.js";
import { labelFolder } from "./workspace.js";

export const taskManagementSkill: SkillModule = {
  id: "task_management",
  name: "Task Management",
  description: "Create, view, update status, and assign tasks kept as Markdown files in the Workspace.",
  capabilities: ["tasks"],
  allowedScopes: ["tenant"],
  toolPolicy: {
    createTask: { effect: "write", requiresConfirmation: false },
    listTasks: { effect: "read" },
    updateTaskStatus: { effect: "write", requiresConfirmation: true },
    assignTask: { effect: "write", requiresConfirmation: true },
  },
  tools: [
    {
      name: "createTask",
      description: "Creates a new task, filed in the current channel's folder.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, descriptive title of the task" },
          description: { type: "string", description: "Detailed description of the task requirements" },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description: "Task priority level (default: medium)",
          },
          assignedTo: { type: "string", description: "Optional name or ID of the assignee" },
          discordChannelId: { type: "string", description: "Legacy channel ID; the current turn's channel determines the Workspace folder" },
        },
        required: ["title"],
      },
    },
    {
      name: "listTasks",
      description: "Lists tasks filtered by status, assignee, or channel.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "all"],
            description: "Filter by status (default is all active)",
          },
          assignedTo: { type: "string", description: "Filter by assignee username or ID" },
          limit: { type: "number", description: "Max number of tasks to return (default: 20)" },
        },
      },
    },
    {
      name: "updateTaskStatus",
      description: "Updates the status of a specific task by ID.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task to update" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed"],
            description: "The new task status",
          },
        },
        required: ["taskId", "status"],
      },
    },
    {
      name: "assignTask",
      description: "Assigns or reassigns a task to an individual.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task" },
          assignedTo: { type: "string", description: "Username or identifier of the assignee" },
        },
        required: ["taskId", "assignedTo"],
      },
    },
  ],
  handlers: {
    createTask: async (args: { title: string; description?: string; priority?: Priority; assignedTo?: string; discordChannelId?: string }, ctx: SkillContext) => {
      if (typeof args.title !== "string" || !args.title.trim()) throw new Error("Task title is required");
      if (args.title.length > 200) throw new Error("Task title is too long (max 200 characters)");
      if (args.priority !== undefined && !PRIORITIES.includes(args.priority)) throw new Error("Invalid task priority");
      const roots = visibleRoots(ctx), home = roots.channel ?? roots.dm ?? roots.tenant!;
      const now = new Date().toISOString(), id = crypto.randomUUID();
      const task: Task = { id, title: args.title.trim(), description: args.description?.trim() || null, status: "pending", priority: args.priority ?? "medium", assignedTo: args.assignedTo?.trim() || null, createdAt: now, updatedAt: now };
      await workspaceStore().write(ctx.tenantId, `${home}/tasks/${slug(task.title)}-${id.slice(0, 8)}.md`, render(task));
      await labelFolder(ctx, roots.channel ? "channel" : roots.guild ? "guild" : roots.dm ? "dm" : "");
      if (roots.channel) await labelFolder(ctx, "guild");
      try { if (!(await workspaceStore().read(ctx.tenantId, `${home}/tasks/.name`))) await workspaceStore().write(ctx.tenantId, `${home}/tasks/.name`, "Tasks"); } catch {}
      return { success: true, message: `Task "${task.title}" created successfully with ID ${id}.`, task };
    },

    listTasks: async (args: { status?: Status | "all"; assignedTo?: string; limit?: number }, ctx: SkillContext) => {
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
      const found = (await loadTasks(workspaceStore(), ctx))
        .map((f) => f.task)
        .filter((t) => (!args.status || args.status === "all" || t.status === args.status) && (!args.assignedTo || t.assignedTo === args.assignedTo))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return { total: Math.min(found.length, limit), tasks: found.slice(0, limit) };
    },

    updateTaskStatus: async (args: { taskId: string; status: Status }, ctx: SkillContext) => {
      if (!STATUSES.includes(args.status)) throw new Error("Invalid task status");
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, status: args.status }));
      return { success: true, message: `Task "${updated.title}" status changed to ${updated.status}.`, task: updated };
    },

    assignTask: async (args: { taskId: string; assignedTo: string }, ctx: SkillContext) => {
      if (typeof args.assignedTo !== "string" || !args.assignedTo.trim()) throw new Error("assignedTo is required");
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, assignedTo: args.assignedTo.trim() }));
      return { success: true, message: `Task "${updated.title}" assigned to @${updated.assignedTo}.`, task: updated };
    },
  },
};

export const STATUSES = ["pending", "in_progress", "completed"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type Status = (typeof STATUSES)[number];
type Priority = (typeof PRIORITIES)[number];
export interface Task { id: string; title: string; description: string | null; status: Status; priority: Priority; assignedTo: string | null; createdAt: string; updatedAt: string }

export const slug = (title: string) => title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "task";

/** Frontmatter is one `key: JSON value` per line, which is also valid YAML; hand-edited bare values (status: pending) are accepted too. */
export function render(t: Task) {
  const q = JSON.stringify;
  return `---\nid: ${q(t.id)}\ntitle: ${q(t.title)}\nstatus: ${q(t.status)}\npriority: ${q(t.priority)}\nassignedTo: ${q(t.assignedTo)}\ncreatedAt: ${q(t.createdAt)}\nupdatedAt: ${q(t.updatedAt)}\n---\n${t.description ?? ""}\n`;
}
/** A task file, or null when it is not a valid one: a broken file is skipped, never trusted. */
export function parseTask(text: string): Task | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const f: Record<string, any> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const raw = line.slice(i + 1).trim();
    try { f[line.slice(0, i).trim()] = JSON.parse(raw); } catch { f[line.slice(0, i).trim()] = raw; }
  }
  const { id, title, status, priority } = f;
  const validDate = (v: unknown) => typeof v === "string" && !!v && !Number.isNaN(Date.parse(v));
  if (typeof id !== "string" || !/^[0-9a-f-]{8,36}$/i.test(id) || typeof title !== "string" || !title.trim() || !STATUSES.includes(status) || !PRIORITIES.includes(priority) || !validDate(f.createdAt) || !validDate(f.updatedAt)) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { id, title, description: m[2]!.trim() || null, status, priority, assignedTo: str(f.assignedTo), createdAt: str(f.createdAt) ?? "", updatedAt: str(f.updatedAt) ?? "" };
}

interface Found { path: string; version: string; task: Task }
const MAX_FILES = 500, MAX_DEPTH = 8;
/** Every valid task under the folders this turn can see. ponytail: reads files per call; add an index when a Workspace outgrows MAX_FILES task files. */
export async function loadTasks(store: WorkspaceStore, ctx: Pick<SkillContext, "tenantId" | "guildId" | "channelId" | "parentChannelId" | "userId">, shortId?: string): Promise<Found[]> {
  const out: Found[] = [];
  let seen = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await store.list(ctx.tenantId, dir)) {
      if (seen >= MAX_FILES) return;
      const name = e.path.split("/").pop()!;
      if (e.type === "dir") { if (depth < MAX_DEPTH && !name.startsWith(".")) await walk(e.path, depth + 1); continue; }
      if (!name.endsWith(".md")) continue;
      seen++;
      const file = await store.readFrontmatter(ctx.tenantId, e.path).catch(() => null);
      const task = file && parseTask(file.content);
      if (task && (!shortId || task.id.replace(/-/g, "").startsWith(shortId))) out.push({ path: e.path, version: file.version, task });
    }
  };
  for (const root of Object.values(visibleRoots(ctx))) await walk(root, 0);
  return out;
}

/** All valid task files in a tenant, used by the tenant-wide REST API and migration tooling. */
export async function loadAllTasks(store: WorkspaceStore, tenantId: string): Promise<Found[]> {
  const out: Found[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await store.list(tenantId, dir)) {
      const name = e.path.split("/").pop()!;
      if (name.startsWith(".")) continue;
      if (e.type === "dir") { if (depth < MAX_DEPTH + 4) await walk(e.path, depth + 1); continue; }
      if (!name.endsWith(".md")) continue;
      const file = await store.readFrontmatter(tenantId, e.path).catch(() => null);
      const task = file && parseTask(file.content);
      if (task) out.push({ path: e.path, version: file.version, task });
    }
  };
  await walk("", 0);
  return out;
}

async function change(ctx: SkillContext, taskId: string, edit: (t: Task) => Task): Promise<Task> {
  if (typeof taskId !== "string" || !/^[0-9a-f-]{8,36}$/.test(taskId)) throw new Error(`Task with ID ${taskId} not found.`);
  const store = workspaceStore(), [hit] = (await loadTasks(store, ctx, taskId.slice(0, 8))).filter((f) => f.task.id.startsWith(taskId));
  if (!hit) throw new Error(`Task with ID ${taskId} not found.`);
  const current = await store.read(ctx.tenantId, hit.path).catch(() => null), parsed = current && parseTask(current.content);
  if (!current || !parsed) throw new Error(`Task with ID ${taskId} not found.`);
  const next = { ...edit(parsed), updatedAt: new Date().toISOString() };
  try { await store.write(ctx.tenantId, hit.path, render(next), hit.version); }
  catch (e) { if (e instanceof WorkspaceConflict) throw new Error("The task was changed by someone else just now. Try again."); throw e; }
  return next;
}
