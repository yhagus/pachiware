import { db, skills as skillsTable, tenantSkills, usageEvents } from "@pachiware/db";
import { eq, and } from "drizzle-orm";
import { taskManagementSkill } from "./builtin/tasks.js";
import { discordManagementSkill } from "./builtin/discord.js";
import { gitRepositorySkill } from "./builtin/git.js";
import { workspaceSkill } from "./builtin/workspace.js";
import { GuardrailService, audit, isEnforced, policyOf, actionKey, markDone, redact, guardrailMode } from "./guardrails.js";
import { queueAction } from "./gitConfirm.js";
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
    this.registerSkill(gitRepositorySkill);
    this.registerSkill(workspaceSkill);
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
    // Sorted so the tool list, which leads the provider's cached prefix, never depends on row order.
    return rows.flatMap(({ definition }: any) => this.skills.get(definition.id)?.tools || definition.toolDefinitions).sort((a: ToolDefinition, b: ToolDefinition) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Skills enabled for the tenant, in registry terms (used to classify a request before the loop starts). */
  public async getActiveSkills(tenantId: string): Promise<SkillModule[]> {
    const names = new Set((await this.getActiveTools(tenantId)).map((t) => this.toolToSkillMap.get(t.name)));
    return this.getAllSkills().filter((s) => names.has(s.id));
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
    const { id: toolCallId, name } = toolCall;
    // "confirmed" is a host flag on the context; the same word in model arguments is dropped so it can neither skip the gate nor split the duplicate key.
    const { confirmed: _ignored, ...args } = (toolCall.arguments ?? {}) as Record<string, any>;
    if (!context.tenantId) return { toolCallId, name, success: false, error: "Tenant context required" };
    const allowed = await this.getActiveTools(context.tenantId);
    if (!allowed.some((tool) => tool.name === name)) {
      await audit(context, "tool_denied", { tool: name, reason: "disabled_or_unavailable" });
      return { toolCallId, name, success: false, error: "Tool is disabled or unavailable for this tenant" };
    }
    const skillId = this.toolToSkillMap.get(name);

    if (!skillId) {
      await audit(context, "tool_denied", { tool: name, reason: "unknown" });
      return { toolCallId, name, success: false, error: `Unknown tool "${name}". No skill registered to handle this action.` };
    }

    const skill = this.skills.get(skillId);
    if (!skill) {
      return { toolCallId, name, success: false, error: `Skill "${skillId}" not found for tool "${name}".` };
    }

    const handler = skill.handlers[name];
    if (!handler) {
      return { toolCallId, name, success: false, error: `Handler for tool "${name}" not implemented in skill "${skillId}".` };
    }

    // Guardrail: scope, role, size, rate, duplicate and confirmation, decided here and not by the model.
    const decision = GuardrailService.checkTool(skill, name, args, context);
    if (!decision.allow) {
      const enforced = isEnforced(decision.kind);
      if (decision.kind === "confirmation_required") {
        if (enforced) {
          const { botId, userId, guildId, channelId } = context;
          if (!botId || !userId || !guildId || !channelId) {
            await audit(context, "guardrail_denied", { tool: name, kind: "no_confirmer" });
            return { toolCallId, name, success: false, error: "This action needs a person to confirm it, which only works in a Discord channel." };
          }
          const summary = `${name} ${redact(JSON.stringify(args ?? {})).slice(0, 600)}`;
          const q = queueAction({ tenantId: context.tenantId, botId, userId, guildId, channelId, parentChannelId: context.parentChannelId, tool: name, args: args ?? {}, summary, auth: context.auth });
          await audit(context, "confirmation_requested", { tool: name, risk: policyOf(skill, name).risk, confirmationId: q.id });
          await audit(context, "thread_confirmation_requested", { tool: name, confirmationId: q.id });
          return { toolCallId, name, success: true, data: { pending: true, confirmationId: q.id, summary, note: "Nothing has changed yet. Tell the user to press Confirm or Cancel on the message that appears in the channel. Do not call this tool again." } };
        }
        await audit(context, "guardrail_denied", { tool: name, kind: decision.kind, observed: true });
      } else {
        await audit(context, "guardrail_denied", { tool: name, kind: decision.kind, observed: !enforced });
        if (enforced) return { toolCallId, name, success: false, error: decision.message };
      }
    }

    try {
      const data = await handler(args, context);
      if (policyOf(skill, name).risk !== "read" && !skill.confirmsInternally && guardrailMode() !== "observe") markDone(actionKey(name, args, context));
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
