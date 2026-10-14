import { Client, GatewayIntentBits, Partials, Events, ChannelType, type Attachment, type ChatInputCommandInteraction, type Message, type ThreadChannel, type MessageContextMenuCommandInteraction } from "discord.js";
import { db, bots, agentsConfig, conversations, usageEvents, getBotDecrypted, listAllActiveBots, getTenantById, updateBot, eq } from "@pachiware/db";
import { and, desc } from "drizzle-orm";
import { DiscordJSAdapter } from "./adapter.js";
import { agentReActLoop } from "../loop/react.js";
import { rollSummary } from "../loop/summary.js";
import { respondReason, addressed, isNoise, threadName, speakerTurn, speakerName } from "./routing.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { CacheService, tenantKey } from "../cache/redis.js";
import { pendingOf, confirmMessage, handleConfirmButton } from "./gitConfirm.js";
import { listPlaybooks, withLoads, onPlaybooksChanged, onAvailabilityChanged, boundPlaybook, readBinding, writeBinding, bindingPlace, rewriteBinding, availabilityPlace, skillRegistry, recordBriefInput, takeBriefInput, inputTurn, outsiderTurn, authorDecidesNote, presetPointsTurn, recordBriefImages, unseeBriefImages, replyLanguage, textIn, configuredLanguage, configuredTimezone, today, threadRepositoryOf, anyRepositoryAllowed, type Language, type Playbook, type PlaybookBinding } from "@pachiware/skills";
import { guildCommands } from "./commands.js";
import { prepareReply, replyQuietly, withNotes, type ReplyPlan } from "./replyStyle.js";
import { gatherTurnImages, fileTurnDocuments, withPlaceholders } from "./attachments.js";
import { briefTurn, showDrafts, afterBriefConfirm } from "./briefThread.js";
import { llmRouter } from "../llm/router.js";
import { MINUTES_PLAYBOOK, minutesRefusal, writeMinutes, minutesFileOf, correctMinutes, minutesBrief, namedNumbers, type MinutesBrief } from "./minutes.js";

const BURST_MS = 2500;
// Admin edits often come in a run (several rules saved one after another); one registration covers them.
const COMMANDS_MS = 2000;
type TurnItem = { msg: Message; text: string; direct?: boolean };
/** `sentCommands` holds each guild's last overwrite as JSON, so an unchanged guild is not sent again. */
type BotRuntime = { client: Client; adapter: DiscordJSAdapter; tenantId: string; connected: boolean; guildIds: string[]; globalCleared: boolean; sentCommands: Map<string, string> };
/** Who a turn acts for: the message author, or the person who ran a command on someone else's message. */
type Actor = { id: string; name: string; member: any };
const actorOf = (m: Message): Actor => ({ id: m.author.id, name: speakerName(m), member: m.member });
/**
 * A slash start's first turn as if the person had posted it at the bot's public line: their name, and their file as the line's attachment,
 * so it is filed or seen like any message attachment. Defined properties shadow the line's own getters.
 */
const slashTurn = (line: Message, i: ChatInputCommandInteraction, file: Attachment | null): Message => Object.create(line, {
  author: { value: i.user }, member: { value: i.member },
  attachments: { value: new Map(file ? [[file.id, file]] : []) },
});
// A guild member from the cache has a roles collection; one sent raw with an interaction has an id array.
const memberAuth = (m: any) => ({ roleIds: Array.isArray(m?.roles) ? m.roles : m?.roles?.cache ? [...m.roles.cache.keys()] : [], permissions: m?.permissions?.toArray?.() ?? [] });
const TRIGGER = /^([\p{L}\p{N}_-]{1,32})\s*(?::|\n)\s*([\s\S]*)$/u;
const WORD_ONLY = /^([\p{L}\p{N}_-]{1,32})[.!?]?$/u;
/** Where something was asked: a message, or the channel a command was run in. */
type Where = Pick<Message, "guildId" | "channelId" | "channel">;
/** Where a message's availability rules come from: a thread follows its parent channel. */
const placeOf = (tenantId: string, botId: string, m: Where) => availabilityPlace({ tenantId, botId, guildId: m.guildId ?? undefined, channelId: m.channelId, parentChannelId: m.channel.isThread() ? m.channel.parentId ?? undefined : undefined });
/**
 * Why the playbook cannot start where `at` was posted: it, a playbook it loads, or a skill its chain requires is off there, or its chain
 * needs a repository and git scope allows none. Null when it can start.
 */
