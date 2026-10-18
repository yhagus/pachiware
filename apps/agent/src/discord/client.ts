import { Client, GatewayIntentBits, Partials, Events, ChannelType, type Attachment, type SendableChannels, type ChatInputCommandInteraction, type Message, type ThreadChannel, type MessageContextMenuCommandInteraction } from "discord.js";
import { repositories } from "@pachiware/db";
import { DiscordJSAdapter } from "./adapter.js";
import { catchUpDailyLogs } from "./dailyLogDays.js";
import { agentReActLoop } from "../loop/react.js";
import { rollSummary } from "../loop/summary.js";
import { respondReason, addressed, isNoise, threadName, speakerTurn, speakerName, keepableId, withoutMention, placeOfChannel, replyLine } from "./routing.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { CacheService, tenantKey } from "../cache/redis.js";
import { pendingOf, confirmMessage, handleConfirmButton } from "./gitConfirm.js";
import { listPlaybooks, withLoads, onPlaybooksChanged, onAvailabilityChanged, boundPlaybook, readBinding, writeBinding, bindingPlace, rewriteBinding, availabilityPlace, skillRegistry, recordBriefInput, takeBriefInput, inputTurn, outsiderTurn, authorDecidesNote, presetPointsTurn, recordBriefImages, unseeBriefImages, replyLanguage, textIn, configuredLanguage, configuredTimezone, today, threadRepositoryOf, threadDocumentsOf, anyRepositoryAllowed, issueBatchReport, moveOldThreadFiles, type Language, type Playbook, type PlaybookBinding } from "@pachiware/skills";
import { guildCommands } from "./commands.js";
import { forgetDeletedMessage } from "./dailyLog.js";
import { prepareReply, replyQuietly, withNotes, type ReplyPlan } from "./replyStyle.js";
import { gatherTurnImages, fileTurnDocuments, withPlaceholders } from "./attachments.js";
import { briefTurn, showDrafts, afterBriefConfirm } from "./briefThread.js";
import { llmRouter } from "../llm/router.js";
import { botCompletion } from "../llm/completion.js";
import { MINUTES_PLAYBOOK, RECENT_MS, minutesRefusal, writeMinutes, minutesFileOf, correctMinutes, minutesBrief, namedNumbers, type MinutesBrief } from "./minutes.js";

const BURST_MS = 2500;
// Admin edits often come in a run (several rules saved one after another); one registration covers them.
const COMMANDS_MS = 2000;
// `replyTo` is the message a person replied to, when it could be fetched; it gets its own line before theirs.
type TurnItem = { msg: Message; text: string; direct?: boolean; replyTo?: Message | null };
/** `sentCommands` holds each guild's last overwrite as JSON, so an unchanged guild is not sent again. */
type BotRuntime = { client: Client; adapter: DiscordJSAdapter; tenantId: string; connected: boolean; guildIds: string[]; globalCleared: boolean; sentCommands: Map<string, string> };
/** A Discord adapter of a bot bound to `guildId` (else its first served guild) and limited to the guilds it serves now. */
const adapterFor = (runtime: Pick<BotRuntime, "client" | "guildIds">, guildId?: string | null) => new DiscordJSAdapter(runtime.client, guildId || runtime.guildIds[0], runtime.guildIds);
/** Who a turn acts for: the message author, or the person who ran a command on someone else's message. */
type Actor = { id: string; name: string; member: any };
const actorOf = (m: Message): Actor => ({ id: m.author.id, name: speakerName(m), member: m.member });
const commandActor = (i: ChatInputCommandInteraction | MessageContextMenuCommandInteraction): Actor => ({ id: i.user.id, name: speakerName({ member: i.member as any, author: i.user }), member: i.member });
const attachmentsOf = (file: Attachment | null) => new Map(file ? [[file.id, file]] : []);
/** How a start from somewhere other than its source message goes: `announce` posts the source once the checks pass, and `turnOf` makes the first turn from it. */
type PlaybookOpening = { fromMinutes?: MinutesBrief; announce?: () => Promise<Message | null>; turnOf?: (source: Message) => Message; threadName?: string };
/**
 * A slash start's first turn as if the person had posted it at the bot's public line: their name, and their file as the line's attachment,
 * so it is filed or seen like any message attachment. Defined properties shadow the line's own getters.
 */
const slashTurn = (line: Message, i: ChatInputCommandInteraction, file: Attachment | null): Message => Object.create(line, {
  author: { value: i.user }, member: { value: i.member },
  attachments: { value: attachmentsOf(file) },
});
/**
 * A slash command run in place has no message to answer, so its turn stands in for one from the person in that channel: their file as
 * its attachment, and a reply to it posted to the channel.
 */
