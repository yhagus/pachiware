import { db, skills as skillsTable, tenantSkills, usageEvents } from "@pachiware/db";
import { eq, and } from "drizzle-orm";
import { taskManagementSkill } from "./builtin/tasks.js";
import { discordManagementSkill } from "./builtin/discord.js";
import type {
  SkillModule,
  ToolDefinition,
  ToolCall,
  ToolResult,
  SkillContext,
  ToolHandler,
} from "./types.js";

export class SkillRegistry {
  private skills: Map<string, SkillModule> = new Map();
  private toolToSkillMap: Map<string, string> = new Map();

  constructor() {
    // Register built-in skills by default
    this.registerSkill(taskManagementSkill);
    this.registerSkill(discordManagementSkill);
  }

  /**
   * Registers a skill module in memory.
   */
  public registerSkill(skill: SkillModule): void {
    this.skills.set(skill.id, skill);
    for (const tool of skill.tools) {
      this.toolToSkillMap.set(tool.name, skill.id);
    }
  }

  /**
   * Unregisters a skill module.
   */
  public unregisterSkill(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) {
      for (const tool of skill.tools) {
        this.toolToSkillMap.delete(tool.name);
      }
      this.skills.delete(skillId);
    }
  }

  /**
   * Returns a specific registered skill.
   */
  public getSkill(skillId: string): SkillModule | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Returns all registered skills.
   */
  public getAllSkills(): SkillModule[] {
    return Array.from(this.skills.values());
  }

  /**
   * Loads enabled skills from PostgreSQL (or memory fallback),
   * filtering out disabled skills.
   */
  public async getActiveTools(tenantId: string): Promise<ToolDefinition[]> {
    const rows = await db.select({ definition: skillsTable, state: tenantSkills }).from(tenantSkills)
      .innerJoin(skillsTable, eq(tenantSkills.skillId, skillsTable.id))
      .where(and(eq(tenantSkills.tenantId, tenantId), eq(tenantSkills.isEnabled, true)));
    return rows.flatMap(({ definition }: any) => this.skills.get(definition.id)?.tools || definition.toolDefinitions);
  }

  /**
   * Converts ToolDefinitions into OpenAI function calling format:
   * [ { type: "function", function: { name, description, parameters } } ]
   */
  public toOpenAITools(tools: ToolDefinition[]): any[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Converts ToolDefinitions into Anthropic tool format:
   * [ { name, description, input_schema } ]
   */
  public toAnthropicTools(tools: ToolDefinition[]): any[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /**
   * Executes a tool call using the appropriate registered handler and context.
   */
  public async executeTool(toolCall: ToolCall, context: SkillContext): Promise<ToolResult> {
    const result = await this.executeInternal(toolCall, context);
    if (context.tenantId) await context.db.insert(usageEvents).values({ tenantId: context.tenantId, botId: context.botId || null, type: "tool_call", metadata: { name: toolCall.name, success: result.success } });
    return result;
  }

  private async executeInternal(
    toolCall: ToolCall,
    context: SkillContext
  ): Promise<ToolResult> {
    const { id: toolCallId, name, arguments: args } = toolCall;
    if (!context.tenantId) return { toolCallId, name, success: false, error: "Tenant context required" };
    const allowed = await this.getActiveTools(context.tenantId);
    if (!allowed.some((tool) => tool.name === name)) return { toolCallId, name, success: false, error: "Tool is disabled or unavailable for this tenant" };
    const skillId = this.toolToSkillMap.get(name);

    if (!skillId) {
      return {
        toolCallId,
        name,
        success: false,
        error: `Unknown tool "${name}". No skill registered to handle this action.`,
      };
    }

    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        toolCallId,
        name,
        success: false,
        error: `Skill "${skillId}" not found for tool "${name}".`,
      };
    }

    const handler = skill.handlers[name];
    if (!handler) {
      return {
        toolCallId,
        name,
        success: false,
        error: `Handler for tool "${name}" not implemented in skill "${skillId}".`,
      };
    }

    try {
      const data = await handler(args, context);
      return {
        toolCallId,
        name,
        success: true,
        data,
      };
    } catch (error: any) {
      return {
        toolCallId,
        name,
        success: false,
        error: error?.message || String(error),
      };
    }
  }
}

// Global shared instance
export const skillRegistry = new SkillRegistry();
