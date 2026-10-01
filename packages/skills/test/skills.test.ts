import { describe, expect, it } from "bun:test";
import { skillRegistry } from "../src/registry.js";
import { db } from "@pachiware/db";

describe("Skill Harness & Tools Verification", () => {
  it("should have built-in skills registered", () => {
    const skills = skillRegistry.getAllSkills();
    expect(skills.length).toBeGreaterThanOrEqual(2);

    const taskSkill = skillRegistry.getSkill("task_management");
    expect(taskSkill).toBeDefined();
    expect(taskSkill?.tools.some((t) => t.name === "createTask")).toBe(true);

    const discordSkill = skillRegistry.getSkill("discord_management");
    expect(discordSkill).toBeDefined();
    expect(discordSkill?.tools.some((t) => t.name === "createChannel")).toBe(true);
  });

  it("should convert tools to OpenAI and Anthropic formats", async () => {
    const activeTools = await skillRegistry.getActiveTools();
    expect(activeTools.length).toBeGreaterThan(0);

    const openaiTools = skillRegistry.toOpenAITools(activeTools);
    expect(openaiTools[0].type).toBe("function");
    expect(openaiTools[0].function.name).toBeDefined();

    const anthropicTools = skillRegistry.toAnthropicTools(activeTools);
    expect(anthropicTools[0].name).toBeDefined();
    expect(anthropicTools[0].input_schema).toBeDefined();
  });

  it("should execute createTask and listTasks tools with PostgreSQL", async () => {
    const context = { db };

    // 1. Create a task via skill tool call
    const createResult = await skillRegistry.executeTool(
      {
        id: "call-1",
        name: "createTask",
        arguments: {
          title: "Test Automated Verification Task",
          description: "Created by automated bun:test suite",
          priority: "urgent",
          assignedTo: "tester-bot",
        },
      },
      context
    );

    expect(createResult.success).toBe(true);
    expect(createResult.data.task.id).toBeDefined();
    expect(createResult.data.task.title).toBe("Test Automated Verification Task");

    const createdTaskId = createResult.data.task.id;

    // 2. Update task status
    const updateResult = await skillRegistry.executeTool(
      {
        id: "call-2",
        name: "updateTaskStatus",
        arguments: {
          taskId: createdTaskId,
          status: "completed",
        },
      },
      context
    );

    expect(updateResult.success).toBe(true);
    expect(updateResult.data.task.status).toBe("completed");

    // 3. List tasks
    const listResult = await skillRegistry.executeTool(
      {
        id: "call-3",
        name: "listTasks",
        arguments: {
          status: "completed",
          limit: 5,
        },
      },
      context
    );

    expect(listResult.success).toBe(true);
    expect(listResult.data.tasks.some((t: any) => t.id === createdTaskId)).toBe(true);
  });

  it("should gracefully handle Discord tools in simulation mode when discord client not connected", async () => {
    const context = { db };

    const channelResult = await skillRegistry.executeTool(
      {
        id: "call-4",
        name: "createChannel",
        arguments: {
          channelName: "dev-discussion",
          type: "text",
          topic: "Discussion about backend engineering",
        },
      },
      context
    );

    expect(channelResult.success).toBe(true);
    expect(channelResult.data.simulated).toBe(true);
    expect(channelResult.data.channel.name).toBe("dev-discussion");
  });

  it("should return error for unknown tool call", async () => {
    const context = { db };
    const result = await skillRegistry.executeTool(
      {
        id: "call-err",
        name: "nonExistentTool",
        arguments: {},
      },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });
});