const commandTurn = (i: ChatInputCommandInteraction, channel: SendableChannels, file: Attachment | null): Message => ({
  id: i.id, guildId: i.guildId, guild: i.guild, channelId: i.channelId, channel, author: i.user, member: i.member, content: "",
  attachments: attachmentsOf(file), reply: (payload: any) => channel.send(payload), react: async () => {},
}) as unknown as Message;
// A guild member from the cache has a roles collection; one sent raw with an interaction has an id array.
const memberAuth = (m: any) => ({ roleIds: Array.isArray(m?.roles) ? m.roles : m?.roles?.cache ? [...m.roles.cache.keys()] : [], permissions: m?.permissions?.toArray?.() ?? [] });
const TRIGGER = /^([\p{L}\p{N}_-]{1,32})\s*(?::|\n)\s*([\s\S]*)$/u;
const WORD_ONLY = /^([\p{L}\p{N}_-]{1,32})[.!?]?$/u;
/** Where something was asked: a message, or the channel a command was run in. */
type Where = Pick<Message, "guildId" | "channelId" | "channel">;
/** How an in-place playbook was started: `message` is the menu target, the mention, or a slash stand-in; `about` is the message a mention replies to. */
type InPlaceStart = {
  from: "menu" | "mention" | "slash"; message: Message; about?: Message | null; actor: Actor; text: string; language?: Language;
  refuse(text: string): Promise<unknown>; ack?(text: string): Promise<unknown>; fail(text: string): Promise<unknown>;
};
/** The bot's newest message among the last 50 of a channel or thread, or null. */
async function lastOwnMessage(channel: Where["channel"], botUserId: string | undefined): Promise<Message | null> {
  if (!botUserId || !("messages" in channel)) return null;
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  return recent?.find((m) => m.author.id === botUserId) ?? null;
}
/** Where a message's availability rules come from: a thread follows its parent channel. */
const placeOf = (tenantId: string, botId: string, m: Where) => availabilityPlace({ tenantId, botId, guildId: m.guildId ?? undefined, channelId: m.channelId, parentChannelId: m.channel.isThread() ? m.channel.parentId ?? undefined : undefined });
/**
 * Why the playbook cannot start where `at` was posted: it, a playbook it loads, or a skill its chain requires is off there, or its chain
 * needs a repository and git scope allows none. Null when it can start.
 */
