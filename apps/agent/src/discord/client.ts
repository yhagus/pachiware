import { Client, GatewayIntentBits, Partials, Events, ChannelType, type Message, type ThreadChannel, type MessageContextMenuCommandInteraction } from "discord.js";
import { db, bots, agentsConfig, conversations, usageEvents, getBotDecrypted, listAllActiveBots, getTenantById, updateBot, eq } from "@pachiware/db";
import { and, desc } from "drizzle-orm";
import { DiscordJSAdapter } from "./adapter.js";
import { agentReActLoop } from "../loop/react.js";
import { respondReason, isNoise, threadName, speakerTurn } from "./routing.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { CacheService, tenantKey } from "../cache/redis.js";
import { pendingOf, confirmMessage, handleConfirmButton } from "./gitConfirm.js";
import { listPlaybooks, boundPlaybook, readBinding, writeBinding, missingSkills, skillRegistry, type Playbook } from "@pachiware/skills";

const BURST_MS = 2500;
const MESSAGE_COMMAND = 3; // ApplicationCommandType.Message
type BotRuntime = { client: Client; adapter: DiscordJSAdapter; tenantId: string; connected: boolean; guildIds: string[] };
/** Who a turn acts for: the message author, or the person who ran a command on someone else's message. */
type Actor = { id: string; name: string; member: any };
const actorOf = (m: Message): Actor => ({ id: m.author.id, name: m.member?.displayName || m.author.username, member: m.member });
// A guild member from the cache has a roles collection; one sent raw with an interaction has an id array.
const memberAuth = (m: any) => ({ roleIds: Array.isArray(m?.roles) ? m.roles : m?.roles?.cache ? [...m.roles.cache.keys()] : [], permissions: m?.permissions?.toArray?.() ?? [] });
const TRIGGER = /^([\p{L}\p{N}_-]{1,32})\s*(?::|\n)\s*([\s\S]*)$/u;
export class DiscordBotManager {
  private clients = new Map<string, BotRuntime>();
  private operations = new Map<string, Promise<any>>();
  private bursts = new Map<string, { items: { msg: Message; text: string }[]; timer: ReturnType<typeof setTimeout> }>();
  private inflight = new Set<Promise<unknown>>();
  constructor(private burstMs = BURST_MS) {}
  private track(work: Promise<unknown>) {
    const tracked = work.catch(() => {}).finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }
  /** Resolves once no gateway event, burst, or reply is still being handled. */
  async idle() {
    while (this.inflight.size || this.bursts.size || this.operations.size) await new Promise((r) => setTimeout(r, 5));
  }

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
      this.track(this.registerCommands(runtime));
    });
    client.on(Events.ShardDisconnect, () => { runtime.connected = false; void updateBot(id, { connectionStatus: "disconnected" }).catch(() => {}); });
    client.on(Events.ShardResume, () => { runtime.connected = true; void updateBot(id, { connectionStatus: "connected" }).catch(() => {}); });
    client.on(Events.Error, () => { void updateBot(id, { lastError: "Discord gateway error" }).catch(() => {}); });
    client.on(Events.InteractionCreate, (i) => {
      if (i.isButton()) this.track(handleConfirmButton(i as any, id, (guildId) => new DiscordJSAdapter(client, guildId)));
      else if (i.isMessageContextMenuCommand()) this.track(this.handleCommand(id, i));
    });
    client.on(Events.MessageCreate, (msg) => { this.track(this.handleMessage(id, msg)); });
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
  /** One message context-menu command per playbook that names one; Discord allows five per app. */
  private async registerCommands(runtime: BotRuntime) {
    if (!runtime.client.application) return;
    const menus = [...new Set((await listPlaybooks(runtime.tenantId)).map((p) => p.menu).filter((m): m is string => !!m))].slice(0, 5);
    await runtime.client.application.commands.set(menus.map((name) => ({ name, type: MESSAGE_COMMAND })));
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
    const channelId0 = msg.channelId;
    const parentId = msg.channel.isThread() ? msg.channel.parentId : null;
    const bound = msg.guildId && parentId ? await boundPlaybook(runtime.tenantId, { guildId: msg.guildId, channelId: parentId, threadId: channelId0 }) : null;
    // A thread bound to a playbook is the bot's to follow even when someone else opened it.
    const ownThread = msg.channel.isThread() && (msg.channel.ownerId === botUserId || !!bound);
    const shared = ownThread || (guild?.alwaysChannelIds ?? []).includes(channelId0);
    const others = [...msg.mentions.users.keys()].some((id) => id !== botUserId) && !msg.mentions.users.has(botUserId);
    const trigger = {
      authorIsBot: msg.author.bot, guildId: msg.guildId, allowedGuildIds: runtime.guildIds,
      mentioned: msg.mentions.users.has(botUserId), repliedToBot: false,
      inOwnThread: ownThread,
      channelId: channelId0, alwaysChannelIds: guild?.alwaysChannelIds ?? [],
      lastMessageFromBot: false, addressesOthers: others,
    };
    // Fetching costs an API call, so only do it when the answer can change the decision.
    if (msg.guildId && shared && msg.reference?.messageId) {
      const ref = await msg.fetchReference().catch(() => null);
      trigger.repliedToBot = ref?.author.id === botUserId;
      if (ref && !trigger.repliedToBot) trigger.addressesOthers = true;
    }
    if (shared && !trigger.mentioned && !trigger.repliedToBot && !trigger.addressesOthers && !(guild?.alwaysChannelIds ?? []).includes(channelId0)) {
      const prev = await msg.channel.messages.fetch({ limit: 1, before: msg.id }).catch(() => null);
      trigger.lastMessageFromBot = prev?.first()?.author.id === botUserId;
    }
    let reason = respondReason(trigger);
    if (!reason && !shared && msg.reference?.messageId) {
      const ref = await msg.fetchReference().catch(() => null);
      reason = respondReason({ ...trigger, repliedToBot: ref?.author.id === botUserId });
    }
    if (!reason) return;
    const text = msg.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
    if (isNoise(text, msg.attachments.size > 0)) return;
    const rate = await CacheService.checkRateLimit(tenantKey(runtime.tenantId, `ratelimit:discord:user:${msg.author.id}`), 10, 60);
    if (!rate.allowed) { await msg.react("⏳").catch(() => {}); return; }
    if (!text) return;
    await db.insert(usageEvents).values({ tenantId: runtime.tenantId, botId, type: "discord_message", metadata: { channelId: msg.channelId } });
    if (trigger.mentioned && msg.guildId && !bound && await this.triggerPlaybook(runtime, botId, msg, text)) return;
    // A mention in a plain text channel opens a thread so the follow-ups need no mention; without permission it falls back to the channel.
    let thread: ThreadChannel | null = null;
    if (reason === "mention" && guild?.useThreads && "startThread" in msg && !msg.channel.isThread() && !msg.channel.isDMBased()) {
      thread = await msg.startThread({ name: threadName(text), autoArchiveDuration: 60 }).catch(() => null);
    }
    const channelId = thread?.id ?? msg.channelId;
    // One turn at a time per conversation, so concurrent messages do not interleave history.
    const run = (m: Message, turn: string) => this.serialize(`conv:${botId}:${channelId}`, () => this.reply(runtime, botId, m, turn, channelId, thread, { playbook: bound?.playbook }));
    const speakerOf = (m: Message) => m.member?.displayName || m.author.username;
    if (!msg.guildId || thread) { await run(msg, speakerTurn(msg.guildId, speakerOf(msg), text)); return; }
    // Burst of messages in a shared channel: wait for a pause, then answer once with all of them.
    const key = `${botId}:${channelId}`;
    const burst = this.bursts.get(key) ?? { items: [] as { msg: Message; text: string }[], timer: undefined as any };
    burst.items.push({ msg, text });
    clearTimeout(burst.timer);
    burst.timer = setTimeout(() => {
      this.bursts.delete(key);
      const last = burst.items[burst.items.length - 1].msg;
      void run(last, burst.items.map((i) => speakerTurn(i.msg.guildId, speakerOf(i.msg), i.text)).join("\n")).catch(() => {});
    }, this.burstMs);
    this.bursts.set(key, burst);
  }
  /** "@bot issue: points" starts the playbook whose trigger word leads the message. */
  private async triggerPlaybook(runtime: BotRuntime, botId: string, msg: Message, text: string) {
    const m = TRIGGER.exec(text);
    if (!m || !m[2]!.trim()) return false;
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.words.includes(m[1]!.toLowerCase()));
    if (!playbook) return false;
    const opened = await this.openPlaybook(runtime, botId, playbook, msg, m[2]!.trim(), actorOf(msg));
    if ("error" in opened) await msg.reply({ content: opened.error, allowedMentions: { parse: [] } }).catch(() => {});
    else await opened.start();
    return true;
  }
  async handleCommand(botId: string, i: MessageContextMenuCommandInteraction) {
    const runtime = this.clients.get(botId);
    if (!runtime) return;
    const say = (content: string) => i.reply({ content, ephemeral: true }).catch(() => {});
    if ((await getTenantById(runtime.tenantId))?.status !== "active") return say("This bot is turned off.");
    if (!i.guildId || (runtime.guildIds.length && !runtime.guildIds.includes(i.guildId))) return say("Playbooks run only in the servers this bot is set up for.");
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.menu === i.commandName);
    if (!playbook) return say("This command is no longer available.");
    const opened = await this.openPlaybook(runtime, botId, playbook, i.targetMessage, i.targetMessage.content.trim(), { id: i.user.id, name: (i.member as any)?.displayName || i.user.username, member: i.member });
    if ("error" in opened) return say(opened.error);
    await say(`Following the ${playbook.name} playbook in <#${opened.thread.id}>.`);
    await opened.start();
  }
  /** Checks the playbook's skills, opens or reuses the source message's thread, and binds it; `start` runs the first turn there. */
  private async openPlaybook(runtime: BotRuntime, botId: string, playbook: Playbook, source: Message, brief: string, actor: Actor): Promise<{ error: string } | { thread: ThreadChannel; start: () => Promise<void> }> {
    const missing = missingSkills(playbook, (await skillRegistry.getActiveSkills(runtime.tenantId)).map((s) => s.id));
    if (missing.length) {
      const names = missing.map((id) => skillRegistry.getAllSkills().find((s) => s.id === id)?.name ?? id).join(" and ");
      return { error: `The ${playbook.name} playbook needs the ${names} skill${missing.length > 1 ? "s" : ""}, which ${missing.length > 1 ? "are" : "is"} off here. An admin can turn ${missing.length > 1 ? "them" : "it"} on in the console.` };
    }
    const thread = source.channel.isThread() ? source.channel as ThreadChannel
      : source.thread ?? await source.startThread({ name: threadName(brief), autoArchiveDuration: 1440 }).catch(() => null);
    if (!thread?.parentId || !source.guildId) return { error: "I couldn't open a thread for this message. Check that I can create threads in this channel." };
    const place = { guildId: source.guildId, channelId: thread.parentId, threadId: thread.id };
    const previous = await readBinding(runtime.tenantId, place).catch(() => null);
    if (previous?.binding.status === "active") return { error: `This thread already follows the ${previous.binding.playbook} playbook.` };
    const saved = await writeBinding(runtime.tenantId, { playbook: playbook.name, status: "active", ...place, authorId: actor.id, sourceMessageId: source.id, startedAt: new Date().toISOString() }, `${brief}\n`, previous?.version).catch(() => null);
    if (!saved) return { error: "I couldn't save this thread to the Workspace, so the playbook did not start. Try again in a moment." };
    const turn = speakerTurn(source.guildId, source.member?.displayName || source.author.username, brief);
    return { thread, start: () => this.serialize(`conv:${botId}:${thread.id}`, () => this.reply(runtime, botId, source, turn, thread.id, thread, { actor, playbook })) };
  }
  private async reply(runtime: BotRuntime, botId: string, msg: Message, turn: string, channelId: string, thread: ThreadChannel | null, opts: { actor?: Actor; playbook?: Playbook } = {}) {
    const target = thread ?? msg.channel;
    const typing = async () => { try { if ("sendTyping" in target) await target.sendTyping(); } catch {} };
    await typing();
    const interval = setInterval(() => { void typing(); }, 4000);
    const send = (content: string) => thread ? thread.send({ content, allowedMentions: { parse: [] } }) : msg.reply({ content, allowedMentions: { parse: [] } });
    try {
      const [agent] = await db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, runtime.tenantId)).limit(1);
      const [conversation] = await db.select().from(conversations).where(and(eq(conversations.tenantId, runtime.tenantId), eq(conversations.botId, botId), eq(conversations.channelId, channelId))).orderBy(desc(conversations.createdAt)).limit(1);
      const actor = opts.actor ?? actorOf(msg);
      const playbook = opts.playbook && { name: opts.playbook.name, body: opts.playbook.body };
      const output = await agentReActLoop.run({ tenantId: runtime.tenantId, botId, message: turn, conversationId: conversation?.id, maxIterations: agent?.settings?.maxReActIterations || 12, context: { tenantId: runtime.tenantId, platform: "discord", guildId: msg.guildId || undefined, guildName: msg.guild?.name, channelId, userId: actor.id, userName: actor.name, playbook, skillContext: { member: memberAuth(actor.member), discord: new DiscordJSAdapter(runtime.client, msg.guildId || runtime.guildIds[0]), parentChannelId: (msg.channel.isThread() ? msg.channel.parentId : msg.channelId) ?? undefined } } });
      for (const chunk of output.reply.match(/[^]{1,1900}/g) || ["Done."]) await send(chunk);
      if (output.toolCallsExecuted.length && target.isSendable()) {
        // Git write actions never run on the model's say-so: each one gets Confirm/Cancel buttons for the person who asked.
        for (const { result } of output.toolCallsExecuted) {
          const p = result.success ? pendingOf(result.data) : null;
          if (p) await target.send(confirmMessage(p, actor.id));
        }
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
