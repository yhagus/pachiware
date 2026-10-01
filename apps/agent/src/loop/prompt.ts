import { db, agentsConfig, tasks, type Task } from "@pachiware/db";
import { eq } from "drizzle-orm";
import { CacheService } from "../cache/redis.js";
import { skillRegistry } from "@pachiware/skills";

export interface PromptContext {
  platform: "discord" | "web";
  guildName?: string;
  guildId?: string;
  channelName?: string;
  channelId?: string;
  userName?: string;
  userId?: string;
}

export class SystemPromptBuilder {
  /**
   * Builds the comprehensive dynamic system prompt.
   */
  static async build(context?: PromptContext): Promise<string> {
    // 1. Fetch agent configuration (check Redis cache first)
    const cacheKey = "agent:config:default";
    let config = await CacheService.get<any>(cacheKey);

    if (!config) {
      const rows = await db
        .select()
        .from(agentsConfig)
        .where(eq(agentsConfig.id, "default"))
        .limit(1);

      config = rows[0] || {
        name: "Pachiware Agent",
        systemPrompt:
          "You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving.",
      };
      await CacheService.set(cacheKey, config, 120); // 2 minute cache
    }

    // 2. Base instructions & personality
    const promptSections: string[] = [];
    promptSections.push(config.systemPrompt);

    // 3. Execution & Tool-Calling guidelines
    promptSections.push(`
### Execution Rules:
- You operate using an explicit ReAct (Reasoning + Action) cycle.
- When a user asks you to create, modify, list, or assign tasks, use the appropriate task management tools.
- When a user asks you to manage Discord channels, topics, or server settings, use the Discord tools.
- Do NOT fabricate tool results. Always observe the output returned by the system.
- Keep your conversational responses concise, clear, and action-oriented.
`);

    // 4. Contextual Platform & Environment Metadata
    if (context) {
      promptSections.push(`
### Current Session Context:
- Platform: ${context.platform}
${context.guildName ? `- Discord Server / Guild: ${context.guildName} (ID: ${context.guildId})` : ""}
${context.channelName ? `- Channel: #${context.channelName} (ID: ${context.channelId})` : ""}
${context.userName ? `- User: ${context.userName} (ID: ${context.userId})` : ""}
`);
    }

    // 5. Active Skills Summary
    const activeTools = await skillRegistry.getActiveTools();
    const toolNames = activeTools.map((t) => `\`${t.name}\``).join(", ");
    promptSections.push(`
### Active Tools Available:
${toolNames.length > 0 ? toolNames : "None currently active."}
`);

    return promptSections.join("\n").trim();
  }
}
