import { tasks, type Task } from "@pachiware/db";
import { eq, and, desc } from "drizzle-orm";
import type { SkillModule, SkillContext } from "../types.js";

export const taskManagementSkill: SkillModule = {
  id: "task_management",
  name: "Task Management",
  description: "Create, view, update status, and assign tasks stored in PostgreSQL.",
  tools: [
    {
      name: "createTask",
      description: "Creates a new task in the database.",
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
          discordChannelId: { type: "string", description: "Optional Discord channel ID associated with this task" },
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
    createTask: async (
      args: {
        title: string;
        description?: string;
        priority?: "low" | "medium" | "high" | "urgent";
        assignedTo?: string;
        discordChannelId?: string;
      },
      context: SkillContext
    ) => {
      const channelId = args.discordChannelId || context.channelId || null;
      const guildId = context.guildId || null;

      const [newTask] = await context.db
        .insert(tasks)
        .values({
          title: args.title,
          description: args.description || null,
          priority: args.priority || "medium",
          assignedTo: args.assignedTo || null,
          discordChannelId: channelId,
          discordGuildId: guildId,
        })
        .returning();

      return {
        success: true,
        message: `Task "${newTask.title}" created successfully with ID ${newTask.id}.`,
        task: newTask,
      };
    },

    listTasks: async (
      args: {
        status?: "pending" | "in_progress" | "completed" | "all";
        assignedTo?: string;
        limit?: number;
      },
      context: SkillContext
    ) => {
      const limit = args.limit || 20;
      let query = context.db.select().from(tasks).$dynamic();

      const conditions = [];

      if (args.status && args.status !== "all") {
        conditions.push(eq(tasks.status, args.status));
      }

      if (args.assignedTo) {
        conditions.push(eq(tasks.assignedTo, args.assignedTo));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const results = await query.orderBy(desc(tasks.createdAt)).limit(limit);

      return {
        total: results.length,
        tasks: results,
      };
    },

    updateTaskStatus: async (
      args: { taskId: string; status: "pending" | "in_progress" | "completed" },
      context: SkillContext
    ) => {
      const existing = await context.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, args.taskId))
        .limit(1);

      if (existing.length === 0) {
        throw new Error(`Task with ID ${args.taskId} not found.`);
      }

      const [updated] = await context.db
        .update(tasks)
        .set({
          status: args.status,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, args.taskId))
        .returning();

      return {
        success: true,
        message: `Task "${updated.title}" status changed to ${updated.status}.`,
        task: updated,
      };
    },

    assignTask: async (
      args: { taskId: string; assignedTo: string },
      context: SkillContext
    ) => {
      const existing = await context.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, args.taskId))
        .limit(1);

      if (existing.length === 0) {
        throw new Error(`Task with ID ${args.taskId} not found.`);
      }

      const [updated] = await context.db
        .update(tasks)
        .set({
          assignedTo: args.assignedTo,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, args.taskId))
        .returning();

      return {
        success: true,
        message: `Task "${updated.title}" assigned to @${updated.assignedTo}.`,
        task: updated,
      };
    },
  },
};