async function playbookRefusal(tenantId: string, botId: string, playbook: Playbook, at: Where, language?: Language) {
  const playbooks = await listPlaybooks(tenantId);
  const cause = (await skillRegistry.availableAt(placeOf(tenantId, botId, at), playbooks)).playbookCause(playbook.name);
  const t = textIn(language);
  if (!cause) {
    const parentChannelId = at.channel.isThread() ? at.channel.parentId ?? undefined : undefined;
    const noRepository = withLoads(playbook, playbooks).repository === "required" && !await anyRepositoryAllowed({ tenantId, botId, guildId: at.guildId ?? undefined, channelId: at.channelId, parentChannelId });
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
  /** The gateway client of a running, connected bot; the scheduler posts through it. */
  clientOf(botId: string): Client | null {
    const runtime = this.clients.get(botId);
    return runtime?.connected ? runtime.client : null;
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
    const runtime: BotRuntime = { client, adapter: new DiscordJSAdapter(client, bot.guildIds[0]), tenantId: bot.tenantId, connected: false, guildIds: bot.guildIds, globalCleared: false, sentCommands: new Map() };
    this.clients.set(id, runtime);
    await updateBot(id, { connectionStatus: "connecting", lastError: null });
    client.once(Events.ClientReady, () => {
      if (this.clients.get(id) !== runtime) return;
      runtime.connected = true;
      void updateBot(id, { connectionStatus: "connected", lastConnectedAt: new Date(), lastError: null }).catch(() => {});
      this.scheduleCommands(id);
    });
    client.on(Events.GuildCreate, () => { if (runtime.connected) this.scheduleCommands(id); });
    client.on(Events.GuildDelete, (guild) => { runtime.sentCommands.delete(guild.id); });
    client.on(Events.ShardDisconnect, () => { runtime.connected = false; void updateBot(id, { connectionStatus: "disconnected" }).catch(() => {}); });
    client.on(Events.ShardResume, () => { runtime.connected = true; void updateBot(id, { connectionStatus: "connected" }).catch(() => {}); });
    client.on(Events.Error, () => { void updateBot(id, { lastError: "Discord gateway error" }).catch(() => {}); });
    client.on(Events.InteractionCreate, (i) => {
      if (i.isButton()) this.track(handleConfirmButton(i as any, id, (guildId) => new DiscordJSAdapter(client, guildId), (action, result) => afterBriefConfirm(runtime.client, runtime.tenantId, action, result)));
      else if (i.isMessageContextMenuCommand()) this.track(this.handleCommand(id, i));
      else if (i.isChatInputCommand()) this.track(this.handleSlash(id, i));
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
  /** One bulk overwrite per guild the bot is in, sent only when that guild's list changed; the global list, left by older versions, is emptied once. */
  private async registerCommands(botId: string, runtime: BotRuntime) {
    const application = runtime.client.application;
    if (!application || this.clients.get(botId) !== runtime) return;
    if (!runtime.globalCleared) await application.commands.set([]).then(() => { runtime.globalCleared = true; }, () => {});
    const playbooks = await listPlaybooks(runtime.tenantId);
    for (const guildId of runtime.client.guilds.cache.keys()) {
      const commands = await guildCommands({ tenantId: runtime.tenantId, botId, guildId }, playbooks);
      const sent = JSON.stringify(commands);
      if (runtime.sentCommands.get(guildId) === sent) continue;
      // One guild refusing (no applications.commands scope there) must not keep the others from their commands.
      try { await application.commands.set(commands, guildId); runtime.sentCommands.set(guildId, sent); } catch {}
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
      const ref = await msg.fetchReference().catch(() => null);
      trigger.repliedToBot = ref?.author.id === botUserId;
      if (ref && !trigger.repliedToBot) trigger.addressesOthers = true;
    }
    // In a bound thread only the author decides: anyone else's message is kept as input for them and acknowledged, not answered.
    const place = bound && bindingPlace(bound.binding);
    const outsider = !!bound && msg.author.id !== bound.binding.authorId;
    const keepInput = async () => {
      const said = msg.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
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
      const ref = await msg.fetchReference().catch(() => null);
      trigger.repliedToBot = ref?.author.id === botUserId;
      reason = respondReason(trigger);
    }
    if (!reason) return;
    const direct = addressed(trigger);
    const text = msg.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
    if (isNoise(text, msg.attachments.size > 0)) { if (direct) await msg.react("👀").catch(() => {}); return; }
    const rate = await CacheService.checkRateLimit(tenantKey(runtime.tenantId, `ratelimit:discord:user:${msg.author.id}`), 10, 60);
    if (!rate.allowed) { await msg.react("⏳").catch(() => {}); return; }
    if (!text && !msg.attachments.size) return;
    await db.insert(usageEvents).values({ tenantId: runtime.tenantId, botId, type: "discord_message", metadata: { channelId: msg.channelId } });
    if (text && msg.guildId && msg.reference?.messageId) {
      const ref = await msg.fetchReference().catch(() => null);
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
    if (!msg.guildId || thread) { await run(msg, [{ msg, text, direct }]); return; }
    // Burst of messages in a shared channel: wait for a pause, then answer once with all of them.
    const key = `${botId}:${channelId}`;
    const burst = this.bursts.get(key) ?? { items: [] as TurnItem[], timer: undefined as any };
    burst.items.push({ msg, text, direct });
    clearTimeout(burst.timer);
    burst.timer = setTimeout(() => {
      this.bursts.delete(key);
      const last = burst.items[burst.items.length - 1].msg;
      void run(last, burst.items).catch(() => {});
    }, this.burstMs);
    this.bursts.set(key, burst);
  }
  /** "@bot issue: points" starts the playbook whose trigger word leads the message; "@bot minutes" needs no points. */
  private async triggerPlaybook(runtime: BotRuntime, botId: string, msg: Message, text: string, bound: boolean) {
    const m = TRIGGER.exec(text) ?? WORD_ONLY.exec(text);
    if (!m) return false;
    const word = m[1]!.toLowerCase();
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.words.includes(word) || (p.name === word && p.start));
    if (!playbook) return false;
    const say = replyQuietly(msg);
    if (playbook.name === MINUTES_PLAYBOOK) {
      await this.runMinutes(runtime, botId, playbook, msg, msg.author.id, { skipIds: [msg.id], refuse: say, fail: say }, replyLanguage(text));
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
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.name !== MINUTES_PLAYBOOK && p.words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}_])${w}s?(?![\\p{L}\\p{N}_])`, "u").test(said)));
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
    if ((await getTenantById(runtime.tenantId))?.status !== "active") return say(t.botOff);
    if (!i.guildId || (runtime.guildIds.length && !runtime.guildIds.includes(i.guildId))) return say(t.wrongServer);
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.menu === i.commandName);
    if (!playbook) return say(t.commandGone);
    if (playbook.name === MINUTES_PLAYBOOK) {
      return this.runMinutes(runtime, botId, playbook, target, i.user.id, {
        startId: target.id, refuse: say,
        ack: () => say(target.channel.isThread() ? t.minutesOfThread : t.minutesFromHere),
        fail: (content) => i.followUp({ content, ephemeral: true }).catch(() => {}),
      }, language);
    }
    // Run on posted minutes, the brief is their action items rather than the embed's text.
    const minutes = target.author.id === runtime.client.user?.id && minutesFileOf(target) ? await minutesBrief(runtime.tenantId, target, [], language) : null;
    if (minutes && "error" in minutes) return say(minutes.error);
    const opened = await this.openPlaybook(runtime, botId, playbook, target, minutes?.text ?? target.content.trim(), { id: i.user.id, name: speakerName({ member: i.member as any, author: i.user }), member: i.member }, { fromMinutes: minutes ?? undefined });
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
    const t = textIn(replyLanguage(text));
    const say = (content: string) => i.editReply({ content }).catch(() => {});
    if ((await getTenantById(runtime.tenantId))?.status !== "active") return say(t.botOff);
    if (!i.guildId || !i.channel?.isSendable() || (runtime.guildIds.length && !runtime.guildIds.includes(i.guildId))) return say(t.wrongServer);
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.name === i.commandName && p.start);
    // Minutes answer in place, and from a slash command there is no message to answer; #106 gives /minutes the channel's recent history.
    if (!playbook || playbook.name === MINUTES_PLAYBOOK) return say(t.commandGone);
    const channel = i.channel;
    const actor = { id: i.user.id, name: speakerName({ member: i.member as any, author: i.user }), member: i.member };
    const opened = await this.openPlaybook(runtime, botId, playbook, { guildId: i.guildId, channelId: i.channelId, channel }, text, actor, {
      announce: () => channel.send({ content: t.started(i.user.id, playbook.name), allowedMentions: { parse: [] } }).catch(() => null),
      turnOf: (line) => slashTurn(line, i, file),
      threadName: playbook.name,
    });
    if ("error" in opened) return say(opened.error);
    await say(t.following(playbook.name, opened.thread.id));
    await opened.start();
  }
  /**
   * Checks the playbook's skills, opens or reuses the source message's thread, and binds it; `start` runs the first turn there. A brief from minutes arrives with its points set.
   * `at` is where the playbook was asked for. With `announce`, the message posted there once the checks pass is the source, and `turnOf` makes the first turn's message from it.
   */
  private async openPlaybook(runtime: BotRuntime, botId: string, playbook: Playbook, at: Where, brief: string, actor: Actor, o: { fromMinutes?: MinutesBrief; announce?: () => Promise<Message | null>; turnOf?: (source: Message) => Message; threadName?: string } = {}): Promise<{ error: string } | { thread: ThreadChannel; start: () => Promise<void> }> {
    const { fromMinutes } = o;
    const language = replyLanguage(brief), t = textIn(language);
    const refusal = await playbookRefusal(runtime.tenantId, botId, playbook, at, language);
    if (refusal) return { error: refusal };
    const source = o.announce ? await o.announce() : at as Message;
    if (!source) return { error: t.noThread };
    const thread = source.channel.isThread() ? source.channel as ThreadChannel
      : source.thread ?? await source.startThread({ name: threadName(fromMinutes?.title ?? (brief || o.threadName || "")), autoArchiveDuration: 1440 }).catch(() => null);
    if (!thread?.parentId || !source.guildId) return { error: t.noThread };
    const place = { guildId: source.guildId, channelId: thread.parentId, threadId: thread.id };
    const previous = await readBinding(runtime.tenantId, place).catch(() => null);
    if (previous?.binding.status === "active") return { error: t.alreadyBound(previous.binding.playbook) };
    const saved = await writeBinding(runtime.tenantId, { playbook: playbook.name, status: "active", ...place, authorId: actor.id, authorName: actor.name, botId, botName: runtime.client.user?.username, sourceMessageId: source.id, startedAt: today().toISOString(), ...(fromMinutes && { points: fromMinutes.points }) }, `${brief}\n`, previous?.version).catch(() => null);
    if (!saved) return { error: t.notSaved };
    const turn = o.turnOf?.(source) ?? source;
    return { thread, start: () => this.serialize(`conv:${botId}:${thread.id}`, () => this.reply(runtime, botId, turn, [{ msg: turn, text: fromMinutes ? presetPointsTurn(brief) : brief }], thread.id, thread, { actor, playbook })) };
  }
  /** Minutes post in place, replying to `at`: no thread is opened or bound. */
  private async runMinutes(runtime: BotRuntime, botId: string, playbook: Playbook, at: Message, requesterId: string, o: { startId?: string; skipIds?: string[]; refuse(text: string): Promise<unknown>; ack?(): Promise<unknown>; fail(text: string): Promise<unknown> }, language?: Language) {
    const adapter = new DiscordJSAdapter(runtime.client, at.guildId || runtime.guildIds[0]);
    const refusal = (at.guildId && await playbookRefusal(runtime.tenantId, botId, playbook, at, language)) || await minutesRefusal(adapter, at.channelId, requesterId, language);
    if (refusal) { await o.refuse(refusal); return; }
    await o.ack?.();
    if ("sendTyping" in at.channel) await at.channel.sendTyping().catch(() => {});
    const parentId = at.channel.isThread() ? at.channel.parentId : null;
    const error = await writeMinutes({ tenantId: runtime.tenantId, botId, adapter, playbook, guildId: at.guildId!, channelId: at.channelId, parentId, requesterId, startId: o.startId, skipIds: o.skipIds, post: (payload) => at.reply(payload) })
      .catch(() => textIn(language).minutesFailed);
    if (error) await o.fail(error);
  }
  private async reply(runtime: BotRuntime, botId: string, msg: Message, items: TurnItem[], channelId: string, thread: ThreadChannel | null, opts: { actor?: Actor; playbook?: Playbook; binding?: PlaybookBinding; direct?: boolean } = {}) {
    const target = thread ?? msg.channel;
    const typing = async () => { try { if ("sendTyping" in target) await target.sendTyping(); } catch {} };
    await typing();
    const interval = setInterval(() => { void typing(); }, 4000);
    const send = (content: string) => thread ? thread.send({ content, allowedMentions: { parse: [] } }) : msg.reply({ content, allowedMentions: { parse: [] } });
    const language = replyLanguage(...items.map((i) => i.text)), t = textIn(language);
    try {
      const [agent] = await db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, runtime.tenantId)).limit(1);
      const guild = msg.guildId ? await loadGuildSettings(runtime.tenantId, botId, msg.guildId) : null;
      const [conversation] = await db.select().from(conversations).where(and(eq(conversations.tenantId, runtime.tenantId), eq(conversations.botId, botId), eq(conversations.channelId, channelId))).orderBy(desc(conversations.createdAt)).limit(1);
      const actor = opts.actor ?? actorOf(msg), direct = opts.direct ?? true;
      const repository = opts.binding && threadRepositoryOf(opts.binding);
      const chained = opts.playbook && withLoads(opts.playbook, await listPlaybooks(runtime.tenantId));
      const playbook = chained && { name: chained.name, body: chained.body, closes: chained.closes, ...(repository ? { repository } : {}) };
      const media = await gatherTurnImages(items.map((i) => i.msg), () => llmRouter.acceptsImages(runtime.tenantId, botId), language);
      // The brief's author still gets a round: it asks them to describe the screenshot.
      const briefAuthor = !!opts.playbook && (!opts.binding || actor.id === opts.binding.authorId);
      if (media.blind && !briefAuthor && !items.some((i) => i.text)) { await send(`${t.blind} ${t.describeImage}`); return; }
      const filed = await fileTurnDocuments(runtime.tenantId, items, language);
      let turn = [items.map((i) => speakerTurn(i.msg.guildId, speakerName(i.msg), withPlaceholders(i.text, i.msg, filed))).join("\n"), media.context].filter(Boolean).join("\n");
      const brief = opts.binding && { place: bindingPlace(opts.binding), authorId: opts.binding.authorId, outsider: actor.id !== opts.binding.authorId };
      if (brief?.outsider) turn = outsiderTurn(turn);
      else if (brief) { const input = await takeBriefInput(runtime.tenantId, brief.place).catch(() => null); if (input) turn = inputTurn(input, turn); }
      const place = brief?.place ?? (opts.playbook && thread?.parentId && msg.guildId ? { guildId: msg.guildId, channelId: thread.parentId, threadId: thread.id } : null);
      const shots = place && !brief?.outsider ? media.shots : [];
      if (shots.length) await recordBriefImages(runtime.tenantId, place!, shots).catch(() => null);
      const output = await agentReActLoop.run({ tenantId: runtime.tenantId, botId, message: turn, images: media.images, conversationId: conversation?.id, maxIterations: agent?.settings?.maxReActIterations || 12, context: { tenantId: runtime.tenantId, platform: "discord", guildId: msg.guildId || undefined, guildName: msg.guild?.name, channelId, userId: actor.id, userName: actor.name, addressed: direct, playbook, timezone: configuredTimezone(guild, agent), language: configuredLanguage(guild, agent), skillContext: { member: memberAuth(actor.member), discord: new DiscordJSAdapter(runtime.client, msg.guildId || runtime.guildIds[0]), parentChannelId: (msg.channel.isThread() ? msg.channel.parentId : msg.channelId) ?? undefined } } });
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
        // Git write actions never run on the model's say-so: each one gets Confirm/Cancel buttons for the person who asked.
        for (const { result } of output.toolCallsExecuted) {
          const p = result.success ? pendingOf(result.data) : null;
          if (p) await target.send(confirmMessage(p, actor.id));
        }
      }
      // Still inside this conversation's serialized job, so the next turn reads the rewritten summary.
      if (!playbook) await rollSummary({ tenantId: runtime.tenantId, botId, conversationId: output.conversationId, windowOffset: output.historyOffset }).catch(() => {});
    } catch { await send(t.failed).catch(() => {}); }
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
