import { repositories, usageEvents } from "@pachiware/db";
import { taskManagementSkill } from "./builtin/tasks.js";
import { discordManagementSkill } from "./builtin/discord.js";
import { gitRepositorySkill } from "./builtin/git.js";
import { workspaceSkill } from "./builtin/workspace.js";
import { remindersSkill } from "./builtin/reminders.js";
import { GuardrailService, audit, isEnforced, policyOf, actionKey, markDone, redact, guardrailMode } from "./guardrails.js";
import { queueAction } from "./gitConfirm.js";
import { resolveAvailability, availabilityPlace, type Availability, type Place } from "./availability.js";
import { listPlaybooks, type Playbook } from "./playbooks.js";
import type {
  SkillModule,
  ToolDefinition,
  ToolCall,
  ToolResult,
  SkillContext,
  ToolHandler,
  CatalogueSkill,
  Effect,
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
    this.registerSkill(remindersSkill);
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

  /** What calling this tool can do; an unknown tool counts as a read. */
  public effectOf(tool: string): Effect {
    const skill = this.skills.get(this.toolToSkillMap.get(tool) ?? "");
    return skill ? policyOf(skill, tool).effect : "read";
  }

  /**
   * Returns all registered skills.
   */
  public getAllSkills(): SkillModule[] {
    return Array.from(this.skills.values());
  }

  /** Every skill with its tools as the code declares them: effect, group and playbook come from toolPolicy, never from the database. */
  public catalogue(): CatalogueSkill[] {
    return this.getAllSkills().map((s) => ({
      id: s.id, name: s.name, description: s.description, groups: s.groups ?? [],
      tools: s.tools.map((t) => { const p = s.toolPolicy?.[t.name]; return { name: t.name, description: t.description, effect: p?.effect, ...(p?.group ? { group: p.group } : {}), ...(p?.playbook ? { playbook: p.playbook } : {}) }; }),
    }));
  }

  /**
   * Loads enabled skills from PostgreSQL (or memory fallback),
   * filtering out disabled skills.
   */
  public async getActiveTools(tenantId: string): Promise<ToolDefinition[]> {
    const enabled = await repositories().skills.listEnabled(tenantId);
    // Sorted so the tool list, which leads the provider's cached prefix, never depends on row order.
    return enabled.flatMap((definition) => this.skills.get(definition.id)?.tools || definition.toolDefinitions).sort((a: ToolDefinition, b: ToolDefinition) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Skills enabled for the tenant, in registry terms (used to classify a request before the loop starts). */
  public async getActiveSkills(tenantId: string): Promise<SkillModule[]> {
    const names = new Set((await this.getActiveTools(tenantId)).map((t) => this.toolToSkillMap.get(t.name)));
    return this.getAllSkills().filter((s) => names.has(s.id));
  }

  /** What the tenant's switched-on skills and its playbooks offer at this place once availability rules apply. A caller holding the playbooks it asks about may pass them. */
  public async availableAt(place: Place, playbooks?: Playbook[]): Promise<Availability> {
    return resolveAvailability(place, await this.getActiveSkills(place.tenantId), playbooks ?? await listPlaybooks(place.tenantId));
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
    if (!(await this.availableAt(availabilityPlace(context))).toolAvailable(name)) {
      await audit(context, "tool_denied", { tool: name, reason: "disabled_or_unavailable" });
      return { toolCallId, name, success: false, error: "Tool is disabled or unavailable here" };
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

    // Guardrail: scope, permission, size, rate, duplicate and confirmation, decided here and not by the model.
    const decision = GuardrailService.checkTool(skill, name, args, context);
    const check = skill.checks?.[name];
    if (check && (decision.allow || decision.kind === "confirmation_required")) {
      try { await check(args, context); } catch (error: any) { return { toolCallId, name, success: false, error: error?.message || String(error) }; }
    }
    if (!decision.allow) {
      const enforced = isEnforced(decision.kind);
      if (decision.kind === "confirmation_required") {
        if (enforced) {
          const { botId, userId, guildId, channelId } = context;
          if (!botId || !userId || !guildId || !channelId) {
            await audit(context, "guardrail_denied", { tool: name, kind: "no_confirmer" });
            return { toolCallId, name, success: false, error: GuardrailService.denyNoConfirmer(context.language).message };
          }
          const summary = `${name} ${redact(JSON.stringify(args ?? {})).slice(0, 600)}`;
          const q = queueAction({ tenantId: context.tenantId, botId, userId, guildId, channelId, parentChannelId: context.parentChannelId, privateThread: context.privateThread, tool: name, args: args ?? {}, summary, auth: context.auth });
          await audit(context, "confirmation_requested", { tool: name, effect: policyOf(skill, name).effect, confirmationId: q.id });
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
      if (policyOf(skill, name).effect !== "read" && !skill.confirmsInternally && guardrailMode() !== "observe") markDone(actionKey(name, args, context));
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
