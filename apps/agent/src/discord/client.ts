import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Partials, Events, ChannelType, type Attachment, type SendableChannels, type ChatInputCommandInteraction, type Message, type ThreadChannel, type MessageContextMenuCommandInteraction } from "discord.js";
import { repositories, DEFAULT_CONVERSATION_IDLE_HOURS } from "@pachiware/db";
import { DiscordJSAdapter } from "./adapter.js";
import { catchUpDailyLogs } from "./dailyLogDays.js";
import { agentReActLoop } from "../loop/react.js";
import { rollSummary } from "../loop/summary.js";
import { continuesConversation, patchConversationMetadata } from "../loop/conversationMetadata.js";
import { respondReason, addressed, isNoise, threadName, speakerTurn, speakerName, keepableId, withoutMention, placeOfChannel, replyLine, requestedWord, asksForTasks, askerLines } from "./routing.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { CacheService, tenantKey } from "../cache/redis.js";
import { pendingOf, confirmMessage, handleConfirmButton, type ButtonLike } from "./gitConfirm.js";
import { outgoingFiles, type OutgoingDiscordFile } from "./outgoingFiles.js";
import { audit, failureOf, scheduleCardOf, listPlaybooks, playbookCatalogue, withLoads, onPlaybooksChanged, onAvailabilityChanged, boundPlaybook, readBinding, writeBinding, bindingPlace, rewriteBinding, availabilityPlace, skillRegistry, recordBriefInput, takeBriefInput, inputTurn, outsiderTurn, authorDecidesNote, presetPointsTurn, recordBriefImages, unseeBriefImages, replyLanguage, shownLanguage, languageOf, textIn, configuredLanguage, configuredTimezone, today, now, openDrafts, keepProgressMessage, isWorkedOn, goesOnWith, resumeDraft, pauseDraft, serviceFailures, measureTurn, draftState, keepClosingSummary, threadRepositoryOf, threadDocumentsOf, anyRepositoryAllowed, issueBatchReport, moveOldThreadFiles, minutesToTasks, describeImageInto, type Language, type Playbook, type PlaybookBinding, type OpenDraft, type FailedForGood } from "@pachiware/skills";
import { guildCommands } from "./commands.js";
import { causeText, playbookReport } from "./serverPlaybooks.js";
import { forgetDeletedMessage } from "./dailyLog.js";
import { prepareReply, replyQuietly, splitReply, withNotes, withPing, type ReplyPlan } from "./replyStyle.js";
import { gatherTurnImages, fileTurnDocuments, fileTurnImages, withPlaceholders } from "./attachments.js";
import { describeImage, pageReader } from "./vision.js";
import { briefTurn, showDrafts, afterBriefConfirm } from "./briefThread.js";
import { llmRouter } from "../llm/router.js";
import { botCompletion } from "../llm/completion.js";
import { TurnProgress } from "./progress.js";
import { MINUTES_PLAYBOOK, RECENT_MS, minutesRefusal, writeMinutes, minutesFileOf, correctMinutes, minutesBrief, namedNumbers, NOT_A_CORRECTION, type MinutesBrief } from "./minutes.js";
import { DEFAULT_MODEL_RETRY_WAIT_SECONDS } from "@pachiware/db";
import { atClock, awaitModelRetry, modelAnswered, retryTime } from "@pachiware/skills";
import type { ModelFailure } from "../llm/types.js";
import { workedOnPlaces } from "@pachiware/skills";

const BURST_MS = 2500;
/** How many messages before a line `followsBot` reads, looking for the bot's reply behind a burst. */
const FOLLOW_LOOKBACK = 10;
// Admin edits often come in a run (several rules saved one after another); one registration covers them.
const COMMANDS_MS = 2000;
/** How many of the conversation's latest stored messages the asker's own words are read from. */
const ASKER_ROWS = 40;
// `replyTo` is the message a person replied to, when it could be fetched; it gets its own line before theirs.
/** `follows`: a line that does not address the bot but came right after its reply, in its own thread. */
type TurnItem = { msg: Message; text: string; direct?: boolean; follows?: boolean; replyTo?: Message | null };
/** `sentCommands` holds each guild's last overwrite as JSON, so an unchanged guild is not sent again. */
type BotRuntime = { client: Client; adapter: DiscordJSAdapter; tenantId: string; connected: boolean; guildIds: string[]; globalCleared: boolean; sentCommands: Map<string, string> };
/** A Discord adapter of a bot bound to `guildId` (else its first served guild) and limited to the guilds it serves now. */
const adapterFor = (runtime: Pick<BotRuntime, "client" | "guildIds">, guildId?: string | null) => new DiscordJSAdapter(runtime.client, guildId || runtime.guildIds[0], runtime.guildIds);
/** Who a turn acts for: the message author, or the person who ran a command on someone else's message. */
type Actor = { id: string; name: string; member: any };
/** Whom work that goes on by itself is for: a Changelog draft's asker, else the person whose turn started it. */
type Asker = { id: string; name: string };
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
/**
 * A turn that goes on by itself has no message to answer either: it stands in for one from its asker in its place, and what it says is
 * posted there as a new message.
 */
const placeTurn = (channel: SendableChannels, actor: Actor): Message => ({
  guildId: "guildId" in channel ? channel.guildId : null, guild: "guild" in channel ? channel.guild : null, channelId: channel.id, channel,
  author: { id: actor.id, username: actor.name }, member: actor.member, content: "", attachments: new Map(), reply: (payload: any) => channel.send(payload), react: async () => {},
}) as unknown as Message;
// A guild member from the cache has a roles collection; one sent raw with an interaction has an id array.
/** `channelId` is the channel the task is in, when the write says so. */
type Assignment = { assigneeId: string; title: string; dueAt: string | null; channelId?: string };
/** The member Assignees this turn's task writes gave work to, from createTask, assignTask and tasksFromMinutes results (#250). */
function assignmentsOf(executed: { call: { name: string }; result: { success: boolean; data?: any } }[]): Assignment[] {
  return executed.flatMap(({ call, result }): Assignment[] => {
    if (!result.success) return [];
    if (call.name === "tasksFromMinutes") return (result.data?.created ?? []).filter((c: any) => c.assigneeId).map((c: any) => ({ assigneeId: c.assigneeId, title: c.title, dueAt: c.dueAt }));
    const task = (call.name === "createTask" || call.name === "assignTask") && result.data?.success !== false ? result.data?.task : null;
    const channelId = typeof result.data?.channelId === "string" ? result.data.channelId : undefined;
    return task?.assignedTo?.id ? [{ assigneeId: task.assignedTo.id, title: task.title, dueAt: task.dueAt, ...(channelId ? { channelId } : {}) }] : [];
  });
}
/**
 * Pings each member someone else gave a task to this turn, listing theirs; the asker and the bot are never pinged. In a private thread only
 * its members are pinged, there: a mention would add anyone else to the thread, and posting in the parent would show what the thread keeps.
 */
