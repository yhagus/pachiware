import { db, agentsConfig, skills, tasks } from "./index.js";
import { eq } from "drizzle-orm";

export async function runSeed() {
  console.log("🌱 Seeding default database entities...");

  // 1. Seed Agent Configuration
  const existingConfig = await db
    .select()
    .from(agentsConfig)
    .where(eq(agentsConfig.id, "default"))
    .limit(1);

  if (existingConfig.length === 0) {
    await db.insert(agentsConfig).values({
      id: "default",
      name: "Pachiware Agent",
      systemPrompt:
        "You are Pachiware Agent, a helpful, proactive, and precise AI assistant. You help manage Discord servers, organize and track tasks, and solve user problems autonomously. Always use the provided tools to take action when requested, and provide clear summaries.",
      defaultProvider: process.env.DEFAULT_LLM_PROVIDER || "openai",
      defaultModel: process.env.DEFAULT_MODEL || "gpt-4o",
      temperature: 0.7,
      maxTokens: 4096,
      customBaseUrl: process.env.CUSTOM_LLM_BASE_URL || "https://api.9router.com/v1",
      settings: {
        autoArchiveChannels: false,
        discordLogVerbosity: "info",
        maxReActIterations: 8,
      },
    });
    console.log("  [+] Inserted default agent configuration");
  } else {
    console.log("  [*] Agent configuration already exists");
  }

  // 2. Seed Built-in Skills
  const taskManagementSkill = {
    id: "task_management",
    name: "Task Management",
    description: "Create, view, update status, and assign tasks stored in PostgreSQL.",
    isEnabled: true,
    handlerType: "builtin",
    toolDefinitions: [
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
    isEnabled: true,
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

  for (const skill of [taskManagementSkill, discordManagementSkill]) {
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

  // 3. Seed Initial Starter Tasks
  const existingTasks = await db.select().from(tasks).limit(1);
  if (existingTasks.length === 0) {
    await db.insert(tasks).values([
      {
        title: "Setup Discord Server Welcome Channel",
        description: "Create a dedicated onboarding channel with rules and role assignments.",
        status: "completed",
        priority: "high",
        assignedTo: "pachiware-agent",
      },
      {
        title: "Integrate Redis Rate-Limiter",
        description: "Configure token bucket rate limiting for Discord message events and LLM calls.",
        status: "in_progress",
        priority: "high",
        assignedTo: "core-team",
      },
      {
        title: "Build Agent Management Web Dashboard",
        description: "Provide interactive prompt editing, skill toggling, and Kanban task board.",
        status: "in_progress",
        priority: "medium",
        assignedTo: "frontend-team",
      },
    ]);
    console.log("  [+] Inserted sample starter tasks");
  }

  console.log("✅ Seeding completed successfully!");
}

if (import.meta.main || process.argv[1]?.endsWith("seed.ts")) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Seeding failed:", err);
      process.exit(1);
    });
}