async function playbookRefusal(tenantId: string, botId: string, playbook: Playbook, at: Where, language?: Language) {
  const playbooks = await listPlaybooks(tenantId), place = placeOf(tenantId, botId, at);
  const cause = (await skillRegistry.availableAt(place, playbooks)).playbookCause(playbook.name);
  const t = textIn(language);
  if (!cause) {
    const noRepository = withLoads(playbook, playbooks).repository === "required" && !await anyRepositoryAllowed(place);
    return noRepository ? t.repositoryNone(playbook.name) : null;
  }
  switch (cause.off) {
    case "playbook": return t.playbookOff(playbook.name);
    case "loads": return t.loadsOff(playbook.name, cause.playbook);
    case "chain": return t.chainBroken(playbook.name, cause.problem);
    case "skills": return t.skillsOff(playbook.name, cause.skills.map((id) => skillRegistry.getAllSkills().find((s) => s.id === id)?.name ?? id));
  }
}
export class DiscordBotManager {
  private clients = new Map<string, BotRuntime>();
  private operations = new Map<string, Promise<any>>();
  private bursts = new Map<string, { items: TurnItem[]; timer: ReturnType<typeof setTimeout> }>();
  private inflight = new Set<Promise<unknown>>();
  private commandTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private burstMs = BURST_MS, private commandsMs = COMMANDS_MS) {
    onPlaybooksChanged((tenantId) => this.refreshCommands(tenantId));
    onAvailabilityChanged((tenantId) => this.refreshCommands(tenantId));
  }
  private track(work: Promise<unknown>) {
    const tracked = work.catch(() => {}).finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
  }
  /** Work that outlives the request that started it, such as a Daily log backfill; `idle()` waits for it. */
  background(work: Promise<unknown>) { this.track(work); }
  /** What a person deletes does not live on in a Daily log; a thread's message sits in its parent channel's. Discord may send only the ids. */
  private async forgetDeleted(runtime: BotRuntime, msg: Pick<Message, "id" | "channelId" | "guildId" | "createdTimestamp"> & { channel?: Message["channel"] | null }) {
    if (!msg.guildId || !runtime.guildIds.includes(msg.guildId)) return;
    const channel = msg.channel ?? await runtime.client.channels.fetch(msg.channelId).catch(() => null);
    const channelId = channel?.isThread() ? channel.parentId : msg.channelId;
    if (!channelId) return;
    await this.serialize(`daily-log:${runtime.tenantId}:${channelId}`, () => forgetDeletedMessage({
      tenantId: runtime.tenantId, guildId: msg.guildId!, channelId, messageChannelId: msg.channelId, messageId: msg.id, createdAt: msg.createdTimestamp,
    }));
  }
  /** The gateway client of a running, connected bot; the scheduler posts through it. */
  clientOf(botId: string): Client | null {
    const runtime = this.clients.get(botId);
    return runtime?.connected ? runtime.client : null;
  }
  /** A Discord adapter of a running, connected bot, bound to `guildId` and limited to the guilds the bot serves. */
  adapterOf(botId: string, guildId?: string): DiscordJSAdapter | null {
    const runtime = this.clients.get(botId);
    return runtime?.connected ? adapterFor(runtime, guildId) : null;
  }
  /** Resolves once no gateway event, burst, or reply is still being handled. */
  async idle() {
    while (this.inflight.size || this.bursts.size || this.operations.size || this.commandTimers.size) await new Promise((r) => setTimeout(r, 5));
  }

  private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const pending = (this.operations.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    this.operations.set(id, pending);
    void pending.finally(() => { if (this.operations.get(id) === pending) this.operations.delete(id); }).catch(() => {});
    return pending;
  }
  async startAll() {
    const active = await repositories().bots.listRunnable();
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
    await repositories().bots.update(id, { connectionStatus: "disconnected" });
    return { success: true, message: "Bot stopped." };
  }
  private async start(id: string) {
    if (this.clients.has(id)) return { success: true, message: "Bot already started." };
    let resolved;
    try { resolved = await repositories().bots.getWithToken(id); }
    catch { await repositories().bots.update(id, { connectionStatus: "error", lastError: "Unable to decrypt bot token." }); return { success: false, message: "Unable to decrypt bot token." }; }
    if (!resolved) return { success: false, message: "Bot not found." };
    const { bot, token } = resolved;
    const tenant = await repositories().tenants.get(bot.tenantId);
    if (!bot.isEnabled || tenant?.status !== "active") return { success: false, message: "Bot or tenant is disabled." };
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel, Partials.Message] });
    const runtime: BotRuntime = { client, adapter: adapterFor({ client, guildIds: bot.guildIds }), tenantId: bot.tenantId, connected: false, guildIds: bot.guildIds, globalCleared: false, sentCommands: new Map() };
    this.clients.set(id, runtime);
    await repositories().bots.update(id, { connectionStatus: "connecting", lastError: null });
    client.once(Events.ClientReady, () => {
      if (this.clients.get(id) !== runtime) return;
      runtime.connected = true;
      void repositories().bots.update(id, { connectionStatus: "connected", lastConnectedAt: new Date(), lastError: null }).catch(() => {});
      this.scheduleCommands(id);
      this.track(this.moveOldThreadFiles(runtime));
      this.track(catchUpDailyLogs(this, id));
    });
    client.on(Events.GuildCreate, () => { if (runtime.connected) this.scheduleCommands(id); });
    client.on(Events.GuildDelete, (guild) => { runtime.sentCommands.delete(guild.id); });
    client.on(Events.ShardDisconnect, () => { runtime.connected = false; void repositories().bots.update(id, { connectionStatus: "disconnected" }).catch(() => {}); });
    client.on(Events.ShardResume, () => { runtime.connected = true; void repositories().bots.update(id, { connectionStatus: "connected" }).catch(() => {}); });
    client.on(Events.Error, () => { void repositories().bots.update(id, { lastError: "Discord gateway error" }).catch(() => {}); });
    client.on(Events.InteractionCreate, (i) => {
      if (i.isButton()) this.track(handleConfirmButton(i as any, id, (guildId) => new DiscordJSAdapter(client, guildId), async (action, result) => (await afterBriefConfirm(runtime.client, runtime.tenantId, action, result)) ?? issueBatchReport(action.tool, result)));
      else if (i.isMessageContextMenuCommand()) this.track(this.handleCommand(id, i));
      else if (i.isChatInputCommand()) this.track(this.handleSlash(id, i));
    });
    client.on(Events.MessageCreate, (msg) => { this.track(this.handleMessage(id, msg)); });
    // Edits are not listened for: a Daily log describes the day as it was talked about.
    client.on(Events.MessageDelete, (msg) => { this.track(this.forgetDeleted(runtime, msg)); });
    try {
      await client.login(token);
      return { success: true, message: "Bot gateway started." };
    } catch {
      this.clients.delete(id);
      await client.destroy();
      await repositories().bots.update(id, { connectionStatus: "error", lastError: "Discord login failed; verify token, intents, and connectivity." });
      return { success: false, message: "Discord login failed." };
    }
  }
  /**
   * The one-time move of old private-thread Minutes and Notes (ADR 0009), in each guild this bot serves and is in: a thread is looked up
   * only there, since one that cannot be looked up counts as private.
   */
  private async moveOldThreadFiles(runtime: BotRuntime) {
    const kindOf = async (threadId: string) => {
      const channel = await runtime.client.channels.fetch(threadId).catch(() => null);
      return channel && channel.type !== ChannelType.PrivateThread ? "public" as const : "private" as const;
    };
    for (const guildId of runtime.guildIds.filter((g) => runtime.client.guilds.cache.has(g))) {
      const report = await moveOldThreadFiles(runtime.tenantId, guildId, kindOf).catch(() => null);
      for (const { from, to } of report?.taken ?? []) console.warn(`Kept in place, "${to}" is taken: ${from}`);
    }
  }
  /** Re-registers the commands of every running bot of the tenant, so an edited playbook or rule needs no restart. */
  refreshCommands(tenantId: string) {
    for (const [id, runtime] of this.clients) if (runtime.tenantId === tenantId && runtime.connected) this.scheduleCommands(id);
  }
  /** Debounced: changes that arrive while a registration is waiting join it. */
  private scheduleCommands(id: string) {
    if (this.commandTimers.has(id)) return;
    this.commandTimers.set(id, setTimeout(() => {
      this.commandTimers.delete(id);
      const runtime = this.clients.get(id);
      if (runtime) this.track(this.serialize(`commands:${id}`, () => this.registerCommands(id, runtime)));
    }, this.commandsMs));
  }
  /** One bulk overwrite per guild, sent only when its list changed; a guild the bot is not set up for gets an empty list, and older versions' global list is emptied. */
  private async registerCommands(botId: string, runtime: BotRuntime) {
    const application = runtime.client.application;
    if (!application || this.clients.get(botId) !== runtime) return;
    if (!runtime.globalCleared) {
      await application.commands.fetch().then(async (global) => { if (global.size) await application.commands.set([]); runtime.globalCleared = true; }).catch(() => {});
    }
    const playbooks = await listPlaybooks(runtime.tenantId);
    const refused: string[] = [];
    for (const guildId of runtime.client.guilds.cache.keys()) {
      const setUp = !runtime.guildIds.length || runtime.guildIds.includes(guildId);
      const commands = setUp ? await guildCommands({ tenantId: runtime.tenantId, botId, guildId }, playbooks) : [];
      const sent = JSON.stringify(commands);
      if (runtime.sentCommands.get(guildId) === sent) continue;
      // One guild refusing (no applications.commands scope there) must not keep the others from their commands.
      try { await application.commands.set(commands, guildId); runtime.sentCommands.set(guildId, sent); } catch { refused.push(guildId); }
    }
    if (refused.length) await repositories().bots.update(botId, { lastError: `Discord refused the slash commands in server ${refused.join(", ")}; they are sent again on the next change.` }).catch(() => {});
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
    const tenant = await repositories().tenants.get(runtime.tenantId);
    if (tenant?.status !== "active") return;
    // The replied-to message, fetched at most once: routing, the Minutes check and the turn line share it.
    let referenced: Promise<Message | null> | undefined;
    const reference = () => (referenced ??= msg.reference?.messageId ? msg.fetchReference().catch(() => null) : Promise.resolve(null));
    const guild = msg.guildId ? await loadGuildSettings(runtime.tenantId, botId, msg.guildId) : null;
    const channelId0 = msg.channelId;
    const parentId = msg.channel.isThread() ? msg.channel.parentId : null;
    const bound = msg.guildId && parentId ? await boundPlaybook(runtime.tenantId, { guildId: msg.guildId, channelId: parentId, threadId: channelId0 }) : null;
    // A playbook thread is its starting bot's alone; a binding from before bots were recorded is open to any.
    if (bound?.binding.botId && bound.binding.botId !== botId) return;
    // A playbook no longer available here, or one its chain loads, ends its thread's binding; the message that finds out gets the one note instead of an answer.
    if (bound && (await skillRegistry.availableAt(placeOf(runtime.tenantId, botId, msg))).playbookCause(bound.playbook.name)) {
      const ended = await rewriteBinding(runtime.tenantId, bindingPlace(bound.binding), ({ binding }) => binding.status === "active" ? { binding: { ...binding, status: "cancelled" as const }, value: true } : null).catch(() => null);
      if (ended) await replyQuietly(msg)(textIn(replyLanguage(msg.content)).playbookEnded(bound.playbook.name));
      return;
    }
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
      const ref = await reference();
      trigger.repliedToBot = ref?.author.id === botUserId;
      if (ref && !trigger.repliedToBot) trigger.addressesOthers = true;
    }
    // In a bound thread only the author decides: anyone else's message is kept as input for them and acknowledged, not answered.
    const place = bound && bindingPlace(bound.binding);
    const outsider = !!bound && msg.author.id !== bound.binding.authorId;
    const keepInput = async () => {
      const said = withoutMention(msg.content, botUserId).trim();
      if (!place || isNoise(said, msg.attachments.size > 0)) return false;
      return !!await recordBriefInput(runtime.tenantId, place, { messageId: msg.id, userId: msg.author.id, name: speakerName(msg), text: said || "[attachment]" }).catch(() => null);
    };
    if (outsider && !addressed(trigger)) { if (await keepInput()) await msg.react("👀").catch(() => {}); return; }
    if (shared && !trigger.mentioned && !trigger.repliedToBot && !trigger.addressesOthers && !(guild?.alwaysChannelIds ?? []).includes(channelId0)) {
      const prev = await msg.channel.messages.fetch({ limit: 1, before: msg.id }).catch(() => null);
      trigger.lastMessageFromBot = prev?.first()?.author.id === botUserId;
    }
    let reason = respondReason(trigger);
    if (!reason && bound && !outsider) reason = "direct";
    if (!reason && !shared && msg.reference?.messageId) {
      const ref = await reference();
      trigger.repliedToBot = ref?.author.id === botUserId;
      reason = respondReason(trigger);
    }
    if (!reason) return;
    const direct = addressed(trigger);
    const text = withoutMention(msg.content, botUserId).trim();
    if (isNoise(text, msg.attachments.size > 0)) { if (direct) await msg.react("👀").catch(() => {}); return; }
    const rate = await CacheService.checkRateLimit(tenantKey(runtime.tenantId, `ratelimit:discord:user:${msg.author.id}`), 10, 60);
    if (!rate.allowed) { await msg.react("⏳").catch(() => {}); return; }
    if (!text && !msg.attachments.size) return;
    await repositories().usage.record({ tenantId: runtime.tenantId, botId, type: "discord_message", metadata: { channelId: msg.channelId } });
    if (text && msg.guildId && msg.reference?.messageId) {
      const ref = await reference();
      if (ref?.author.id === botUserId && minutesFileOf(ref)) {
        if (await this.briefFromMinutes(runtime, botId, msg, ref, text)) return;
        await this.serialize(`minutes:${ref.id}`, () => correctMinutes({ tenantId: runtime.tenantId, botId, guildId: msg.guildId!, minutesMessage: ref, reply: msg, text }));
        return;
      }
    }
    if (trigger.mentioned && await this.triggerPlaybook(runtime, botId, msg, text, !!bound)) return;
    if (outsider) await keepInput();
    // A mention in a plain text channel opens a thread so the follow-ups need no mention; without permission it falls back to the channel.
    let thread: ThreadChannel | null = null;
    if (reason === "mention" && guild?.useThreads && "startThread" in msg && !msg.channel.isThread() && !msg.channel.isDMBased()) {
      thread = await msg.startThread({ name: threadName(text), autoArchiveDuration: 60 }).catch(() => null);
    }
    const channelId = thread?.id ?? msg.channelId;
    // One turn at a time per conversation, so concurrent messages do not interleave history.
    const run = (m: Message, items: TurnItem[]) => this.serialize(`conv:${botId}:${channelId}`, () => this.reply(runtime, botId, m, items, channelId, thread, { playbook: bound?.playbook, binding: bound?.binding, direct: items.some((i) => i.direct !== false) }));
    const replyTo = await reference();
    if (!msg.guildId || thread) { await run(msg, [{ msg, text, direct, replyTo }]); return; }
    // Burst of messages in a shared channel: wait for a pause, then answer once with all of them.
    const key = `${botId}:${channelId}`;
    const burst = this.bursts.get(key) ?? { items: [] as TurnItem[], timer: undefined as any };
    burst.items.push({ msg, text, direct, replyTo });
    clearTimeout(burst.timer);
    burst.timer = setTimeout(() => {
      this.bursts.delete(key);
      const last = burst.items[burst.items.length - 1].msg;
      void run(last, burst.items).catch(() => {});
    }, this.burstMs);
    this.bursts.set(key, burst);
  }
  /** "@bot issue: points" starts the playbook whose trigger word leads the message; an in-place one such as "@bot minutes" needs no points. */
  private async triggerPlaybook(runtime: BotRuntime, botId: string, msg: Message, text: string, bound: boolean) {
    const m = TRIGGER.exec(text) ?? WORD_ONLY.exec(text);
    if (!m) return false;
    const word = m[1]!.toLowerCase();
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.words.includes(word) || (p.name === word && p.start));
    if (!playbook) return false;
    const say = replyQuietly(msg);
    if (playbook.run === "in-place") {
      const about = msg.reference ? await msg.fetchReference().catch(() => null) : undefined;
      await this.runInPlace(runtime, botId, playbook, { from: "mention", message: msg, about, actor: actorOf(msg), text: m[2]?.trim() ?? "", language: replyLanguage(text), refuse: say, fail: say });
      return true;
    }
    if (bound || !msg.guildId || !m[2]?.trim()) return false;
    const opened = await this.openPlaybook(runtime, botId, playbook, msg, m[2]!.trim(), actorOf(msg));
    if ("error" in opened) await say(opened.error);
    else await opened.start();
    return true;
  }
  /** "@bot turn points 2 and 3 into issues" replying to minutes: an explicit mention naming a playbook's word starts it from those action items. */
  private async briefFromMinutes(runtime: BotRuntime, botId: string, msg: Message, minutes: Message, text: string) {
    if (!new RegExp(`<@!?${runtime.client.user?.id}>`).test(msg.content)) return false;
    const said = text.toLowerCase();
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.run === "thread" && p.words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}_])${w}s?(?![\\p{L}\\p{N}_])`, "u").test(said)));
    if (!playbook) return false;
    const say = replyQuietly(msg);
    const brief = await minutesBrief(runtime.tenantId, minutes, namedNumbers(text), replyLanguage(text));
    if ("error" in brief) { await say(brief.error); return true; }
    const opened = await this.openPlaybook(runtime, botId, playbook, minutes, brief.text, actorOf(msg), { fromMinutes: brief });
    if ("error" in opened) await say(opened.error);
    else await opened.start();
    return true;
  }
  async handleCommand(botId: string, i: MessageContextMenuCommandInteraction) {
    const runtime = this.clients.get(botId);
    if (!runtime) return;
    // Discord drops an interaction left unanswered for 3 seconds, so defer before the tenant and Workspace lookups.
    if (!await i.deferReply({ ephemeral: true }).then(() => true, () => false)) return;
    const target = i.targetMessage, language = replyLanguage(target.content), t = textIn(language);
    const say = (content: string) => i.editReply({ content }).catch(() => {});
    if ((await repositories().tenants.get(runtime.tenantId))?.status !== "active") return say(t.botOff);
    if (!i.guildId || (runtime.guildIds.length && !runtime.guildIds.includes(i.guildId))) return say(t.wrongServer);
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.menu === i.commandName);
    if (!playbook) return say(t.commandGone);
    const actor = commandActor(i);
    if (playbook.run === "in-place") {
      return this.runInPlace(runtime, botId, playbook, {
        from: "menu", message: target, actor, text: target.content.trim(), language, refuse: say, ack: say,
        fail: (content) => i.followUp({ content, ephemeral: true }).catch(() => {}),
      });
    }
    // Run on posted minutes, the brief is their action items rather than the embed's text.
    const minutes = target.author.id === runtime.client.user?.id && minutesFileOf(target) ? await minutesBrief(runtime.tenantId, target, [], language) : null;
    if (minutes && "error" in minutes) return say(minutes.error);
    const opened = await this.openPlaybook(runtime, botId, playbook, target, minutes?.text ?? target.content.trim(), actor, { fromMinutes: minutes ?? undefined });
    if ("error" in opened) return say(opened.error);
    await say(t.following(playbook.name, opened.thread.id));
    await opened.start();
  }
  /** "/issue-draft text:... file:..." starts that playbook from a public line the bot posts; the person hears privately where it went, or why it did not start. */
  async handleSlash(botId: string, i: ChatInputCommandInteraction) {
    const runtime = this.clients.get(botId);
    if (!runtime) return;
    // Discord drops an interaction left unanswered for 3 seconds, so defer before the tenant and Workspace lookups.
    if (!await i.deferReply({ ephemeral: true }).then(() => true, () => false)) return;
    const text = i.options.getString("text")?.trim() ?? "", file = i.options.getAttachment("file");
    const language = replyLanguage(text), t = textIn(language);
    const say = (content: string) => i.editReply({ content }).catch(() => {});
    if ((await repositories().tenants.get(runtime.tenantId))?.status !== "active") return say(t.botOff);
    if (!i.guildId || !i.channel?.isSendable() || (runtime.guildIds.length && !runtime.guildIds.includes(i.guildId))) return say(t.wrongServer);
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.name === i.commandName && p.start);
    if (!playbook) return say(t.commandGone);
    const channel = i.channel;
    const actor = commandActor(i);
    if (playbook.run === "in-place") {
      return this.runInPlace(runtime, botId, playbook, {
        from: "slash", message: commandTurn(i, channel, file), actor, text, language, refuse: say, ack: say,
        fail: (content) => i.followUp({ content, ephemeral: true }).catch(() => {}),
      });
    }
    const opened = await this.openPlaybook(runtime, botId, playbook, { guildId: i.guildId, channelId: i.channelId, channel }, text, actor, {
      announce: () => channel.send({ content: t.started(i.user.id, playbook.name), allowedMentions: { parse: [] } }).catch(() => null),
      turnOf: (line) => slashTurn(line, i, file),
      threadName: playbook.name,
    });
    if ("error" in opened) return say(opened.error);
    await say(t.following(playbook.name, opened.thread.id));
    await opened.start();
  }
  /** Checks the playbook can start at `at`, opens or reuses the source message's thread, and binds it; `start` runs the first turn there. */
  private async openPlaybook(runtime: BotRuntime, botId: string, playbook: Playbook, at: Where, brief: string, actor: Actor, opening: PlaybookOpening = {}): Promise<{ error: string } | { thread: ThreadChannel; start: () => Promise<void> }> {
    const { fromMinutes, announce } = opening;
    const language = replyLanguage(brief), t = textIn(language);
    const refusal = await playbookRefusal(runtime.tenantId, botId, playbook, at, language);
    if (refusal) return { error: refusal };
    // Asked inside a thread, the thread is known before anything is posted, so its binding refuses the start first.
    if (announce && at.channel.isThread() && at.channel.parentId && at.guildId) {
      const bound = await readBinding(runtime.tenantId, { guildId: at.guildId, channelId: at.channel.parentId, threadId: at.channelId }).catch(() => null);
      if (bound?.binding.status === "active") return { error: t.alreadyBound(bound.binding.playbook) };
    }
    const source = announce ? await announce() : at as Message;
    if (!source) return { error: t.noThread };
    // What can only fail after the public line is posted takes the line back, so a start that did not happen leaves nothing behind.
    const refuse = async (error: string) => { if (announce) await source.delete().catch(() => {}); return { error }; };
    const thread = source.channel.isThread() ? source.channel as ThreadChannel
      : source.thread ?? await source.startThread({ name: threadName(fromMinutes?.title ?? (brief || opening.threadName || "")), autoArchiveDuration: 1440 }).catch(() => null);
    if (!thread?.parentId || !source.guildId) return refuse(t.noThread);
    const place = { guildId: source.guildId, channelId: thread.parentId, threadId: thread.id };
    const previous = await readBinding(runtime.tenantId, place).catch(() => null);
    if (previous?.binding.status === "active") return refuse(t.alreadyBound(previous.binding.playbook));
    const saved = await writeBinding(runtime.tenantId, { playbook: playbook.name, status: "active", ...place, authorId: actor.id, authorName: actor.name, botId, botName: runtime.client.user?.username, sourceMessageId: source.id, startedAt: today().toISOString(), ...(fromMinutes && { points: fromMinutes.points }) }, `${brief}\n`, previous?.version).catch(() => null);
    if (!saved) return refuse(t.notSaved);
    const turn = opening.turnOf?.(source) ?? source;
    return { thread, start: () => this.serialize(`conv:${botId}:${thread.id}`, () => this.reply(runtime, botId, turn, [{ msg: turn, text: fromMinutes ? presetPointsTurn(brief) : brief }], thread.id, thread, { actor, playbook })) };
  }
  /**
   * A `run: in-place` playbook answers where it was started, with no thread. Minutes have their own writer; any other gets one agent turn
   * about the picked message, the one a mention replies to, or else the bot's last message there.
   */
  private async runInPlace(runtime: BotRuntime, botId: string, playbook: Playbook, o: InPlaceStart) {
    const { message: at, language } = o, t = textIn(language);
    const thread = at.channel.isThread();
    if (playbook.name === MINUTES_PLAYBOOK) {
      const adapter = adapterFor(runtime, at.guildId);
      const refusal = (at.guildId && await playbookRefusal(runtime.tenantId, botId, playbook, at, language)) || await minutesRefusal(adapter, at.channelId, o.actor.id, language);
      if (refusal) { await o.refuse(refusal); return; }
      await o.ack?.(thread ? t.minutesOfThread : o.from === "menu" ? t.minutesFromHere : t.minutesRecent(RECENT_MS / 3600_000));
      if ("sendTyping" in at.channel) await at.channel.sendTyping().catch(() => {});
      const error = await writeMinutes({
        tenantId: runtime.tenantId, botId, adapter, playbook, guildId: at.guildId!, channelId: at.channelId, parentId: thread ? at.channel.parentId : null, privateThread: placeOfChannel(at.channel).privateThread, requesterId: o.actor.id,
        startId: o.from === "menu" ? at.id : undefined, skipIds: o.from === "mention" ? [at.id] : undefined, post: (payload) => at.reply(payload),
      }).catch(() => t.minutesFailed);
      if (error) await o.fail(error);
      return;
    }
    const refusal = at.guildId && await playbookRefusal(runtime.tenantId, botId, playbook, at, language);
    if (refusal) { await o.refuse(refusal); return; }
    await o.ack?.(t.answeringHere(playbook.name));
    const about = o.from === "menu" ? null : o.about ?? await lastOwnMessage(at.channel, runtime.client.user?.id);
    const asked = !about || o.text || at.attachments.size ? [{ msg: at, text: o.text }] : [];
    const items = [...(about ? [{ msg: about, text: about.content.trim() }] : []), ...asked];
    const answered = o.from === "slash" ? about ?? at : at;
    await this.serialize(`conv:${botId}:${at.channelId}`, () => this.reply(runtime, botId, answered, items, at.channelId, null, { actor: o.actor, playbook }));
  }
  private async reply(runtime: BotRuntime, botId: string, msg: Message, items: TurnItem[], channelId: string, thread: ThreadChannel | null, opts: { actor?: Actor; playbook?: Playbook; binding?: PlaybookBinding; direct?: boolean } = {}) {
    const target = thread ?? msg.channel;
    const typing = async () => { try { if ("sendTyping" in target) await target.sendTyping(); } catch {} };
    await typing();
    const interval = setInterval(() => { void typing(); }, 4000);
    // ⏳ marks the messages being answered until the turn ends; one not meant for the bot gets none, since it may get no answer.
    const botUserId = runtime.client.user?.id;
    const working = await Promise.all(items.filter((i) => i.direct !== false && i.msg.author.id !== botUserId).map((i) => i.msg.react("⏳").catch(() => null)));
    const send = (content: string) => thread ? thread.send({ content, allowedMentions: { parse: [] } }) : msg.reply({ content, allowedMentions: { parse: [] } });
    const language = replyLanguage(...items.map((i) => i.text)), t = textIn(language);
    try {
      const agent = await repositories().agentConfig.get(runtime.tenantId);
      const guild = msg.guildId ? await loadGuildSettings(runtime.tenantId, botId, msg.guildId) : null;
      const conversation = await repositories().conversations.latestInChannel(runtime.tenantId, botId, channelId);
      const actor = opts.actor ?? actorOf(msg), direct = opts.direct ?? true;
      const repository = opts.binding && threadRepositoryOf(opts.binding), documents = opts.binding && threadDocumentsOf(opts.binding);
      const chained = opts.playbook && withLoads(opts.playbook, await listPlaybooks(runtime.tenantId));
      const playbook = chained && { name: chained.name, body: chained.body, closes: chained.closes, ...(repository ? { repository } : {}), ...(documents ? { documents } : {}) };
      const media = await gatherTurnImages(items.map((i) => i.msg), () => llmRouter.acceptsImages(runtime.tenantId, botId), language, new Map(items.flatMap((i) => (i.replyTo !== undefined ? [[i.msg, i.replyTo] as const] : []))));
      // The brief's author still gets a round: it asks them to describe the screenshot.
      const briefAuthor = !!opts.playbook && (!opts.binding || actor.id === opts.binding.authorId);
      if (media.blind && !briefAuthor && !items.some((i) => i.text)) { await send(`${t.blind} ${t.describeImage}`); return; }
      const filed = await fileTurnDocuments(runtime.tenantId, items, language, botCompletion(runtime.tenantId, botId, language));
      const lines = items.flatMap((i) => [replyLine(i.replyTo, botUserId), speakerTurn(i.msg.guildId, speakerName(i.msg), withPlaceholders(i.text, i.msg, filed), keepableId(i.text, i.msg.id))]);
      let turn = [...lines, media.context].filter(Boolean).join("\n");
      const brief = opts.binding && { place: bindingPlace(opts.binding), authorId: opts.binding.authorId, outsider: actor.id !== opts.binding.authorId };
      if (brief?.outsider) turn = outsiderTurn(turn);
      else if (brief) { const input = await takeBriefInput(runtime.tenantId, brief.place).catch(() => null); if (input) turn = inputTurn(input, turn); }
      const place = brief?.place ?? (opts.playbook && thread?.parentId && msg.guildId ? { guildId: msg.guildId, channelId: thread.parentId, threadId: thread.id } : null);
      const shots = place && !brief?.outsider ? media.shots : [];
      if (shots.length) await recordBriefImages(runtime.tenantId, place!, shots).catch(() => null);
      const output = await agentReActLoop.run({ tenantId: runtime.tenantId, botId, message: turn, images: media.images, conversationId: conversation?.id, replyLanguage: language, maxIterations: agent?.settings?.maxReActIterations || 12, context: { tenantId: runtime.tenantId, platform: "discord", guildId: msg.guildId || undefined, guildName: msg.guild?.name, channelId, userId: actor.id, userName: actor.name, addressed: direct, playbook, timezone: configuredTimezone(guild, agent), language: configuredLanguage(guild, agent), skillContext: { member: memberAuth(actor.member), discord: adapterFor(runtime, msg.guildId), parentChannelId: (msg.channel.isThread() ? msg.channel.parentId : msg.channelId) ?? undefined, privateThread: channelId === msg.channelId ? placeOfChannel(msg.channel).privateThread : undefined } } });
      const notes = [...(output.imagesRejected ? [t.rejected] : []), ...media.notes];
      if (output.imagesRejected && shots.length) await unseeBriefImages(runtime.tenantId, place!, shots.map((s) => s.id)).catch(() => null);
      const briefed = briefTurn(output.toolCallsExecuted);
      let plan: ReplyPlan = briefed?.plan ?? prepareReply(output.reply, { addressed: direct, language });
      if (plan.messages.length || direct) plan = withNotes(plan, notes);
      if (brief?.outsider && plan.messages.length) plan = withNotes(plan, [authorDecidesNote(brief.authorId, language)]);
      if (plan.reaction) await msg.react(plan.reaction).catch(() => {});
      for (const chunk of plan.messages) await send(chunk);
      if (briefed?.written.length && place && target.isSendable()) await showDrafts(runtime.tenantId, target, place, briefed.written);
      if (output.toolCallsExecuted.length && target.isSendable()) {
        // Write actions never run on the model's say-so: each one gets Confirm/Cancel buttons for the person who asked.
        for (const { result } of output.toolCallsExecuted) {
          const p = result.success ? pendingOf(result.data) : null;
          if (p) await target.send(confirmMessage(p, actor.id));
        }
      }
      // Still inside this conversation's serialized job, so the next turn reads the rewritten summary.
      if (!playbook) await rollSummary({ tenantId: runtime.tenantId, botId, conversationId: output.conversationId, windowOffset: output.historyOffset }).catch(() => {});
    } catch { await send(t.failed).catch(() => {}); }
    finally {
      clearInterval(interval);
      await Promise.all(working.map((r) => r?.users.remove().catch(() => {})));
    }
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
