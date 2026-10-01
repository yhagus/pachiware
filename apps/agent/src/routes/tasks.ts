import { Hono } from "hono";
import { db, tasks, type Task } from "@pachiware/db";
import { eq, desc, and, ilike } from "drizzle-orm";

export const taskRoutes = new Hono();

// List all tasks with optional filtering
taskRoutes.get("/", async (c) => {
  const status = c.req.query("status");
  const priority = c.req.query("priority");
  const search = c.req.query("search");
  const limit = parseInt(c.req.query("limit") || "50", 10);

  let query = db.select().from(tasks).$dynamic();
  const conditions = [];

  if (status && status !== "all") {
    conditions.push(eq(tasks.status, status));
  }

  if (priority && priority !== "all") {
    conditions.push(eq(tasks.priority, priority));
  }

  if (search) {
    conditions.push(ilike(tasks.title, `%${search}%`));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const results = await query.orderBy(desc(tasks.createdAt)).limit(limit);

  // Group counts for dashboard summary
  const allTasks = await db.select().from(tasks);
  const counts = {
    total: allTasks.length,
    pending: allTasks.filter((t) => t.status === "pending").length,
    in_progress: allTasks.filter((t) => t.status === "in_progress").length,
    completed: allTasks.filter((t) => t.status === "completed").length,
  };

  return c.json({
    success: true,
    counts,
    tasks: results,
  });
});

// Create task
taskRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const { title, description, priority, assignedTo, discordChannelId } = body;

  if (!title || typeof title !== "string") {
    return c.json({ success: false, error: "Task title is required." }, 400);
  }

  const [newTask] = await db
    .insert(tasks)
    .values({
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
  const body = await c.req.json();

  const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (existing.length === 0) {
    return c.json({ success: false, error: "Task not found." }, 404);
  }

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
    .where(eq(tasks.id, id))
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
  const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

  if (existing.length === 0) {
    return c.json({ success: false, error: "Task not found." }, 404);
  }

  await db.delete(tasks).where(eq(tasks.id, id));

  return c.json({
    success: true,
    message: "Task deleted successfully.",
  });
});
