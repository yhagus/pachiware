import { eq } from "drizzle-orm";
import type { Connection } from "./connection.js";
import { createRepositories } from "./repositories/index.js";
import { insertTenantDefaults } from "./repositories/tenants/sql.js";

/** Gives one tenant of the configured database the defaults it lacks. */
export async function seedTenant(tenantId: string) {
  const { connection } = await import("./index.js");
  await insertTenantDefaults(connection.db, connection.tables, tenantId);
}

/** Registers the built-in skills and tenant defaults in the configured database. */
export async function runSeed() {
  const { connection } = await import("./index.js");
  await seedDatabase(connection);
}

/** Registers the built-in skills in one open database, then gives every tenant the defaults it lacks. */
export async function seedDatabase(connection: Connection) {
  const { db, tables: { skills } } = connection;
  // 2. Seed Built-in Skills
  const taskManagementSkill = {
    id: "task_management",
    name: "Task Management",
    description: "Create, view, update status, and assign tasks stored in the Workspace.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [
      {
        name: "createTask",
        description: "Creates a new task in the current Workspace folder.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, descriptive title of the task" },
            description: { type: "string", description: "Detailed description of the task requirements" },
            priority: {
              type: "string",
              enum: ["low", "medium", "high", "urgent"],
              description: "Task priority level",
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
    config: {},
  };

  const discordManagementSkill = {
    id: "discord_management",
    name: "Discord Management",
    description: "Manage Discord guild channels, topics, archiving, and permissions.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [
      {
        name: "createChannel",
        description: "Creates a new text or voice channel in the Discord guild.",
        parameters: {
          type: "object",
          properties: {
            channelName: { type: "string", description: "Name of the channel to create (kebab-case recommended)" },
            type: {
              type: "string",
              enum: ["text", "voice", "announcement"],
              description: "Type of channel",
            },
            topic: { type: "string", description: "Topic/purpose for the channel" },
            categoryName: { type: "string", description: "Category under which to place the channel" },
          },
          required: ["channelName"],
        },
      },
      {
        name: "archiveChannel",
        description: "Archives a channel by locking permissions or moving to an archive category.",
        parameters: {
          type: "object",
          properties: {
            channelId: { type: "string", description: "The ID or name of the Discord channel to archive" },
            reason: { type: "string", description: "Reason for archiving" },
          },
          required: ["channelId"],
        },
      },
      {
        name: "listChannels",
        description: "Lists all active channels in the connected Discord server.",
        parameters: {
          type: "object",
          properties: {
            filterType: {
              type: "string",
              enum: ["text", "voice", "category", "all"],
              description: "Filter channels by type",
            },
          },
        },
      },
      {
        name: "setChannelTopic",
        description: "Updates the topic/description of a Discord channel.",
        parameters: {
          type: "object",
          properties: {
            channelId: { type: "string", description: "Discord channel ID" },
            topic: { type: "string", description: "The new topic text" },
          },
          required: ["channelId", "topic"],
        },
      },
    ],
    config: {},
  };

  // Tool definitions come from the registry (packages/skills/src/builtin/git.ts) whenever the skill is registered, so none are duplicated here.
  // Off by default: it only does something once a git account is bound to a bot.
  const gitRepositorySkill = {
    id: "git_repositories",
    name: "Git Repositories",
    description: "Read and change repositories on the git account connected to this bot (GitHub, GitLab, self-hosted GitLab).",
    defaultEnabled: false,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  // Tool definitions come from the registry (packages/skills/src/builtin/workspace.ts).
  const workspaceSkill = {
    id: "workspace",
    name: "Workspace",
    description: "Keep notes and memory as Markdown files in this tenant's Workspace.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  const remindersSkill = {
    id: "reminders",
    name: "Reminders",
    description: "Post a message at a time a person chose, where they asked, pinging them.",
    defaultEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [],
    config: {},
  };

  for (const skill of [taskManagementSkill, discordManagementSkill, gitRepositorySkill, workspaceSkill, remindersSkill]) {
    const existing = await db.select().from(skills).where(eq(skills.id, skill.id)).limit(1);
    if (existing.length === 0) {
      await db.insert(skills).values(skill);
      console.log(`  [+] Registered skill: ${skill.name}`);
    } else {
      await db
        .update(skills)
        .set({
          name: skill.name,
          description: skill.description,
          toolDefinitions: skill.toolDefinitions,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, skill.id));
      console.log(`  [*] Updated skill: ${skill.name}`);
    }
  }

  await createRepositories(connection).tenants.seedDefaults();
  console.log("Platform skills and tenant defaults seeded.");
}

if (import.meta.main) runSeed().then(() => process.exit(0)).catch(() => { console.error("Seed failed."); process.exit(1); });