async function tellAssignees(channel: any, assignments: Assignment[], actorId: string, botUserId: string | undefined, language: Language) {
  const byPerson = new Map<string, Assignment[]>();
  for (const a of assignments) if (a.assigneeId !== actorId && a.assigneeId !== botUserId) byPerson.set(a.assigneeId, [...(byPerson.get(a.assigneeId) ?? []), a]);
  if (channel.type === ChannelType.PrivateThread) for (const id of [...byPerson.keys()]) if (!(await channel.members?.fetch(id).then(() => true, () => false))) byPerson.delete(id);
  const t = textIn(language);
  // One message per person keeps every ping under Discord's length limit; a long list is split at line breaks.
  for (const [id, tasks] of byPerson) for (const content of splitReply(t.assigned(`<@${id}>`, tasks))) await channel.send({ content, allowedMentions: { users: [id] } }).catch(() => {});
}
/**
 * `tellAssignees` where each Assignee can view their task (#260): a task of this turn's channel (`projectChannelId`, a thread's parent)
 * in the turn's own channel or thread, and one of another channel, written from here or from a DM, in that channel, in its server's language.
 */
async function tellAssigneesWhereTasksAre(runtime: BotRuntime, botId: string, turn: { target: any; guildId: string | null; projectChannelId?: string; language: Language }, assignments: Assignment[], actorId: string) {
  const botUserId = runtime.client.user?.id, elsewhere = new Map<string, Assignment[]>();
  for (const a of assignments) if (a.channelId && a.channelId !== turn.projectChannelId) elsewhere.set(a.channelId, [...(elsewhere.get(a.channelId) ?? []), a]);
  if (turn.guildId) await tellAssignees(turn.target, assignments.filter((a) => !a.channelId || a.channelId === turn.projectChannelId), actorId, botUserId, turn.language);
  for (const [id, theirs] of elsewhere) {
    const channel: any = await runtime.client.channels.fetch(id).catch(() => null);
    if (!channel?.isSendable?.()) continue;
    const guild = channel.guildId ? await loadGuildSettings(runtime.tenantId, botId, channel.guildId) : null;
    await tellAssignees(channel, theirs, actorId, botUserId, configuredLanguage(guild, await repositories().agentConfig.get(runtime.tenantId)));
  }
}

export const memberAuth = (m: any) => ({ roleIds: Array.isArray(m?.roles) ? m.roles : m?.roles?.cache ? [...m.roles.cache.keys()] : [], permissions: m?.permissions?.toArray?.() ?? [] });
const TRIGGER = /^([\p{L}\p{N}_-]{1,32})\s*(?::|\n)\s*([\s\S]*)$/u;
const WORD_ONLY = /^([\p{L}\p{N}_-]{1,32})[.!?]?$/u;
/**
 * How many turns a long playbook's work goes on by itself after a turn ran out, and what the model is told for each (#289). A Changelog
 * draft that is worked on goes on after any turn, with no such limit, until it ends or pauses (#361).
 */
const LONG_CONTINUATIONS = 2;
/**
 * The Stop button on a turn's progress message: `changelogstop:<draft name>` names the place's open Changelog draft, so it can be found
 * from the draft again (#355); other work's is `turnstop:<id>` (#351).
 */
const STOP_PREFIX = "turnstop", DRAFT_STOP_PREFIX = "changelogstop";
const isStopButton = (id: string) => id.startsWith(`${STOP_PREFIX}:`) || id.startsWith(`${DRAFT_STOP_PREFIX}:`);
/** What a Stop button stops: the turns of one piece of work, which only its asker may cut short. */
type StopEntry = { askerId: string; askerName: string; stopped: boolean; language?: Language };
const CONTINUE_TURN = "[No one wrote this: the last turn ran out of its budget before the work was done. Continue from where it stopped, building on what is already recorded; do not start over or repeat finished steps.]";
const DRAFT_TURN = "[No one wrote this: the API changelog is not written yet, so the work on it goes on by itself. Continue from where it stopped, building on what is already recorded; do not start over or repeat finished steps.]";
/**
 * A turn's tool calls by name, in the order first called, with how many failed: "repoReadFile ×5 (1 failed), putChangelogOperation ×1".
 */
function stepsOf(executed: { call: { name: string }; result: { success: boolean } }[]) {
  const byName = new Map<string, { calls: number; failed: number }>();
  for (const { call, result } of executed) {
    const seen = byName.get(call.name) ?? { calls: 0, failed: 0 };
    byName.set(call.name, { calls: seen.calls + 1, failed: seen.failed + (result.success ? 0 : 1) });
  }
  return byName.size ? [...byName].map(([name, n]) => `${name} ×${n.calls}${n.failed ? ` (${n.failed} failed)` : ""}`).join(", ") : "no steps";
}
/** What an ephemeral turn concluded, as a stored turn would keep it: its last row, when that is an answer. */
const closingOf = (recorded: { role: string; content: string | null; toolCalls?: unknown[] | null }[]) => {
  const last = recorded.at(-1);
  return last?.role === "assistant" && !last.toolCalls?.length && last.content?.trim() ? last.content : null;
};
/**
 * Leaves a turn that went on by itself in its place's conversation as one row, its closing summary; its steps stay out, so the place's
 * later turns read what it concluded, not what it read (#360). A place whose conversation ended gets a new one, as a person's turn would.
 */
