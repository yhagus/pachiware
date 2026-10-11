import { Client, GatewayIntentBits, Partials, Events, ChannelType, type Message, type ThreadChannel, type MessageContextMenuCommandInteraction } from "discord.js";
import { db, bots, agentsConfig, conversations, usageEvents, getBotDecrypted, listAllActiveBots, getTenantById, updateBot, eq } from "@pachiware/db";
import { and, desc } from "drizzle-orm";
import { DiscordJSAdapter } from "./adapter.js";
import { agentReActLoop } from "../loop/react.js";
import { respondReason, addressed, isNoise, threadName, speakerTurn } from "./routing.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { CacheService, tenantKey } from "../cache/redis.js";
import { pendingOf, confirmMessage, handleConfirmButton } from "./gitConfirm.js";
import { listPlaybooks, onPlaybooksChanged, boundPlaybook, readBinding, writeBinding, missingSkills, skillRegistry, roundMessagesOf, recordBriefInput, takeBriefInput, inputTurn, outsiderTurn, authorDecidesNote, presetPointsTurn, draftsWrittenOf, briefState, draftEmbed, draftsFile, recordDraftMessages, revisionNote, DRAFTS_FILE_NOTE, recordBriefImages, unseeBriefImages, type BindingPlace, type Playbook, type PlaybookBinding } from "@pachiware/skills";
import { prepareReply, MESSAGE_LIMIT, type ReplyPlan } from "./replyStyle.js";
import { gatherTurnImages, withPlaceholders, BLIND_ONLY_NOTE, REJECTED_NOTE } from "./attachments.js";
import { llmRouter } from "../llm/router.js";
import { MINUTES_PLAYBOOK, minutesRefusal, writeMinutes, minutesFileOf, correctMinutes, minutesBrief, namedNumbers, type MinutesBrief } from "./minutes.js";

