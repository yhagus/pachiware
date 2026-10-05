import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { object } from "../validation.js";
import { db, tasks, type Task } from "@pachiware/db";
import { eq, desc, and, like } from "drizzle-orm";

import type { TenantEnv } from "../../middleware/tenant.js";
export const taskRoutes = new Hono<TenantEnv>();

// List all tasks with optional filtering
taskRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const priority = c.req.query("priority");
  const search = c.req.query("search");
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50));

  let query = db.select().from(tasks).$dynamic();
  const conditions = [eq(tasks.tenantId, c.get("tenantId"))];

  if (status && status !== "all") {
    conditions.push(eq(tasks.status, status));
  }

  if (priority && priority !== "all") {
    conditions.push(eq(tasks.priority, priority));
  }

  if (search) {
    conditions.push(like(tasks.title, `%${search}%`));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const results = await query.orderBy(desc(tasks.createdAt)).limit(limit);

  // Group counts for dashboard summary
  const allTasks = await db.select().from(tasks).where(eq(tasks.tenantId, c.get("tenantId")));
  const counts = {
    total: allTasks.length,
    pending: allTasks.filter((t: Task) => t.status === "pending").length,
    in_progress: allTasks.filter((t: Task) => t.status === "in_progress").length,
    completed: allTasks.filter((t: Task) => t.status === "completed").length,
  };

  return c.json({
    success: true,
    counts,
    tasks: results,
  });
});

// Create task
taskRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  validateTask(body);
  const { title, description, priority, assignedTo, discordChannelId } = body;

  if (typeof title !== "string" || !title.trim()) {
    return c.json({ success: false, error: "Task title is required." }, 400);
  }

  const [newTask] = await db
    .insert(tasks)
    .values({
      tenantId: c.get("tenantId"),
      title: title.trim(),
      description: description || null,
      priority: priority || "medium",
      assignedTo: assignedTo || null,
      discordChannelId: discordChannelId || null,
    })
    .returning();

  return c.json({
    success: true,
    message: "Task created successfully.",
    task: newTask,
  }, 201);
});

// Update task
taskRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = object(await c.req.json(), "body");
  validateTask(body);

  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, c.get("tenantId")))).limit(1);
  if (existing.length === 0) {
    return c.json({ success: false, error: "Task not found." }, 404);
  }

  if (body.status !== undefined && !["pending", "in_progress", "completed"].includes(body.status)) return c.json({ error: "Invalid task status" }, 400);
  const updatePayload: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (body.title !== undefined) updatePayload.title = body.title;
  if (body.description !== undefined) updatePayload.description = body.description;
  if (body.status !== undefined) updatePayload.status = body.status;
  if (body.priority !== undefined) updatePayload.priority = body.priority;
  if (body.assignedTo !== undefined) updatePayload.assignedTo = body.assignedTo;
  if (body.discordChannelId !== undefined) updatePayload.discordChannelId = body.discordChannelId;

  const [updated] = await db
    .update(tasks)
    .set(updatePayload)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, c.get("tenantId"))))
    .returning();

  return c.json({
    success: true,
    message: "Task updated successfully.",
    task: updated,
  });
});

// Delete task
taskRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, c.get("tenantId")))).limit(1);

  if (existing.length === 0) {
    return c.json({ success: false, error: "Task not found." }, 404);
  }

  await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, c.get("tenantId"))));

  return c.json({
    success: true,
    message: "Task deleted successfully.",
  });
});

function validateTask(body: Record<string, any>) {
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) throw new HTTPException(400, { message: "Task title must be non-empty" });
  if (body.priority !== undefined && !["low", "medium", "high", "urgent"].includes(body.priority)) throw new HTTPException(400, { message: "Invalid task priority" });
  for (const field of ["description", "assignedTo", "discordChannelId"]) if (body[field] !== undefined && body[field] !== null && typeof body[field] !== "string") throw new HTTPException(400, { message: `${field} must be a string or null` });
}