async function keepClosingRow(tenantId: string, botId: string, conversation: { id: string } | null, at: { channelId: string; userId: string; parentChannelId?: string }, content: string) {
  const { conversations } = repositories();
  const id = conversation?.id ?? (await conversations.create({ tenantId, botId, platform: "discord", channelId: at.channelId, userId: at.userId, metadata: { parentChannelId: at.parentChannelId ?? null } })).id;
  await conversations.addMessage({ tenantId, conversationId: id, role: "assistant", content, toolCalls: null });
  return id;
}
/** `draft` names the worked-on Changelog draft a turn that goes on by itself goes on with (#361). */
type ReplyOptions = { actor?: Actor; playbook?: Playbook; binding?: PlaybookBinding; direct?: boolean; continued?: number; answerIn?: Language; progress?: TurnProgress; stop?: StopEntry; draft?: string };
/** Who asks where, as a place's Changelog drafts are found: the channel or thread, and the person. */
type DraftPlace = Parameters<typeof openDrafts>[0];
const draftPlaceOf = (runtime: Pick<BotRuntime, "tenantId">, botId: string, channel: Message["channel"], userId: string) =>
  ({ tenantId: runtime.tenantId, botId, guildId: "guildId" in channel ? channel.guildId ?? undefined : undefined, ...placeOfChannel(channel), userId });
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
  const playbooks = await listPlaybooks(tenantId, at.guildId), place = placeOf(tenantId, botId, at);
  const cause = (await skillRegistry.availableAt(place, playbooks)).playbookCause(playbook.name);
  const t = textIn(language);
  if (!cause) {
    const noRepository = withLoads(playbook, playbooks).repository === "required" && !await anyRepositoryAllowed(place);
    return noRepository ? t.repositoryNone(playbook.name) : null;
  }
  return causeText(t, playbook.name, cause);
}
export class DiscordBotManager {
  private clients = new Map<string, BotRuntime>();
  private operations = new Map<string, Promise<any>>();
  private bursts = new Map<string, { items: TurnItem[]; timer: ReturnType<typeof setTimeout> }>();
  private inflight = new Set<Promise<unknown>>();
  private commandTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The turns a person can stop now, by the id on their Stop button, and who may press it. */
  private stops = new Map<string, StopEntry>();
  /** How many turns a person started per conversation; a turn going on by itself gives way when it changed since it was queued. */
  private heard = new Map<string, number>();
  /**
   * The worked-on Changelog drafts this process works on, by tenant and place, with the bot that works each: found when a bot starts, and
   * kept by every turn that leaves one worked on, so a scheduler pass finds one whose work stopped going on (#362).
   */
  private working = new Map<string, { botId: string; channelId: string }>();
  /** Turns of this process waiting on a model retry, by conversation; a bot that stops leaves them to its next start (#358, #362). */
  private retries = new Map<string, { leave(): void }>();
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
    if (!msg.guildId || (runtime.guildIds.length && !runtime.guildIds.includes(msg.guildId))) return;
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
    this.forgetWork(id);
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
      this.track(this.wakeOnStart(runtime, id));
    });
    client.on(Events.GuildCreate, () => { if (runtime.connected) this.scheduleCommands(id); });
    client.on(Events.GuildDelete, (guild) => { runtime.sentCommands.delete(guild.id); });
    client.on(Events.ShardDisconnect, () => { runtime.connected = false; void repositories().bots.update(id, { connectionStatus: "disconnected" }).catch(() => {}); });
    client.on(Events.ShardResume, () => { runtime.connected = true; void repositories().bots.update(id, { connectionStatus: "connected" }).catch(() => {}); });
    client.on(Events.Error, () => { void repositories().bots.update(id, { lastError: "Discord gateway error" }).catch(() => {}); });
    client.on(Events.InteractionCreate, (i) => {
      if (i.isButton() && isStopButton(i.customId)) this.track(this.pressStop(runtime, id, i as any));
      else if (i.isButton()) this.track(handleConfirmButton(i as any, id, (guildId) => new DiscordJSAdapter(client, guildId), async (action, result) => (await afterBriefConfirm(runtime.client, runtime.tenantId, action, result)) ?? issueBatchReport(action.tool, result) ?? await playbookReport(action, result)));
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
      for (const { from, to } of report?.taken ?? []) console.warn(`[discord] Kept in place, "${to}" is taken: ${from}`);
    }
  }
  /**
   * When a bot is ready, every worked-on Changelog draft in the guilds it serves goes on by itself (#362): the drafts say they are worked
   * on, so a restart costs their askers no "lanjut".
   */
  private async wakeOnStart(runtime: BotRuntime, botId: string) {
    const served = [...runtime.client.guilds.cache.keys()].filter((g) => !runtime.guildIds.length || runtime.guildIds.includes(g));
    for (const guildId of served) {
      for (const channelId of await workedOnPlaces(runtime.tenantId, guildId).catch(() => [])) await this.wake(runtime, botId, channelId).catch(() => {});
    }
  }
  /**
   * A scheduler pass's part in the work on Changelog drafts (#362): each draft this process works on goes on when no turn of its place
   * runs or waits, and one waiting on a model retry goes on once its time came.
   */
  async wakeDrafts() {
    for (const { botId, channelId } of [...this.working.values()]) {
      const runtime = this.clients.get(botId);
      if (runtime?.connected) await this.wake(runtime, botId, channelId).catch(() => {});
    }
  }
  /** A bot that stops works on no draft of this process: its turns waiting on a retry go, and its next start finds its drafts again (#362). */
  private forgetWork(botId: string) {
    for (const [key, waiting] of [...this.retries]) if (key.startsWith(`conv:${botId}:`)) waiting.leave();
    for (const [key, work] of [...this.working]) if (work.botId === botId) this.working.delete(key);
  }
  /** Whether a turn of the place runs or waits, any bot's, a turn of this process waiting on a model retry included. */
  private busy(channelId: string) {
    const ofPlace = (key: string) => key.startsWith("conv:") && key.endsWith(`:${channelId}`);
    return [...this.operations.keys()].some(ofPlace) || [...this.retries.keys()].some(ofPlace);
  }
  /**
   * Has the worked-on Changelog draft of a place go on by itself, with a turn addressed by its place and asker (#362). It waits while a turn
   * of the place runs or waits, which goes on with the draft already, and until a pending model retry's time; a paused or ended draft is
   * not woken, nor one without an asker to act as. Reading the place drops a draft left untouched too long, so that one is never woken.
   * A playbook thread's draft goes on only with the thread's bot, any other with the bot of the tenant that found it first.
   */
  private async wake(runtime: BotRuntime, botId: string, channelId: string) {
    const key = `${runtime.tenantId}:${channelId}`, claimed = this.working.get(key);
    if (claimed && claimed.botId !== botId) return;
    const fetched = await runtime.client.channels.fetch(channelId).catch(() => null);
    const channel = fetched?.isSendable() ? fetched : null;
    if (!channel) return;
    const thread = channel.isThread() ? channel : null;
    const bound = thread?.parentId ? await boundPlaybook(runtime.tenantId, { guildId: thread.guildId, channelId: thread.parentId, threadId: thread.id }).catch(() => null) : null;
    if (bound?.binding.botId && bound.binding.botId !== botId) return;
    const draft = (await openDrafts(draftPlaceOf(runtime, botId, channel, runtime.client.user?.id ?? "")).catch(() => []))[0];
    if (!draft || !isWorkedOn(draft) || !draft.startedBy) {
      if (claimed) this.working.delete(key);
      return;
    }
    this.working.set(key, { botId, channelId });
    const retryAt = retryTime(draft);
    if ((retryAt !== undefined && retryAt > now()) || this.busy(channelId)) return;
    const convKey = `conv:${botId}:${channelId}`, heard = this.heard.get(convKey) ?? 0;
    const asker = { id: draft.startedBy.id, name: draft.startedBy.name ?? draft.startedBy.id };
    const opts: ReplyOptions = { continued: 1, draft: draft.name, ...(bound?.playbook ? { playbook: bound.playbook, binding: bound.binding } : {}) };
    void this.serialize(convKey, () => this.goOn(runtime, botId, { channelId, asker }, opts, heard)).catch(() => {});
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
    const catalogue = await playbookCatalogue(runtime.tenantId);
    const refused: string[] = [];
    for (const guildId of runtime.client.guilds.cache.keys()) {
      const setUp = !runtime.guildIds.length || runtime.guildIds.includes(guildId);
      const commands = setUp ? await guildCommands({ tenantId: runtime.tenantId, botId, guildId }, await listPlaybooks(runtime.tenantId, guildId, catalogue)) : [];
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
    const found = msg.guildId && parentId ? await boundPlaybook(runtime.tenantId, { guildId: msg.guildId, channelId: parentId, threadId: channelId0 }) : null;
    // A playbook thread is its starting bot's alone; a binding from before bots were recorded is open to any.
    if (found?.binding.botId && found.binding.botId !== botId) return;
    // A playbook gone (deleted, or a server's own now hidden by a tenant one), no longer available here, or one whose chain is not, ends its
    // thread's binding; the message that finds out gets the one note instead of an answer.
    if (found && (!found.playbook || (await skillRegistry.availableAt(placeOf(runtime.tenantId, botId, msg))).playbookCause(found.playbook.name))) {
      const ended = await rewriteBinding(runtime.tenantId, bindingPlace(found.binding), ({ binding }) => binding.status === "active" ? { binding: { ...binding, status: "cancelled" as const }, value: true } : null).catch(() => null);
      if (ended) await replyQuietly(msg)(textIn(replyLanguage(msg.content)).playbookEnded(found.binding.playbook));
      return;
    }
    const bound = found as { playbook: Playbook; binding: PlaybookBinding } | null;
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
      trigger.lastMessageFromBot = await this.followsBot(msg, botUserId);
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
        if (asksForTasks(text)) { await this.tasksFromMinutesReply(runtime, botId, msg, ref, text); return; }
        if (await this.briefFromMinutes(runtime, botId, msg, ref, text)) return;
        const corrected = await this.serialize(`minutes:${ref.id}`, () => correctMinutes({ tenantId: runtime.tenantId, botId, guildId: msg.guildId!, minutesMessage: ref, reply: msg, text }));
        if (corrected !== NOT_A_CORRECTION) return;
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
    const replyTo = await reference(), follows = !direct && trigger.lastMessageFromBot;
    if (!msg.guildId || thread) { await run(msg, [{ msg, text, direct, follows, replyTo }]); return; }
    // Burst of one person's messages in a shared channel: wait for their pause, then answer once with all of them, as them.
    // Keyed by author too, so someone posting at the same moment gets their own turn and never acts with another person's rights.
    const key = `${botId}:${channelId}:${msg.author.id}`;
    const burst = this.bursts.get(key) ?? { items: [] as TurnItem[], timer: undefined as any };
    burst.items.push({ msg, text, direct, follows, replyTo });
    clearTimeout(burst.timer);
    burst.timer = setTimeout(() => {
      this.bursts.delete(key);
      const last = burst.items[burst.items.length - 1].msg;
      void run(last, burst.items).catch(() => {});
    }, this.burstMs);
    this.bursts.set(key, burst);
  }
  /**
   * Whether the bot spoke last before `msg`, looking past a burst (#244): people's lines posted within the burst window of each other
   * just before it, anyone's, do not hide the bot's reply they all came after. Discord pages hold the newest message first.
   */
  private async followsBot(msg: Message, botUserId: string) {
    const earlier = await msg.channel.messages.fetch({ limit: FOLLOW_LOOKBACK, before: msg.id }).catch(() => null);
    let after = msg.createdTimestamp;
    for (const m of earlier?.values() ?? []) {
      if (m.author.id === botUserId) return true;
      if (m.author.bot || after - m.createdTimestamp > this.burstMs) return false;
      after = m.createdTimestamp;
    }
    return false;
  }
  /** "@bot issue: points" starts the playbook whose trigger word leads the message; an in-place one such as "@bot minutes" needs no points. */
  private async triggerPlaybook(runtime: BotRuntime, botId: string, msg: Message, text: string, bound: boolean) {
    const m = TRIGGER.exec(text) ?? WORD_ONLY.exec(text), requested = m ? null : requestedWord(text);
    if (!m && !requested) return false;
    const word = (m?.[1] ?? requested)!.toLowerCase();
    const playbook = (await listPlaybooks(runtime.tenantId, msg.guildId)).find((p) => p.words.includes(word) || (p.name === word && p.start));
    // A request without a colon ("notulen dong") carries no points, so it starts only a playbook that needs none.
    if (!playbook || (requested && playbook.run !== "in-place")) return false;
    const say = replyQuietly(msg);
    if (playbook.run === "in-place") {
      const about = msg.reference ? await msg.fetchReference().catch(() => null) : undefined;
      await this.runInPlace(runtime, botId, playbook, { from: "mention", message: msg, about, actor: actorOf(msg), text: m?.[2]?.trim() ?? "", language: replyLanguage(text), refuse: say, fail: say });
      return true;
    }
    if (bound || !msg.guildId || !m?.[2]?.trim()) return false;
    const opened = await this.openPlaybook(runtime, botId, playbook, msg, m[2].trim(), actorOf(msg));
    if ("error" in opened) await say(opened.error);
    else await opened.start();
    return true;
  }
  /** "jadikan task poin 2-3" replying to Minutes: those action items become Tasks of the Minutes' channel, with no model turn (#253). */
  private async tasksFromMinutesReply(runtime: BotRuntime, botId: string, msg: Message, minutes: Message, text: string) {
    const actor = actorOf(msg), place = placeOfChannel(msg.channel);
    const guild = await loadGuildSettings(runtime.tenantId, botId, msg.guildId!), agent = await repositories().agentConfig.get(runtime.tenantId);
    // "jadikan task semua" holds no function word to tell its language by: the place's language answers it then.
    const detected = languageOf(text, 1), language = detected === "unknown" ? configuredLanguage(guild, agent) : detected;
    const ctx = {
      tenantId: runtime.tenantId, botId, guildId: msg.guildId!, guildName: msg.guild?.name, channelId: msg.channelId, parentChannelId: place.parentChannelId, privateThread: place.privateThread,
      userId: actor.id, userName: actor.name, timezone: configuredTimezone(guild, agent), language, discord: adapterFor(runtime, msg.guildId),
      auth: { tenantId: runtime.tenantId, botId, userId: actor.id, guildId: msg.guildId!, channelId: msg.channelId, parentChannelId: place.parentChannelId, ...memberAuth(actor.member) },
    };
    // Through the registry, as the model's call would go: availability rules, permissions and rate limits apply to a reply too.
    const call = { id: `tasksFromMinutes-${msg.id}`, name: "tasksFromMinutes", arguments: { minutes: minutesFileOf(minutes)!, points: namedNumbers(text.replace(/<[@#][!&]?\d+>/g, " ")) } };
    const result = await this.serialize(`minutes:${minutes.id}`, () => skillRegistry.executeTool(call, ctx));
    const message = result.success ? String(result.data?.message ?? "") : result.error ?? textIn(language).failed;
    for (const chunk of splitReply(message)) await replyQuietly(msg)(chunk);
    if (result.success && msg.channel.isSendable()) await tellAssignees(msg.channel, assignmentsOf([{ call, result }]), actor.id, runtime.client.user?.id, configuredLanguage(guild, agent));
  }
  /** "@bot turn points 2 and 3 into issues" replying to minutes: an explicit mention naming a playbook's word starts it from those action items. */
  private async briefFromMinutes(runtime: BotRuntime, botId: string, msg: Message, minutes: Message, text: string) {
    if (!new RegExp(`<@!?${runtime.client.user?.id}>`).test(msg.content)) return false;
    const said = text.toLowerCase();
    const playbook = (await listPlaybooks(runtime.tenantId, msg.guildId)).find((p) => p.run === "thread" && p.words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}_])${w}s?(?![\\p{L}\\p{N}_])`, "u").test(said)));
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
    const playbook = (await listPlaybooks(runtime.tenantId, i.guildId)).find((p) => p.name === i.commandName && p.start);
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
    const saved = await writeBinding(runtime.tenantId, { playbook: playbook.name, playbookSource: playbook.source, status: "active", ...place, authorId: actor.id, authorName: actor.name, botId, botName: runtime.client.user?.username, sourceMessageId: source.id, startedAt: today().toISOString(), ...(fromMinutes && { points: fromMinutes.points }) }, `${brief}\n`, previous?.version).catch(() => null);
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
      const timezone = configuredTimezone(at.guildId ? await loadGuildSettings(runtime.tenantId, botId, at.guildId) : null, await repositories().agentConfig.get(runtime.tenantId));
      const error = await writeMinutes({
        tenantId: runtime.tenantId, botId, adapter, playbook, guildId: at.guildId!, channelId: at.channelId, parentId: thread ? at.channel.parentId : null, privateThread: placeOfChannel(at.channel).privateThread, requesterId: o.actor.id, timezone,
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
  /**
   * What a turn left of its place's Changelog draft (#361): whether the draft is worked on, so the work goes on by itself, and whether the
   * turn went on with it, paused it or ended it. A Stop its asker pressed pauses a draft still worked on, such as one the turn started after
   * its Stop button went up. A turn that went on by itself is counted (`countTurn`), and its draft pauses when it is the second in a row to
   * add nothing (`stalled`, #357). `asked` is the question the turn paused it with, through askChangelogAsker (#356); a draft so paused is
   * no longer worked on, so that turn is not counted.
   */
  private async draftWork(place: DraftPlace, before: OpenDraft | undefined, output: { toolCallsExecuted: { call: { name: string; arguments?: unknown } }[]; serviceFailed?: FailedForGood }, stop: StopEntry, resuming?: Promise<unknown>, countTurn?: (() => Promise<boolean>) | null) {
    await resuming;
    let after = (await openDrafts(place).catch(() => []))[0];
    if (after && stop.stopped && isWorkedOn(after) && await pauseDraft(place, after.draft, { reason: "stopped" }).catch(() => false)) after = (await openDrafts(place).catch(() => []))[0];
    // A service it reads that failed for good pauses it, naming the service; the host, status, error, tool and file are the console's (#359).
    const failed = output.serviceFailed;
    if (after && failed && isWorkedOn(after) && await pauseDraft(place, after.draft, { reason: "service", service: failed.service }, { host: failed.host, ...(failed.status ? { status: failed.status } : {}), error: failed.error, tool: failed.tool, ...(failed.file ? { file: failed.file } : {}) }).catch(() => false)) after = (await openDrafts(place).catch(() => []))[0];
    const ended = !!before && after?.name !== before.name;
    const stalled = !!after && !ended && isWorkedOn(after) && !!countTurn && await countTurn().catch(() => false);
    if (stalled) after = (await openDrafts(place).catch(() => []))[0];
    const draft = after ?? before, workedOn = !!after && isWorkedOn(after);
    const wentOn = !!draft && output.toolCallsExecuted.some(({ call }) => goesOnWith(draft, call));
    const pausedNow = !!after && !workedOn && (wentOn || stop.stopped || stalled), paused = after?.work?.state === "paused" ? after.work : undefined;
    const asked = pausedNow && paused?.reason === "question" && output.toolCallsExecuted.some(({ call }) => call.name === "askChangelogAsker") ? paused.question : undefined;
    return { draft, wentOn, workedOn, ended, stalled, pausedNow, asked };
  }
  /** Forgets the Stop buttons of work that ended. */
  private dropStop(stop: StopEntry | undefined) {
    for (const [id, entry] of this.stops) if (entry === stop) this.stops.delete(id);
  }
  /**
   * What a turn's model failure does to its place's worked-on Changelog draft (#358). A turn that went on by itself (`own`) and could not
   * reach the model has the same continuation run once more after the tenant's wait, the time kept in the draft; failing with a retry
   * already pending, or with a wait of 0, it pauses the draft for "model". A person's turn that fails changes nothing, and the work goes on
   * after it, at the pending retry's time when one waits. A turn the model answered clears a pending retry. `retryAt` is when the work
   * goes on, if not at once.
   */
  private async modelOutage(place: DraftPlace, work: { draft?: OpenDraft; workedOn: boolean }, output: { failed?: true; failure?: ModelFailure }, own: boolean, waitSeconds: number): Promise<{ retryAt?: number; paused?: boolean }> {
    if (!work.draft || !work.workedOn) return {};
    const pending = retryTime(work.draft);
    if (!output.failed) {
      if (pending !== undefined) await modelAnswered(place, work.draft.draft).catch(() => {});
      return {};
    }
    if (!own) return pending !== undefined ? { retryAt: pending } : {};
    if (pending === undefined && waitSeconds > 0) {
      const retryAt = now() + waitSeconds * 1000;
      if (await awaitModelRetry(place, work.draft.draft, retryAt).catch(() => false)) return { retryAt };
    }
    return { paused: await pauseDraft(place, work.draft.draft, { reason: "model" }, { ...output.failure }).catch(() => false) };
  }
  /**
   * Stops the turn its Stop button belongs to, when the asker presses it: no further tool call runs (#351). A Changelog draft's button
   * pauses the draft there and then, whatever turn runs in its place (#361).
   */
  private async pressStop(runtime: BotRuntime, botId: string, i: ButtonLike & { channel?: Message["channel"] | null }) {
    const name = i.customId.startsWith(`${DRAFT_STOP_PREFIX}:`) ? i.customId.slice(DRAFT_STOP_PREFIX.length + 1) : null;
    const place = name && i.channel ? draftPlaceOf(runtime, botId, i.channel, i.user.id) : null;
    const open = place ? (await openDrafts(place).catch(() => [])).find((d) => d.name === name) : undefined;
    // No turn of this process may hold the button yet, as after a restart: the worked-on draft it names says whose work it is (#362).
    const entry = this.stops.get(i.customId) ?? (open?.startedBy && isWorkedOn(open) ? await this.draftStop(runtime, botId, i, open.startedBy) : undefined);
    const t = textIn(entry?.language).progress;
    if (!entry) { await i.reply({ content: t.stopEnded, ephemeral: true }); return; }
    if (i.user.id !== entry.askerId) { await i.reply({ content: t.stopOnlyAsker(entry.askerName), ephemeral: true }); return; }
    entry.stopped = true;
    if (place && open) await pauseDraft(place, open.draft, { reason: "stopped" }).catch(() => {});
    await i.update({ components: [] });
  }
  /** Who may stop a draft's work that no turn of this process holds: its asker, told off in the place's language. */
  private async draftStop(runtime: BotRuntime, botId: string, i: ButtonLike, asker: { id: string; name?: string }): Promise<StopEntry> {
    const guild = i.guildId ? await loadGuildSettings(runtime.tenantId, botId, i.guildId) : null;
    return { askerId: asker.id, askerName: asker.name ?? asker.id, stopped: false, language: configuredLanguage(guild, await repositories().agentConfig.get(runtime.tenantId)) };
  }
  /**
   * A turn that goes on by itself, queued behind what people sent meanwhile: when one of them was answered first, or one is still being
   * gathered, the work gives way to them and its progress message goes (#351). It is addressed by its place and asker alone, never by the
   * message that started the work (#355): it speaks in that thread, or as a new message in that channel, as its asker.
   */
  private async goOn(runtime: BotRuntime, botId: string, at: { channelId: string; asker: Asker }, opts: ReplyOptions, heard: number) {
    // Work queued before its bot restarted gives way, its progress message left as it is: the restarted bot takes it up (#362).
    if (this.clients.get(botId) !== runtime) {
      this.dropStop(opts.stop);
      opts.progress?.leave();
      return;
    }
    const gathering = [...this.bursts.keys()].some((k) => k.startsWith(`${botId}:${at.channelId}:`));
    // Work on a Changelog draft goes on only while the draft is worked on (#361). Its asker's Stop, pressed in between, still gets the turn,
    // which stops at once and says how far the work got, even after someone else's turn.
    const stopped = !!opts.draft && opts.stop?.stopped === true;
    const cameBetween = gathering || (this.heard.get(`conv:${botId}:${at.channelId}`) ?? 0) !== heard;
    const fetched = cameBetween && !stopped ? null : await runtime.client.channels.fetch(at.channelId).catch(() => null);
    const channel = fetched?.isSendable() ? fetched : null;
    const draft = channel && opts.draft ? (await openDrafts(draftPlaceOf(runtime, botId, channel, at.asker.id)).catch(() => [])).find((d) => d.name === opts.draft) : undefined;
    if (!channel || (opts.draft && !stopped && !(draft && isWorkedOn(draft)))) {
      this.dropStop(opts.stop);
      await opts.progress?.finish(false, !!opts.draft && !!draft && !isWorkedOn(draft));
      return;
    }
    const member = "guild" in channel && channel.guild ? await channel.guild.members.fetch(at.asker.id).catch(() => null) : null;
    const actor: Actor = { id: at.asker.id, name: member?.displayName || at.asker.name, member };
    await this.reply(runtime, botId, placeTurn(channel, actor), [], channel.id, channel.isThread() ? channel : null, { ...opts, actor });
  }
  /**
   * `continued` counts the turns a long playbook's work went on by itself; such a turn has no items, answers in `answerIn`, and carries on
   * the `progress` message and the Stop button (`stop`) of the turn before it.
   */
  private async reply(runtime: BotRuntime, botId: string, msg: Message, items: TurnItem[], channelId: string, thread: ThreadChannel | null, opts: ReplyOptions = {}) {
    const target = thread ?? msg.channel;
    const typing = async () => { try { if ("sendTyping" in target) await target.sendTyping(); } catch {} };
    await typing();
    const interval = setInterval(() => { void typing(); }, 4000);
    // ⏳ marks the messages being answered until the turn ends; one not meant for the bot gets none, since it may get no answer.
    const botUserId = runtime.client.user?.id;
    const working = await Promise.all(items.filter((i) => i.direct !== false && i.msg.author.id !== botUserId).map((i) => i.msg.react("⏳").catch(() => null)));
    // `users` are pinged; nobody else the text names is.
    const send = (content: string, files: OutgoingDiscordFile[] = [], users?: string[]) => {
      const allowedMentions = users ? { users } : { parse: [] as [] };
      return thread ? thread.send({ content, files, allowedMentions }) : msg.reply({ content, files, allowedMentions });
    };
    // The language to answer in is judged on the people's own words, not the quotes and framing around them (#257).
    const shown = opts.answerIn ?? shownLanguage(items.map((i) => i.text).join("\n")), language: Language = shown ?? "en", t = textIn(language);
    let progress: TurnProgress | undefined, stop: StopEntry | undefined, handedOver = false;
    const projectChannelId = (msg.channel.isThread() ? msg.channel.parentId : msg.channelId) ?? undefined;
    const convKey = `conv:${botId}:${channelId}`;
    if (!opts.continued) this.heard.set(convKey, (this.heard.get(convKey) ?? 0) + 1);
    try {
      const agent = await repositories().agentConfig.get(runtime.tenantId);
      const guild = msg.guildId ? await loadGuildSettings(runtime.tenantId, botId, msg.guildId) : null;
      // The channel's latest conversation goes on unless the console ended it or it has been quiet past the tenant's hours; then the loop starts another.
      const latest = await repositories().conversations.latestInChannel(runtime.tenantId, botId, channelId);
      const idleMs = (agent?.settings?.conversationIdleHours ?? DEFAULT_CONVERSATION_IDLE_HOURS) * 3600_000;
      const conversation = latest && continuesConversation(latest.metadata, { idleMs, at: now(), playbook: !!opts.playbook }) ? latest : null;
      const actor = opts.actor ?? actorOf(msg), direct = opts.direct ?? true;
      const repository = opts.binding && threadRepositoryOf(opts.binding), documents = opts.binding && threadDocumentsOf(opts.binding);
      const chained = opts.playbook && withLoads(opts.playbook, await listPlaybooks(runtime.tenantId, msg.guildId));
      const playbook = chained && { name: chained.name, body: chained.body, closes: chained.closes, ...(chained.tools.length ? { tools: chained.tools } : {}), ...(chained.source === "guild" ? { madeInChat: true } : {}), ...(repository ? { repository } : {}), ...(documents ? { documents } : {}), ...(chained.budget === "long" ? { long: true } : {}) };
      const media = await gatherTurnImages(items.map((i) => i.msg), () => llmRouter.acceptsImages(runtime.tenantId, botId), language, new Map(items.flatMap((i) => (i.replyTo !== undefined ? [[i.msg, i.replyTo] as const] : []))));
      // The brief's author still gets a round: it asks them to describe the screenshot.
      const briefAuthor = !!opts.playbook && (!opts.binding || actor.id === opts.binding.authorId);
      if (media.blind && !briefAuthor && !items.some((i) => i.text)) { await send(`${t.blind} ${t.describeImage}`); return; }
      // A Profile that sees images reads scanned PDFs, and the images people send are filed with a description written after the turn (#246).
      const sees = !media.blind && await llmRouter.acceptsImages(runtime.tenantId, botId).catch(() => false);
      const filed = await fileTurnDocuments(runtime.tenantId, items, language, botCompletion({ tenantId: runtime.tenantId, botId, language }), sees ? pageReader(runtime.tenantId, botId) : undefined);
      const images = sees && !opts.playbook ? await fileTurnImages(runtime.tenantId, items, media.shots) : null;
      for (const [id, note] of images?.notes ?? []) filed.set(id, note);
      const lines = items.flatMap((i) => [replyLine(i.replyTo, botUserId), speakerTurn(i.msg.guildId, speakerName(i.msg), withPlaceholders(i.text, i.msg, filed), keepableId(i.text, i.msg.id), i.msg.author.id === botUserId ? undefined : i.msg.author.id)]);
      let turn = opts.continued ? (opts.draft ? DRAFT_TURN : CONTINUE_TURN) : [...lines, media.context].filter(Boolean).join("\n");
      const brief = opts.binding && { place: bindingPlace(opts.binding), authorId: opts.binding.authorId, outsider: actor.id !== opts.binding.authorId };
      if (!opts.continued) {
        if (brief?.outsider) turn = outsiderTurn(turn);
        else if (brief) { const input = await takeBriefInput(runtime.tenantId, brief.place).catch(() => null); if (input) turn = inputTurn(input, turn); }
      }
      const place = brief?.place ?? (opts.playbook && thread?.parentId && msg.guildId ? { guildId: msg.guildId, channelId: thread.parentId, threadId: thread.id } : null);
      const shots = place && !brief?.outsider ? media.shots : [];
      if (shots.length) await recordBriefImages(runtime.tenantId, place!, shots).catch(() => null);
      // What a schedule's `said` quotes are checked against: the asker's lines of this turn and of the conversation so far.
      const askerWords = async () => [
        ...items.filter((i) => i.msg.author.id === actor.id).map((i) => i.text),
        ...(conversation ? askerLines(await repositories().conversations.latestMessages(runtime.tenantId, conversation.id, { limit: ASKER_ROWS, chatOnly: true }), { guildId: msg.guildId, userId: actor.id }) : []),
      ];
      // In the asker's language when their words show it, else the place's. Its Stop button lets the asker cut the turn short (#351).
      const progressLanguage = shown ?? configuredLanguage(guild, agent);
      const draftPlace = { tenantId: runtime.tenantId, botId, guildId: msg.guildId ?? undefined, channelId, parentChannelId: projectChannelId, userId: actor.id, privateThread: channelId === msg.channelId ? placeOfChannel(msg.channel).privateThread : undefined };
      // The place's open Changelog draft as the turn finds it: what the turn does to it decides what follows (#361).
      const before = (await openDrafts(draftPlace).catch(() => []))[0];
      // A turn that goes on by itself is measured for the progress it makes; a person's turn never is (#357).
      const countTurn = opts.draft && before?.name === opts.draft ? await measureTurn(draftPlace, before.draft).catch(() => null) : null;
      // A turn that goes on by itself starts from the draft alone, not from the conversation, so turn 30 costs about what turn 2 did (#360).
      const fromDraft = !!opts.continued && !!opts.draft;
      const state = fromDraft && before?.name === opts.draft ? await draftState(draftPlace, before.draft).catch(() => null) : null;
      if (state) turn = `${DRAFT_TURN}\n${state}`;
      // Kept across a chain of turns, so a press between two of them still stops the next. Only the asker may press it: the asker of the
      // place's open Changelog draft, else this turn's (#355).
      const asked = before?.startedBy;
      const stopping = stop = opts.stop ?? { askerId: asked?.id ?? actor.id, askerName: asked ? asked.name ?? asked.id : actor.name, stopped: false, language: progressLanguage };
      const stopButton = (id: string) => [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(id).setLabel(textIn(progressLanguage).progress.stop).setStyle(ButtonStyle.Secondary))];
      // Work this process woke, going on from before it (#362), shows at once in the progress message it showed before, or in a new one when
      // that is gone.
      const woken = fromDraft && !opts.progress;
      // The Stop button names the place's open Changelog draft, which keeps where the message is, so the work on it can find both again (#355).
      const post = async (content: string) => {
        const open = (await openDrafts(draftPlace).catch(() => []))[0];
        const id = open ? `${DRAFT_STOP_PREFIX}:${open.name}` : `${STOP_PREFIX}:${crypto.randomUUID()}`;
        this.stops.set(id, stopping);
        const shown = woken && open?.progressMessage?.channelId === target.id && "messages" in target ? await target.messages.fetch(open.progressMessage.messageId).catch(() => null) : null;
        const kept = shown && shown.author.id === botUserId ? await shown.edit({ content, components: stopButton(id) }).catch(() => null) : null;
        const posted = kept ?? await (thread ? thread.send({ content, components: stopButton(id), allowedMentions: { parse: [] } }) : msg.reply({ content, components: stopButton(id), allowedMentions: { parse: [] } }));
        if (open && !kept) await keepProgressMessage(draftPlace, open.draft, { channelId: posted.channelId, messageId: posted.id }).catch(() => {});
        return posted;
      };
      const turnProgress = progress = opts.progress ?? new TurnProgress(post, progressLanguage, opts.playbook?.name);
      // How far an open Changelog draft of this place is, read from the draft itself.
      progress.detail ??= async () => {
        const open = (await openDrafts(draftPlace))[0];
        return open?.left !== undefined && open.changedFiles !== undefined ? textIn(progressLanguage).progress.files(open.examined! + open.setAside!, open.changedFiles) : null;
      };
      if (woken && before?.progressMessage) progress.showNow();
      // A turn that goes on with a paused draft has it worked on again from its first call for it, so a pause later in the turn stands (#361).
      let resuming: Promise<unknown> | undefined;
      const onStep: typeof turnProgress.step = (step) => {
        turnProgress.step(step);
        if (step.type === "tool_call" && before && !isWorkedOn(before) && !stopping.stopped && goesOnWith(before, step.payload)) resuming ??= resumeDraft(draftPlace, before.draft, before.work).catch(() => {});
      };
      // A service the place's draft reads that fails for good ends the turn and pauses the draft (#359).
      const failedForGood = serviceFailures(async () => (await openDrafts(draftPlace).catch(() => []))[0]);
      const output = await agentReActLoop.run({ tenantId: runtime.tenantId, botId, message: turn, images: media.images, onStep, stopRequested: () => stopping.stopped, failedForGood, conversationId: conversation?.id, replyLanguage: language, maxIterations: agent?.settings?.maxReActIterations, ...(fromDraft ? { ephemeral: { history: [], cacheKey: `changelog:${channelId}:${opts.draft}` } } : {}), context: { tenantId: runtime.tenantId, platform: "discord", guildId: msg.guildId || undefined, guildName: msg.guild?.name, channelId, userId: actor.id, userName: actor.name, addressed: direct, follows: !direct && items.some((i) => i.follows), playbook, timezone: configuredTimezone(guild, agent), language: configuredLanguage(guild, agent), answerIn: shown, skillContext: { member: memberAuth(actor.member), discord: adapterFor(runtime, msg.guildId), parentChannelId: projectChannelId, privateThread: channelId === msg.channelId ? placeOfChannel(msg.channel).privateThread : undefined, askerWords } } });
      const notes = [...(output.imagesRejected ? [t.rejected] : []), ...media.notes];
      if (output.imagesRejected && shots.length) await unseeBriefImages(runtime.tenantId, place!, shots.map((s) => s.id)).catch(() => null);
      const briefed = briefTurn(output.toolCallsExecuted);
      let plan: ReplyPlan = briefed?.plan ?? prepareReply(output.reply, { addressed: direct, language });
      if (plan.messages.length || direct) plan = withNotes(plan, notes);
      if (brief?.outsider && plan.messages.length) plan = withNotes(plan, [authorDecidesNote(brief.authorId, language)]);
      // A turn whose model could not be reached is no turn without progress: the model's own rule takes it (#358).
      const work = await this.draftWork(draftPlace, before, output, stopping, resuming, output.failed ? null : countTurn);
      // The turn a service ended has no answer of the model's: the pause names only the service (#359).
      if (output.serviceFailed) plan = { messages: [t.changelogServicePaused(output.serviceFailed.service)] };
      // A turn that asked the draft's asker something answers with the question alone (#356).
      if (work.asked) plan = { messages: [work.asked] };
      // A progress message put up before the turn started its draft names the draft from now on, and the draft keeps where it is (#361).
      const up = work.workedOn && work.draft ? await progress.posted() : null;
      if (up?.id && up.channelId && work.draft && work.draft.progressMessage?.messageId !== up.id) {
        const id = `${DRAFT_STOP_PREFIX}:${work.draft.name}`;
        this.stops.set(id, stopping);
        await up.edit({ components: stopButton(id) }).catch(() => {});
        await keepProgressMessage(draftPlace, work.draft.draft, { channelId: up.channelId, messageId: up.id }).catch(() => {});
      }
      // A draft paused for making no progress says only that, and how to go on (#357).
      if (work.stalled) plan = { messages: [textIn(progressLanguage).changelogNoProgress] };
      // How the turn ended, never the host's failure text nor a turn a service ended (#359): the draft keeps it for its next turn, and a turn
      // that went on by itself leaves only that in the conversation, its steps in the Agent log (#360). A turn that asked ended with its
      // question, which is what it posted and what the reply to it answers (#356), even when the model or a service failed after it.
      const closing = work.asked ?? (output.failed || output.serviceFailed ? null : fromDraft ? closingOf(output.recorded ?? []) : output.reply);
      if (closing && work.draft && !work.ended && (fromDraft || work.wentOn)) await keepClosingSummary(draftPlace, work.draft.draft, closing).catch(() => {});
      const closedIn = fromDraft && closing ? await keepClosingRow(runtime.tenantId, botId, conversation, { channelId, userId: actor.id, parentChannelId: projectChannelId }, closing).catch(() => null) : null;
      if (fromDraft && work.draft) console.info(`[changelog] Went on with ${work.draft.repo} (branch ${work.draft.branch}, draft ${work.draft.name}) in channel ${channelId}: ${stepsOf(output.toolCallsExecuted)}`);
      const continued = opts.continued ?? 0;
      // A turn of the work that could not reach the model is run once more after the tenant's wait, then pauses the draft (#358).
      const own = continued > 0 && !!opts.draft, outage = await this.modelOutage(draftPlace, work, output, own, agent?.settings?.modelRetryWaitSeconds ?? DEFAULT_MODEL_RETRY_WAIT_SECONDS);
      if (outage.paused) {
        Object.assign(work, { workedOn: false, pausedNow: true });
        plan = { messages: [textIn(progressLanguage).modelPaused] };
      }
      // The process keeps the drafts it works on, for the scheduler pass (#362).
      if (work.draft) {
        if (work.workedOn) this.working.set(`${runtime.tenantId}:${channelId}`, { botId, channelId });
        else this.working.delete(`${runtime.tenantId}:${channelId}`);
      }
      // A worked-on Changelog draft goes on after any turn (#361). Other long work goes on by itself when its turn ran out,
      // LONG_CONTINUATIONS times; after that a reply continues it (#289). A turn its asker stopped waits for them.
      const cut = output.outOfBudget === true && !output.stopped && !!playbook && "long" in playbook && !work.ended && !work.pausedNow;
      const again = work.workedOn || (cut && continued < LONG_CONTINUATIONS);
      // The turns of the work post no answer: what they did is stored for the next, and the progress message carries on (#351). A person's
      // turn that did not go on with a worked-on draft, such as a side question, is answered as usual, and the work goes on after it (#361);
      // a turn that went on by itself is never answered while the work goes on, even one that called no tool (#357). A person's turn that
      // could not reach the model is answered as before (#358).
      if (again && (own || (!output.failed && (work.wentOn || !work.workedOn)))) plan = { messages: [] };
      else if (!again) {
        if (cut) plan = withNotes(plan, [t.continueByReply]);
        // The progress message shrinks before the answer goes, so the answer is the newest message and notifies; a pause keeps it, saying so.
        await progress.finish(plan.messages.length > 0, work.pausedNow);
      }
      // The final answer and every pause ping the asker, who may be gone for hours; a reply to the asker's own message needs none (#361).
      const ping = (work.ended || work.pausedNow) && (continued > 0 || actor.id !== stopping.askerId) ? stopping.askerId : null;
      if (ping) plan = withPing(plan, ping);
      if (plan.reaction) await msg.react(plan.reaction).catch(() => {});
      // A file sendFiles built goes with the reply's last message; several go one a message after it, so no upload holds two files' worth.
      const files = outgoingFiles(output.toolCallsExecuted), withLast = files.length === 1 && plan.messages.length ? files.splice(0) : [];
      for (const [i, chunk] of plan.messages.entries()) await send(chunk, i === plan.messages.length - 1 ? withLast : [], i === 0 && ping ? [ping] : undefined);
      for (const file of files) await send("", [file]);
      if (briefed?.written.length && place && target.isSendable()) await showDrafts(runtime.tenantId, target, place, briefed.written);
      if (output.toolCallsExecuted.length && target.isSendable()) {
        // Write actions never run on the model's say-so: each one gets Confirm/Cancel buttons for the person who asked.
        for (const { result } of output.toolCallsExecuted) {
          const p = result.success ? pendingOf(result.data) : null;
          if (p) await target.send(confirmMessage(p, actor.id));
        }
        // A Reminder or Routine set or changed gets the fixed card with every detail, in the asker's language, so they can check it is what they meant.
        for (const { call, result } of output.toolCallsExecuted) {
          const card = result.success ? scheduleCardOf(call.name, result.data, shown ?? configuredLanguage(guild, agent)) : null;
          if (card) await target.send({ embeds: [card], allowedMentions: { parse: [] } });
        }
        await tellAssigneesWhereTasksAre(runtime, botId, { target, guildId: msg.guildId, projectChannelId, language: configuredLanguage(guild, agent) }, assignmentsOf(output.toolCallsExecuted), actor.id);
      }
      for (const f of output.imagesRejected ? [] : images?.filed ?? []) {
        const seen = await describeImage(runtime.tenantId, botId, f.image);
        if (seen) await describeImageInto(runtime.tenantId, f.where, f.path, seen, { complete: botCompletion({ tenantId: runtime.tenantId, botId, language }) }).catch(() => null);
      }
      // Still inside this conversation's serialized job, so the next turn reads the rewritten summary and when this one ran.
      const conversationId = output.conversationId || closedIn;
      if (conversationId) await patchConversationMetadata(runtime.tenantId, conversationId, { lastTurnAt: new Date(now()).toISOString() }).catch(() => {});
      if (!playbook && output.conversationId) await rollSummary({ tenantId: runtime.tenantId, botId, conversationId: output.conversationId, windowOffset: output.historyOffset }).catch(() => {});
      if (again) {
        handedOver = true;
        // Taken now, so a person's turn that runs before this one is seen as having come between.
        const next = { ...opts, continued: continued + 1, answerIn: shown ?? undefined, progress, stop, draft: work.workedOn ? work.draft?.name : undefined }, heard = this.heard.get(convKey) ?? 0;
        const asker = work.draft?.startedBy ? { id: work.draft.startedBy.id, name: work.draft.startedBy.name ?? work.draft.startedBy.id } : { id: actor.id, name: actor.name };
        const goOn = () => { void this.serialize(convKey, () => this.goOn(runtime, botId, { channelId, asker }, next, heard)).catch(() => {}); };
        // A pending model retry runs when its time comes (#358). A bot that stops first leaves it, and after its start a scheduler pass
        // runs it, the time kept in the draft (#362).
        if (outage.retryAt !== undefined && outage.retryAt > now()) {
          const waiting = { leave: () => { cancel(); this.retries.delete(convKey); this.dropStop(stop); progress?.leave(); } };
          this.retries.set(convKey, waiting);
          const cancel = atClock(outage.retryAt, () => { if (this.retries.get(convKey) !== waiting) return; this.retries.delete(convKey); goOn(); });
        } else goOn();
      }
    } catch (error) {
      const failure = failureOf(error);
      console.error(`[turn] tenant ${runtime.tenantId} bot ${botId} channel ${channelId} failed: ${failure.error}: ${failure.message}`);
      await audit({ tenantId: runtime.tenantId, botId }, "turn_failed", { channelId, ...failure });
      await progress?.finish(true);
      await send(t.failed).catch(() => {});
    } finally {
      if (!handedOver) { await progress?.finish(false); this.dropStop(stop); }
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