const BURST_MS = 2500;
const MESSAGE_COMMAND = 3; // ApplicationCommandType.Message
type TurnItem = { msg: Message; text: string; direct?: boolean };
type BotRuntime = { client: Client; adapter: DiscordJSAdapter; tenantId: string; connected: boolean; guildIds: string[] };
/** Who a turn acts for: the message author, or the person who ran a command on someone else's message. */
type Actor = { id: string; name: string; member: any };
const actorOf = (m: Message): Actor => ({ id: m.author.id, name: m.member?.displayName || m.author.username, member: m.member });
// A guild member from the cache has a roles collection; one sent raw with an interaction has an id array.
const memberAuth = (m: any) => ({ roleIds: Array.isArray(m?.roles) ? m.roles : m?.roles?.cache ? [...m.roles.cache.keys()] : [], permissions: m?.permissions?.toArray?.() ?? [] });
const TRIGGER = /^([\p{L}\p{N}_-]{1,32})\s*(?::|\n)\s*([\s\S]*)$/u;
const WORD_ONLY = /^([\p{L}\p{N}_-]{1,32})[.!?]?$/u;
/** Names the skills a playbook requires that are off for the tenant, or null when it can start. */
async function skillsRefusal(tenantId: string, playbook: Playbook) {
  const missing = missingSkills(playbook, (await skillRegistry.getActiveSkills(tenantId)).map((s) => s.id));
  if (!missing.length) return null;
  const names = missing.map((id) => skillRegistry.getAllSkills().find((s) => s.id === id)?.name ?? id).join(" and ");
  return `The ${playbook.name} playbook needs the ${names} skill${missing.length > 1 ? "s" : ""}, which ${missing.length > 1 ? "are" : "is"} off here. An admin can turn ${missing.length > 1 ? "them" : "it"} on in the console.`;
}
export class DiscordBotManager {
  private clients = new Map<string, BotRuntime>();
  private operations = new Map<string, Promise<any>>();
  private bursts = new Map<string, { items: TurnItem[]; timer: ReturnType<typeof setTimeout> }>();
  private inflight = new Set<Promise<unknown>>();
  constructor(private burstMs = BURST_MS) { onPlaybooksChanged((tenantId) => this.refreshCommands(tenantId)); }
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
      this.track(this.serialize(`commands:${id}`, () => this.registerCommands(runtime)));
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
  /** Re-registers the commands of every running bot of the tenant, so an edited playbook needs no restart. */
  refreshCommands(tenantId: string) {
    for (const [id, runtime] of this.clients) if (runtime.tenantId === tenantId && runtime.connected) this.track(this.serialize(`commands:${id}`, () => this.registerCommands(runtime)));
  }
  /** One message context-menu command per playbook that names one; Discord allows five per app. */
  private async registerCommands(runtime: BotRuntime) {
    if (!runtime.client.application || ![...this.clients.values()].includes(runtime)) return;
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
    // In a bound thread only the author decides: anyone else's message is kept as input for them and acknowledged, not answered.
    const place = bound && { guildId: bound.binding.guildId, channelId: bound.binding.channelId, threadId: bound.binding.threadId };
    const outsider = !!bound && msg.author.id !== bound.binding.authorId;
    const keepInput = async () => {
      const said = msg.content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
      if (!place || isNoise(said, msg.attachments.size > 0)) return false;
      return !!await recordBriefInput(runtime.tenantId, place, { messageId: msg.id, userId: msg.author.id, name: msg.member?.displayName || msg.author.username, text: said || "[attachment]" }).catch(() => null);
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
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.words.includes(m[1]!.toLowerCase()));
    if (!playbook) return false;
    if (playbook.name === MINUTES_PLAYBOOK) {
      const say = (content: string) => msg.reply({ content, allowedMentions: { parse: [] } }).catch(() => {});
      await this.runMinutes(runtime, botId, playbook, msg, msg.author.id, { skipIds: [msg.id], refuse: say, fail: say });
      return true;
    }
    if (bound || !msg.guildId || !m[2]?.trim()) return false;
    const opened = await this.openPlaybook(runtime, botId, playbook, msg, m[2]!.trim(), actorOf(msg));
    if ("error" in opened) await msg.reply({ content: opened.error, allowedMentions: { parse: [] } }).catch(() => {});
    else await opened.start();
    return true;
  }
  /** "@bot turn points 2 and 3 into issues" replying to minutes: an explicit mention naming a playbook's word starts it from those action items. */
  private async briefFromMinutes(runtime: BotRuntime, botId: string, msg: Message, minutes: Message, text: string) {
    if (!new RegExp(`<@!?${runtime.client.user?.id}>`).test(msg.content)) return false;
    const said = text.toLowerCase();
    const playbook = (await listPlaybooks(runtime.tenantId)).find((p) => p.name !== MINUTES_PLAYBOOK && p.words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}_])${w}s?(?![\\p{L}\\p{N}_])`, "u").test(said)));
    if (!playbook) return false;
    const say = (content: string) => msg.reply({ content, allowedMentions: { parse: [] } }).catch(() => {});
    const brief = await minutesBrief(runtime.tenantId, minutes, namedNumbers(text));
    if ("error" in brief) { await say(brief.error); return true; }
    const opened = await this.openPlaybook(runtime, botId, playbook, minutes, brief.text, actorOf(msg), brief);
    if ("error" in opened) await say(opened.error);
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
    if (playbook.name === MINUTES_PLAYBOOK) {
      const target = i.targetMessage;
      return this.runMinutes(runtime, botId, playbook, target, i.user.id, {
        startId: target.id, refuse: say,
        ack: () => say(target.channel.isThread() ? "Writing minutes of this whole thread." : "Writing minutes from this message to now."),
        fail: (content) => i.followUp({ content, ephemeral: true }).catch(() => {}),
      });
    }
    const target = i.targetMessage;
    // Run on posted minutes, the brief is their action items rather than the embed's text.
    const minutes = target.author.id === runtime.client.user?.id && minutesFileOf(target) ? await minutesBrief(runtime.tenantId, target, []) : null;
    if (minutes && "error" in minutes) return say(minutes.error);
    const opened = await this.openPlaybook(runtime, botId, playbook, target, minutes?.text ?? target.content.trim(), { id: i.user.id, name: (i.member as any)?.displayName || i.user.username, member: i.member }, minutes ?? undefined);
    if ("error" in opened) return say(opened.error);
    await say(`Following the ${playbook.name} playbook in <#${opened.thread.id}>.`);
    await opened.start();
  }
  /** Checks the playbook's skills, opens or reuses the source message's thread, and binds it; `start` runs the first turn there. A brief from minutes arrives with its points set. */
  private async openPlaybook(runtime: BotRuntime, botId: string, playbook: Playbook, source: Message, brief: string, actor: Actor, fromMinutes?: MinutesBrief): Promise<{ error: string } | { thread: ThreadChannel; start: () => Promise<void> }> {
    const refusal = await skillsRefusal(runtime.tenantId, playbook);
    if (refusal) return { error: refusal };
    const thread = source.channel.isThread() ? source.channel as ThreadChannel
      : source.thread ?? await source.startThread({ name: threadName(fromMinutes?.title ?? brief), autoArchiveDuration: 1440 }).catch(() => null);
    if (!thread?.parentId || !source.guildId) return { error: "I couldn't open a thread for this message. Check that I can create threads in this channel." };
    const place = { guildId: source.guildId, channelId: thread.parentId, threadId: thread.id };
    const previous = await readBinding(runtime.tenantId, place).catch(() => null);
    if (previous?.binding.status === "active") return { error: `This thread already follows the ${previous.binding.playbook} playbook.` };
    const saved = await writeBinding(runtime.tenantId, { playbook: playbook.name, status: "active", ...place, authorId: actor.id, authorName: actor.name, botName: runtime.client.user?.username, sourceMessageId: source.id, startedAt: new Date().toISOString(), ...(fromMinutes && { points: fromMinutes.points }) }, `${brief}\n`, previous?.version).catch(() => null);
    if (!saved) return { error: "I couldn't save this thread to the Workspace, so the playbook did not start. Try again in a moment." };
    return { thread, start: () => this.serialize(`conv:${botId}:${thread.id}`, () => this.reply(runtime, botId, source, [{ msg: source, text: fromMinutes ? presetPointsTurn(brief) : brief }], thread.id, thread, { actor, playbook })) };
  }
  /** Minutes post in place, replying to `at`: no thread is opened or bound. */
  private async runMinutes(runtime: BotRuntime, botId: string, playbook: Playbook, at: Message, requesterId: string, o: { startId?: string; skipIds?: string[]; refuse(text: string): Promise<unknown>; ack?(): Promise<unknown>; fail(text: string): Promise<unknown> }) {
    const adapter = new DiscordJSAdapter(runtime.client, at.guildId || runtime.guildIds[0]);
    const refusal = (at.guildId && await skillsRefusal(runtime.tenantId, playbook)) || await minutesRefusal(adapter, at.channelId, requesterId);
    if (refusal) { await o.refuse(refusal); return; }
    await o.ack?.();
    if ("sendTyping" in at.channel) await at.channel.sendTyping().catch(() => {});
    const parentId = at.channel.isThread() ? at.channel.parentId : null;
    const error = await writeMinutes({ tenantId: runtime.tenantId, botId, adapter, playbook, guildId: at.guildId!, channelId: at.channelId, parentId, requesterId, startId: o.startId, skipIds: o.skipIds, post: (payload) => at.reply(payload) })
      .catch(() => "I couldn't write the minutes this time. Try again in a moment.");
    if (error) await o.fail(error);
  }
  private async reply(runtime: BotRuntime, botId: string, msg: Message, items: TurnItem[], channelId: string, thread: ThreadChannel | null, opts: { actor?: Actor; playbook?: Playbook; binding?: PlaybookBinding; direct?: boolean } = {}) {
    const target = thread ?? msg.channel;
    const typing = async () => { try { if ("sendTyping" in target) await target.sendTyping(); } catch {} };
    await typing();
    const interval = setInterval(() => { void typing(); }, 4000);
    const send = (content: string) => thread ? thread.send({ content, allowedMentions: { parse: [] } }) : msg.reply({ content, allowedMentions: { parse: [] } });
    try {
      const [agent] = await db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, runtime.tenantId)).limit(1);
      const [conversation] = await db.select().from(conversations).where(and(eq(conversations.tenantId, runtime.tenantId), eq(conversations.botId, botId), eq(conversations.channelId, channelId))).orderBy(desc(conversations.createdAt)).limit(1);
      const actor = opts.actor ?? actorOf(msg), direct = opts.direct ?? true;
      const playbook = opts.playbook && { name: opts.playbook.name, body: opts.playbook.body };
      const media = await gatherTurnImages(items.map((i) => i.msg), () => llmRouter.acceptsImages(runtime.tenantId, botId));
      if (media.blind && !items.some((i) => i.text)) { await send(BLIND_ONLY_NOTE); return; }
      let turn = [items.map((i) => speakerTurn(i.msg.guildId, i.msg.member?.displayName || i.msg.author.username, withPlaceholders(i.text, i.msg))).join("\n"), media.context].filter(Boolean).join("\n");
      const brief = opts.binding && { place: { guildId: opts.binding.guildId, channelId: opts.binding.channelId, threadId: opts.binding.threadId }, authorId: opts.binding.authorId, outsider: actor.id !== opts.binding.authorId };
      if (brief?.outsider) turn = outsiderTurn(turn);
      else if (brief) { const input = await takeBriefInput(runtime.tenantId, brief.place).catch(() => null); if (input) turn = inputTurn(input, turn); }
      const place = brief?.place ?? (opts.playbook && thread?.parentId && msg.guildId ? { guildId: msg.guildId, channelId: thread.parentId, threadId: thread.id } : null);
      const shots = place && !brief?.outsider ? media.shots : [];
      if (shots.length) await recordBriefImages(runtime.tenantId, place!, shots).catch(() => null);
      const output = await agentReActLoop.run({ tenantId: runtime.tenantId, botId, message: turn, images: media.images, conversationId: conversation?.id, maxIterations: agent?.settings?.maxReActIterations || 12, context: { tenantId: runtime.tenantId, platform: "discord", guildId: msg.guildId || undefined, guildName: msg.guild?.name, channelId, userId: actor.id, userName: actor.name, addressed: direct, playbook, skillContext: { member: memberAuth(actor.member), discord: new DiscordJSAdapter(runtime.client, msg.guildId || runtime.guildIds[0]), parentChannelId: (msg.channel.isThread() ? msg.channel.parentId : msg.channelId) ?? undefined } } });
      output.reply = [output.reply, ...(output.imagesRejected ? [REJECTED_NOTE] : []), ...media.notes].join("\n");
      if (output.imagesRejected && shots.length) await unseeBriefImages(runtime.tenantId, place!, shots.map((s) => s.id)).catch(() => null);
      // A posted round or draft is the reply: its layout is decided in code, so the model's own text does not go out with it.
      const round = roundMessagesOf(output.toolCallsExecuted), written = draftsWrittenOf(output.toolCallsExecuted);
      const plan: ReplyPlan = round.length || written.length ? { messages: round } : prepareReply(output.reply, { addressed: direct });
      if (brief?.outsider && plan.messages.length) {
        const note = authorDecidesNote(brief.authorId), last = plan.messages.length - 1;
        if (plan.messages[last]!.length + note.length < MESSAGE_LIMIT) plan.messages[last] += `\n${note}`; else plan.messages.push(note);
      }
      if (plan.reaction) await msg.react(plan.reaction).catch(() => {});
      for (const chunk of plan.messages) await send(chunk);
      if (written.length && place && target.isSendable()) await this.showDrafts(runtime.tenantId, target, place, written);
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
  /** Posts each written draft as an embed, or edits its embed in place with a one-line note, then refreshes drafts.md. */
  private async showDrafts(tenantId: string, target: any, place: BindingPlace, written: { n: number; note?: string }[]) {
    const found = await readBinding(tenantId, place);
    if (!found) return;
    const state = briefState(found.binding), ids: Record<number, string> = {};
    const fetch = (id?: string) => (id ? target.messages.fetch(id).catch(() => null) : null);
    for (const { n, note } of written) {
      const d = state.drafts[n - 1];
      if (!d) continue;
      const embed = draftEmbed(state, found.binding, n), shown = await fetch(d.messageId);
      if (shown) await shown.edit({ embeds: [embed] });
      else ids[n] = (await target.send({ embeds: [embed], allowedMentions: { parse: [] } })).id;
      if (note) await target.send({ content: revisionNote(found.binding, { ...d, messageId: ids[n] ?? d.messageId }, note), allowedMentions: { parse: [] } });
    }
    const file = draftsFile(state, found.binding);
    let fileMessageId: string | undefined;
    if (file) {
      const files = [{ attachment: Buffer.from(file.content), name: file.name }], shown = await fetch(state.draftsFileMessageId);
      if (shown) await shown.edit({ files, attachments: [] });
      else fileMessageId = (await target.send({ content: DRAFTS_FILE_NOTE, files, allowedMentions: { parse: [] } })).id;
    }
    await recordDraftMessages(tenantId, place, ids, fileMessageId);
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
