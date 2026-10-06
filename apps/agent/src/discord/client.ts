import { Client, GatewayIntentBits, Partials, Events, ChannelType, type Message, type ThreadChannel, EmbedBuilder } from "discord.js";
import { db, bots, agentsConfig, conversations, usageEvents, getBotDecrypted, listAllActiveBots, getTenantById, updateBot, eq } from "@pachiware/db";
import { and, desc } from "drizzle-orm";
import { DiscordJSAdapter } from "./adapter.js";
import { agentReActLoop } from "../loop/react.js";
import { respondReason, threadName, speakerTurn } from "./routing.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { CacheService, tenantKey } from "../cache/redis.js";

type BotRuntime = { client: Client; adapter: DiscordJSAdapter; tenantId: string; connected: boolean; guildIds: string[] };
export class DiscordBotManager {
  private clients = new Map<string, BotRuntime>();
  private operations = new Map<string, Promise<any>>();

  private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const pending = (this.operations.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    this.operations.set(id, pending);
    void pending.finally(() => { if (this.operations.get(id) === pending) this.operations.delete(id); }).catch(() => {});
    return pending;
  }
  async startAll() {
    const active = await listAllActiveBots();
    await Promise.allSettled(active.map(({ bot }: any) => this.startBot(bot.id)));
  }
  startBot(id: string) { return this.serialize(id, () => this.start(id)); }
  restartBot(id: string) { return this.serialize(id, async () => { await this.stop(id); return this.start(id); }); }
  stopBot(id: string) { return this.serialize(id, () => this.stop(id)); }
  removeBot(id: string) { return this.stopBot(id); }
  async stopTenant(tenantId: string) {
    await Promise.all([...this.clients].filter(([, r]) => r.tenantId === tenantId).map(([id]) => this.stopBot(id)));
  }
  private async stop(id: string) {
    const runtime = this.clients.get(id);
    this.clients.delete(id);
    if (runtime) await runtime.client.destroy();
    const [row] = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
    if (row && row.connectionStatus !== "deleted") await updateBot(id, { connectionStatus: "disconnected" });
    return { success: true, message: "Bot stopped." };
  }
  private async start(id: string) {
    if (this.clients.has(id)) return { success: true, message: "Bot already started." };
    let resolved;
    try { resolved = await getBotDecrypted(id); }
    catch { await updateBot(id, { connectionStatus: "error", lastError: "Unable to decrypt bot token." }); return { success: false, message: "Unable to decrypt bot token." }; }
    if (!resolved) return { success: false, message: "Bot not found." };
    const { bot, token } = resolved;
    const tenant = await getTenantById(bot.tenantId);
    if (!bot.isEnabled || tenant?.status !== "active") return { success: false, message: "Bot or tenant is disabled." };
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel, Partials.Message] });
    const runtime: BotRuntime = { client, adapter: new DiscordJSAdapter(client, bot.guildIds[0]), tenantId: bot.tenantId, connected: false, guildIds: bot.guildIds };
    this.clients.set(id, runtime);
    await updateBot(id, { connectionStatus: "connecting", lastError: null });
    client.once(Events.ClientReady, () => {
      if (this.clients.get(id) !== runtime) return;
      runtime.connected = true;
      void updateBot(id, { connectionStatus: "connected", lastConnectedAt: new Date(), lastError: null }).catch(() => {});
    });
    client.on(Events.ShardDisconnect, () => { runtime.connected = false; void updateBot(id, { connectionStatus: "disconnected" }).catch(() => {}); });
    client.on(Events.ShardResume, () => { runtime.connected = true; void updateBot(id, { connectionStatus: "connected" }).catch(() => {}); });
    client.on(Events.Error, () => { void updateBot(id, { lastError: "Discord gateway error" }).catch(() => {}); });
    client.on(Events.MessageCreate, (msg) => { void this.handleMessage(id, msg).catch(() => {}); });
    try {
      await client.login(token);
      return { success: true, message: "Bot gateway started." };
    } catch {
      this.clients.delete(id);
      await client.destroy();
      await updateBot(id, { connectionStatus: "error", lastError: "Discord login failed; verify token, intents, and connectivity." });
      return { success: false, message: "Discord login failed." };
    }
  }
  static async testToken(token: string) {
    if (!token) return { success: false, error: "Bot token is empty." };
    try {
      const response = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bot ${token.trim()}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return { success: false, error: `Discord authentication rejected (${response.status}).` };
      const user = await response.json();
      return { success: true, botTag: user.username, botId: user.id };
    } catch { return { success: false, error: "Failed to reach Discord API." }; }
  }
  async handleMessage(botId: string, msg: Message) {
    const runtime = this.clients.get(botId);
    if (!runtime || msg.author.bot) return;
    const botUserId = runtime.client.user?.id || "";
    const tenant = await getTenantById(runtime.tenantId);
    if (tenant?.status !== "active") return;
    const guild = msg.guildId ? await loadGuildSettings(runtime.tenantId, botId, msg.guildId) : null;
    const trigger = {
      authorIsBot: msg.author.bot, guildId: msg.guildId, allowedGuildIds: runtime.guildIds,
      mentioned: msg.mentions.users.has(botUserId), repliedToBot: false,
      inOwnThread: msg.channel.isThread() && msg.channel.ownerId === botUserId,
      channelId: msg.channelId, alwaysChannelIds: guild?.alwaysChannelIds ?? [],
    };
    let reason = respondReason(trigger);
    // Fetching the referenced message costs an API call, so only do it when nothing else decided.
    if (!reason && msg.reference?.messageId && !trigger.authorIsBot) {
      const ref = await msg.fetchReference().catch(() => null);
      reason = respondReason({ ...trigger, repliedToBot: ref?.author.id === botUserId });
    }
    if (!reason) return;
    const rate = await CacheService.checkRateLimit(tenantKey(runtime.tenantId, `ratelimit:discord:user:${msg.author.id}`), 10, 60);
    if (!rate.allowed) { await msg.reply("Please wait before sending another request."); return; }
    const text = msg.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
    if (!text) return;
    await db.insert(usageEvents).values({ tenantId: runtime.tenantId, botId, type: "discord_message", metadata: { channelId: msg.channelId } });
    // A mention in a plain text channel opens a thread so the follow-ups need no mention; without permission it falls back to the channel.
    let thread: ThreadChannel | null = null;
    if (reason === "mention" && guild?.useThreads && "startThread" in msg && !msg.channel.isThread() && !msg.channel.isDMBased()) {
      thread = await msg.startThread({ name: threadName(text), autoArchiveDuration: 60 }).catch(() => null);
    }
    const channelId = thread?.id ?? msg.channelId;
    // One turn at a time per conversation, so concurrent messages do not interleave history.
    await this.serialize(`conv:${botId}:${channelId}`, () => this.reply(runtime, botId, msg, text, channelId, thread));
  }
  private async reply(runtime: BotRuntime, botId: string, msg: Message, text: string, channelId: string, thread: ThreadChannel | null) {
    const target = thread ?? msg.channel;
    const typing = async () => { try { if ("sendTyping" in target) await target.sendTyping(); } catch {} };
    await typing();
    const interval = setInterval(() => { void typing(); }, 4000);
    const send = (content: string) => thread ? thread.send({ content, allowedMentions: { parse: [] } }) : msg.reply({ content, allowedMentions: { parse: [] } });
    try {
      const [agent] = await db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, runtime.tenantId)).limit(1);
      const [conversation] = await db.select().from(conversations).where(and(eq(conversations.tenantId, runtime.tenantId), eq(conversations.botId, botId), eq(conversations.channelId, channelId))).orderBy(desc(conversations.createdAt)).limit(1);
      const speaker = msg.member?.displayName || msg.author.username;
      const output = await agentReActLoop.run({ tenantId: runtime.tenantId, botId, message: speakerTurn(msg.guildId, speaker, text), conversationId: conversation?.id, maxIterations: agent?.settings?.maxReActIterations || 8, context: { tenantId: runtime.tenantId, platform: "discord", guildId: msg.guildId || undefined, guildName: msg.guild?.name, channelId, userId: msg.author.id, userName: speaker, skillContext: { discord: new DiscordJSAdapter(runtime.client, msg.guildId || runtime.guildIds[0]) } } });
      for (const chunk of output.reply.match(/[^]{1,1900}/g) || ["Done."]) await send(chunk);
      if (output.toolCallsExecuted.length && target.isSendable()) {
        const embed = new EmbedBuilder().setTitle("Actions executed").setColor(0x5865f2);
        for (const { call, result } of output.toolCallsExecuted.slice(0, 5)) embed.addFields({ name: call.name, value: result.success ? "Completed" : "Failed" });
        await target.send({ embeds: [embed] });
      }
    } catch { await send("Unable to process this request. Check your tenant configuration.").catch(() => {}); }
    finally { clearInterval(interval); }
  }
  // Servers and channels come from the live gateway cache, so they are only available while the bot is connected.
  getGuilds(id: string) {
    const runtime = this.clients.get(id);
    if (!runtime?.connected) return null;
    const kinds: Partial<Record<ChannelType, string>> = { [ChannelType.GuildText]: "text", [ChannelType.GuildVoice]: "voice", [ChannelType.GuildAnnouncement]: "announcement", [ChannelType.GuildStageVoice]: "stage", [ChannelType.GuildForum]: "forum" };
    return [...runtime.client.guilds.cache.values()].map((g) => ({
      id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), memberCount: g.memberCount,
      allowed: !runtime.guildIds.length || runtime.guildIds.includes(g.id),
      channels: [...g.channels.cache.values()].filter((c) => c.type in kinds).sort((a: any, b: any) => a.rawPosition - b.rawPosition)
        .map((c: any) => ({ id: c.id, name: c.name, type: kinds[c.type as ChannelType]!, category: c.parent?.name ?? null })),
    }));
  }
  getStatus(id?: string) {
    const rows = [...this.clients].map(([botId, runtime]) => ({ botId, tenantId: runtime.tenantId, connected: runtime.connected, botTag: runtime.client.user?.tag || null, guildCount: runtime.client.guilds.cache.size }));
    return id ? rows.find((row) => row.botId === id) || null : rows;
  }
  getAggregateStatus() { return this.getStatus(); }
}
export const discordBotManager = new DiscordBotManager();
