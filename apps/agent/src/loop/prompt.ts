import { db, agentsConfig, tasks, getGuildConfig, type Task } from "@pachiware/db";
import { eq, and, ne } from "drizzle-orm";
import { CacheService, tenantKey } from "../cache/redis.js";
import { skillRegistry } from "@pachiware/skills";

export type GuildSettings = { systemPrompt: string | null; useThreads: boolean; alwaysChannelIds: string[] };
const guildDefaults: GuildSettings = { systemPrompt: null, useThreads: true, alwaysChannelIds: [] };
export const guildCacheKey = (tenantId: string, botId: string, guildId: string) => tenantKey(tenantId, `guild:${botId}:${guildId}`);

export async function loadGuildSettings(tenantId: string, botId: string, guildId: string): Promise<GuildSettings> {
  const key = guildCacheKey(tenantId, botId, guildId);
  const cached = await CacheService.get<GuildSettings>(key);
  if (cached) return cached;
  const row = await getGuildConfig(botId, guildId);
  const settings = row ? { systemPrompt: row.systemPrompt, useThreads: row.useThreads, alwaysChannelIds: row.alwaysChannelIds } : guildDefaults;
  await CacheService.set(key, settings, 120);
  return settings;
}

export interface PromptContext {
  tenantId: string;
  botId?: string;
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
   * Builds the system prompt. It must stay identical between turns of a conversation (no user, time or task data),
   * because providers cache the prompt prefix; anything that changes belongs in buildDynamic.
   */
  static async build(context: PromptContext): Promise<string> {
    // 1. Fetch agent configuration (check Redis cache first)
    const cacheKey = tenantKey(context.tenantId, "agent:config");
    let config = await CacheService.get<any>(cacheKey);

    if (!config) {
      const rows = await db
        .select()
        .from(agentsConfig)
        .where(eq(agentsConfig.tenantId, context.tenantId))
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

    const guild = context.botId && context.guildId ? await loadGuildSettings(context.tenantId, context.botId, context.guildId) : null;
    if (guild?.systemPrompt?.trim()) promptSections.push(`### Server instructions (${context.guildName ?? "this server"}):\n${guild.systemPrompt.trim()}`);

    // 3. Execution & Tool-Calling guidelines
    promptSections.push(`
### Execution Rules:
- You operate using an explicit ReAct (Reasoning + Action) cycle.
- When a user asks you to create, modify, list, or assign tasks, use the appropriate task management tools.
- When a user asks you to manage Discord channels, topics, or server settings, use the Discord tools.
- Do NOT fabricate tool results. Always observe the output returned by the system.
- Keep your conversational responses concise, clear, and action-oriented.
`);

    // 5. Active Skills Summary
    const activeTools = await skillRegistry.getActiveTools(context.tenantId);
    const toolNames = activeTools.map((t) => `\`${t.name}\``).join(", ");
    if (context.guildName) promptSections.push(`### Server:\n- Discord Server / Guild: ${context.guildName} (ID: ${context.guildId})`);
    promptSections.push(`
### Active Tools Available:
${toolNames.length > 0 ? toolNames : "None currently active."}
`);

    return promptSections.join("\n").trim();
  }

  /** Per-turn details, appended after the user's message so they never break the cached prefix. */
  static async buildDynamic(context: PromptContext): Promise<string> {
    const lines = [`Platform: ${context.platform}`];
    if (context.channelName || context.channelId) lines.push(`Channel: ${context.channelName ? `#${context.channelName} ` : ""}(ID: ${context.channelId})`);
    if (context.userName) lines.push(`User: ${context.userName} (ID: ${context.userId})`);
    const activeTasks: Task[] = await db.select().from(tasks).where(and(eq(tasks.tenantId, context.tenantId), ne(tasks.status, "completed"))).orderBy(tasks.createdAt, tasks.id).limit(10);
    if (activeTasks.length) lines.push("Active tasks:", ...activeTasks.map((task) => `${task.id}: ${task.title} (${task.status})`));
    return lines.join("\n");
  }
}
