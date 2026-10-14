import { db, tasks } from "@pachiware/db";
import { parseTask, PRIORITIES, STATUSES, render, slug, type Task } from "../builtin/taskFile.js";
import { parseAssignee } from "../builtin/assignee.js";
import { safeId } from "./paths.js";
import { workspaceStore, type WorkspaceStore } from "./store.js";

const iso = (v: unknown) => { const d = new Date(v as any); return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(); };
async function label(store: WorkspaceStore, tenantId: string, path: string, text: string) {
  const file = `${path}/.name`;
  try { if (!(await store.read(tenantId, file))) await store.write(tenantId, file, text.slice(0, 100)); } catch {}
}

/** Short ids of every task file already in a tenant's Workspace, wherever the agent has since moved it. ponytail: walks the whole tenant tree; fine for a one-off. */
async function existingIds(store: WorkspaceStore, tenantId: string) {
  const ids = new Set<string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await store.list(tenantId, dir)) {
      if (e.type === "dir") { if (depth < 12) await walk(e.path, depth + 1); continue; }
      if (!e.path.endsWith(".md")) continue;
      const file = await store.readFrontmatter(tenantId, e.path).catch(() => null);
      const task = file && parseTask(file.content);
      if (task) ids.add(String(task.id).replace(/-/g, "").slice(0, 8).toLowerCase());
    }
  };
  await walk("", 0);
  return ids;
}

/** One-off: writes every row of the old tasks table as a task file in the Workspace. Safe to rerun; the table is left as it is. */
export async function exportTasks(store: WorkspaceStore = workspaceStore()) {
  const rows = await db.select().from(tasks);
  const seen = new Map<string, Set<string>>();
  let written = 0, skipped = 0;
  for (const row of rows as any[]) {
    const known = seen.get(row.tenantId) ?? await existingIds(store, row.tenantId);
    seen.set(row.tenantId, known);
    const short = String(row.id).replace(/-/g, "").slice(0, 8).toLowerCase();
    if (known.has(short)) { skipped++; continue; }
    const guild = safeId(row.discordGuildId), channel = safeId(row.discordChannelId);
    // A channel id with no guild cannot be placed under a guild folder, so it goes to the tenant's shared folder like unplaced tasks.
    const home = guild && channel ? `guilds/${guild}/channels/${channel}` : guild ? `guilds/${guild}/shared` : "shared";
    const task: Task = {
      id: row.id, title: String(row.title).trim() || "Untitled", description: row.description?.trim() || null,
      status: (STATUSES as readonly string[]).includes(row.status) ? row.status : "pending", priority: (PRIORITIES as readonly string[]).includes(row.priority) ? row.priority : "medium",
      assignedTo: parseAssignee(row.assignedTo), dueAt: null, createdBy: null, createdByName: null, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
    };
    await store.write(row.tenantId, `${home}/tasks/${slug(task.title)}-${short}.md`, render(task));
    await label(store, row.tenantId, home, guild && channel ? `#${channel}` : guild ? `Guild ${guild}` : "Shared");
    await label(store, row.tenantId, `${home}/tasks`, "Tasks");
    known.add(short); written++;
  }
  return { written, skipped };
}

if (import.meta.main) console.log(JSON.stringify(await exportTasks()));
