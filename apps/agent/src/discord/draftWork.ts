import type { Client, Message } from "discord.js";
import { repositories } from "@pachiware/db";
import {
  atClock, awaitModelRetry, boundPlaybook, configuredLanguage, elapsed, goesOnWith, isWorkedOn, measureTurn, modelAnswered, now, openDrafts, pauseDraft,
  retryTime, textIn, workedOnPlaces, type FailedForGood, type Language, type OpenDraft, type Playbook, type PlaybookBinding,
} from "@pachiware/skills";
import type { ButtonLike } from "./gitConfirm.js";
import type { TurnProgress } from "./progress.js";
import { placeOfChannel } from "./routing.js";
import { loadGuildSettings } from "../loop/prompt.js";
import type { ModelFailure } from "../llm/types.js";

/**
 * The work on worked-on Changelog drafts in one agent process (ADR 0025): what a turn left of its place's draft, how the work is handed on
 * from turn to turn, waits on a model retry, is woken after a restart and on each scheduler pass, and is stopped. The Discord bot manager
 * runs the turns; this keeps track of the work between them.
 */

/**
 * The Stop button on a turn's progress message: `changelogstop:<draft name>` names the place's open Changelog draft, so it can be found
 * from the draft again (#355); other work's is `turnstop:<id>` (#351).
 */
export const STOP_PREFIX = "turnstop", DRAFT_STOP_PREFIX = "changelogstop";
export const isStopButton = (id: string) => id.startsWith(`${STOP_PREFIX}:`) || id.startsWith(`${DRAFT_STOP_PREFIX}:`);
export const draftStopId = (name: string) => `${DRAFT_STOP_PREFIX}:${name}`;
/** What a Stop button stops: the turns of one piece of work, which only its asker may cut short. */
export type StopEntry = { askerId: string; askerName: string; stopped: boolean; language?: Language };
/** Whom work that goes on by itself is for: a Changelog draft's asker, else the person whose turn started it. */
export type Asker = { id: string; name: string };
/** The asker a draft names, by its starter's name, or id when it kept none. */
export const askerOf = (startedBy: { id: string; name?: string }): Asker => ({ id: startedBy.id, name: startedBy.name ?? startedBy.id });
/**
 * What a turn hands on to the turn that goes on by itself after it: how many went on before, the progress message and Stop it carries, and,
 * for a worked-on Changelog draft, the draft's name and the hand-over it was queued by, which a later hand-over replaces (#361).
 */
export type HandOver = { continued?: number; progress?: TurnProgress; stop?: StopEntry; draft?: string; chain?: object };
/** The work on a place's Changelog draft handed on to a turn that has not started yet, with the progress message and Stop it carries. */
type Chain = { token: object; progress?: TurnProgress; stop?: StopEntry };

/** Who works where: the channel or thread a turn finds its Changelog draft in, and the person it acts for. */
export type WorkPlace = Parameters<typeof openDrafts>[0];
export const workPlaceOf = (tenantId: string, botId: string, channel: Message["channel"], userId: string): WorkPlace =>
  ({ tenantId, botId, guildId: "guildId" in channel ? channel.guildId ?? undefined : undefined, ...placeOfChannel(channel), userId });
/** The place's open Changelog draft, if any; a place holds at most one. */
export const openDraftOf = async (place: WorkPlace) => (await openDrafts(place).catch(() => []))[0];
/** The place's open Changelog draft of that name, if it is still open. */
export const openDraftNamed = async (place: WorkPlace, name: string | undefined) => (await openDrafts(place).catch(() => [])).find((d) => d.name === name);

type Executed = { call: { name: string; arguments?: unknown }; result: { success: boolean } };

/**
 * What a turn left of its place's Changelog draft (#361): whether the draft is worked on, so the work goes on by itself, and whether the
 * turn went on with it, paused it or ended it, a draft it started and ended within the turn included. A Stop its asker pressed pauses a
 * draft still worked on, such as one the turn started after its Stop button went up. A turn that went on by itself is counted
 * (`countTurn`), and its draft pauses when it is the second in a row to add nothing (`stalled`, #357). `asked` is the question the turn
 * paused it with, through askChangelogAsker (#356); a draft so paused is no longer worked on, so that turn is not counted. `ownWork` says
 * the turn went on with the draft by itself.
 */
export async function turnOutcome(place: WorkPlace, before: OpenDraft | undefined, output: { toolCallsExecuted: Executed[]; serviceFailed?: FailedForGood }, stop: StopEntry, ownWork: boolean, resuming?: Promise<unknown>, countTurn?: (() => Promise<boolean>) | null) {
  await resuming;
  let after = await openDraftOf(place), pausedHere = false;
  const paused = async (pausing: Promise<boolean>) => {
    if (!await pausing.catch(() => false)) return;
    pausedHere = true;
    after = await openDraftOf(place);
  };
  if (after && stop.stopped && isWorkedOn(after)) await paused(pauseDraft(place, after.draft, { reason: "stopped" }));
  // A service it reads that failed for good pauses it, naming the service; the host, status, error, tool and file are the console's (#359).
  const failed = output.serviceFailed;
  if (after && failed && isWorkedOn(after)) await paused(pauseDraft(place, after.draft, { reason: "service", service: failed.service }, { host: failed.host, ...(failed.status ? { status: failed.status } : {}), error: failed.error, tool: failed.tool, ...(failed.file ? { file: failed.file } : {}) }));
  const ended = before ? after?.name !== before.name : !after && output.toolCallsExecuted.some(({ call, result }) => call.name === "startChangelog" && result.success);
  const stalled = !!after && !ended && isWorkedOn(after) && !!countTurn && await countTurn().catch(() => false);
  if (stalled) { pausedHere = true; after = await openDraftOf(place); }
  const draft = after ?? before, workedOn = !!after && isWorkedOn(after);
  const wentOn = !!draft && output.toolCallsExecuted.some(({ call }) => goesOnWith(draft, call));
  // Paused by this turn: one it went on with or paused itself, or the work's own whose Stop was pressed meanwhile; a person's Stop on a
  // draft nobody works on pauses nothing.
  const pausedNow = !!after && !workedOn && (wentOn || pausedHere || (stop.stopped && (ownWork || (!!before && isWorkedOn(before)))));
  const pause = after?.work?.state === "paused" ? after.work : undefined;
  const asked = pausedNow && pause?.reason === "question" && output.toolCallsExecuted.some(({ call }) => call.name === "askChangelogAsker") ? pause.question : undefined;
  return { draft, wentOn, workedOn, ended, stalled, pausedNow, asked };
}

/**
 * What a turn's model failure does to its place's worked-on Changelog draft (#358). A turn that went on by itself (`wentOnByItself`) and
 * could not reach the model has the same continuation run once more after the tenant's wait, the time kept in the draft; failing with a
 * retry already pending, or with a wait of 0, it pauses the draft for "model". A person's turn that fails changes nothing, and the work
 * goes on after it, at the pending retry's time when one waits. A turn the model answered clears a pending retry. `retryAt` is when the
 * work goes on, if not at once.
 */
export async function modelOutage(place: WorkPlace, work: { draft?: OpenDraft; workedOn: boolean }, output: { failed?: true; failure?: ModelFailure }, wentOnByItself: boolean, waitSeconds: number): Promise<{ retryAt?: number; paused?: boolean }> {
  if (!work.draft || !work.workedOn) return {};
  const pending = retryTime(work.draft);
  if (!output.failed) {
    if (pending !== undefined) await modelAnswered(place, work.draft.draft).catch(() => {});
    return {};
  }
  if (!wentOnByItself) return pending !== undefined ? { retryAt: pending } : {};
  if (pending === undefined && waitSeconds > 0) {
    const retryAt = now() + waitSeconds * 1000;
    if (await awaitModelRetry(place, work.draft.draft, retryAt).catch(() => false)) return { retryAt };
  }
  return { paused: await pauseDraft(place, work.draft.draft, { reason: "model" }, { ...output.failure }).catch(() => false) };
}

/** Who may stop a draft's work that no turn of this process holds: its asker, told off in the place's language. */
export async function askersStop(tenantId: string, botId: string, guildId: string | null | undefined, asker: { id: string; name?: string }): Promise<StopEntry> {
  const guild = guildId ? await loadGuildSettings(tenantId, botId, guildId) : null, { id, name } = askerOf(asker);
  return { askerId: id, askerName: name, stopped: false, language: configuredLanguage(guild, await repositories().agentConfig.get(tenantId)) };
}

/** A bot as the work on its drafts needs it: its gateway client, its tenant, and the guilds it serves (none listed: all it is in). */
type Bot = { client: Client; tenantId: string; guildIds: string[] };
/** What the manager does for the work: queues a turn that goes on by itself, behind what the place's queue holds. */
type GoOn<B> = (bot: B, botId: string, at: { channelId: string; asker: Asker }, opts: HandOver & { playbook?: Playbook; binding?: PlaybookBinding }) => void;

/** `B` is the manager's own record of a running bot, handed back to it with each turn it queues. */
export class DraftWork<B extends Bot> {
  /**
   * The worked-on Changelog drafts this process works on, by tenant and place, with the bot that works each: found when a bot starts, and
   * kept by every turn that leaves one worked on, so a scheduler pass finds one whose work stopped going on (#362).
   */
  private working = new Map<string, { botId: string; channelId: string }>();
  /** Turns of this process waiting on a model retry, by conversation; a bot that stops leaves them to its next start (#358, #362). */
  private retries = new Map<string, { leave(): void }>();
  /**
   * The work on a Changelog draft handed on and not started yet, by conversation: a person's turn that runs before it hands the work on
   * with the same progress message and Stop, and the hand-over it replaced gives way. One that no later turn replaced goes on.
   */
  private chains = new Map<string, Chain>();

  /** `queued` gives the conversations whose turn runs or waits in the manager's queue, any bot's. */
  constructor(private readonly queued: () => Iterable<string>) {}

  /** Whether a turn of the place runs or waits in line, any bot's; with `retrying`, a turn of this process waiting on a model retry too. */
  private busy(channelId: string, retrying = true) {
    const ofPlace = (key: string) => key.startsWith("conv:") && key.endsWith(`:${channelId}`);
    return [...this.queued()].some(ofPlace) || (retrying && [...this.retries.keys()].some(ofPlace));
  }

  /** Keeps whether this process works on a place's draft after a turn there, for the scheduler pass (#362). */
  keep(tenantId: string, channelId: string, botId: string, workedOn: boolean) {
    if (workedOn) this.working.set(`${tenantId}:${channelId}`, { botId, channelId });
    else this.working.delete(`${tenantId}:${channelId}`);
  }

  /** A bot that stops works on no draft of this process: its turns waiting on a retry go, and its next start finds its drafts again (#362). */
  forget(botId: string) {
    for (const [key, waiting] of [...this.retries]) if (key.startsWith(`conv:${botId}:`)) waiting.leave();
    for (const [key, work] of [...this.working]) if (work.botId === botId) this.working.delete(key);
    for (const key of [...this.chains.keys()]) if (key.startsWith(`conv:${botId}:`)) this.chains.delete(key);
  }

  /** Whether a turn's progress message is the work's: not when the work, handed on and waiting behind that turn, carries its own (#361). */
  carries(convKey: string, progress: TurnProgress | undefined) {
    const pending = this.chains.get(convKey);
    return !pending?.progress || pending.progress === progress;
  }

  /** What a turn that hands the work on passes on: the progress message and Stop of work handed on before it and still waiting, else its own. */
  carried(convKey: string, own: { progress?: TurnProgress; stop?: StopEntry }) {
    const pending = this.chains.get(convKey);
    return { progress: pending?.progress ?? own.progress, stop: pending?.stop ?? own.stop };
  }

  /**
   * Hands the work on: `run` queues the turn that goes on by itself, now or at a pending model retry's time (#358). A bot that stops first
   * leaves that retry, and after its start a scheduler pass runs it, the time kept in the draft (#362). The work on a draft is handed on
   * afresh: whatever hand-over waited before this one gives way to it (#361). `dropStop` forgets a Stop button of work that will not go on.
   */
  handOn(convKey: string, next: HandOver, retryAt: number | undefined, run: () => void, dropStop: (stop: StopEntry | undefined) => void) {
    if (next.draft) {
      const chain: Chain = { token: {}, progress: next.progress, stop: next.stop };
      this.chains.set(convKey, chain);
      next.chain = chain.token;
    }
    if (retryAt === undefined || retryAt <= now()) { run(); return; }
    const waiting = {
      leave: () => {
        cancel();
        this.retries.delete(convKey);
        if (next.chain && this.chains.get(convKey)?.token === next.chain) this.chains.delete(convKey);
        dropStop(next.stop);
        next.progress?.leave();
      },
    };
    this.retries.set(convKey, waiting);
    const cancel = atClock(retryAt, () => { if (this.retries.get(convKey) !== waiting) return; this.retries.delete(convKey); run(); });
  }

  /**
   * Whether a turn that goes on with a draft by itself was replaced by a later hand-over (#361): it gives way, and what it carried that the
   * later one does not carry goes with it.
   */
  replaced(convKey: string, opts: HandOver, dropStop: (stop: StopEntry | undefined) => void) {
    const chain = this.chains.get(convKey);
    if (chain?.token === opts.chain) return false;
    if (chain?.progress !== opts.progress) opts.progress?.leave();
    if (chain?.stop !== opts.stop) dropStop(opts.stop);
    return true;
  }

  /** The turn handed the work on starts: no later turn replaces it any more. */
  started(convKey: string) { this.chains.delete(convKey); }

  /**
   * When a bot is ready, every worked-on Changelog draft in the guilds it serves goes on by itself (#362): the drafts say they are worked
   * on, so a restart costs their askers no "lanjut".
   */
  async wakeOnStart(bot: B, botId: string, goOn: GoOn<B>) {
    const served = [...bot.client.guilds.cache.keys()].filter((g) => !bot.guildIds.length || bot.guildIds.includes(g));
    for (const guildId of served) {
      for (const channelId of await workedOnPlaces(bot.tenantId, guildId).catch(() => [])) await this.wake(bot, botId, channelId, goOn).catch(() => {});
    }
  }

  /**
   * A scheduler pass's part in the work on Changelog drafts (#362): each draft this process works on goes on when no turn of its place
   * runs or waits, and one waiting on a model retry goes on once its time came. `botOf` gives a running, connected bot.
   */
  async wakeAll(botOf: (botId: string) => B | null, goOn: GoOn<B>) {
    for (const { botId, channelId } of [...this.working.values()]) {
      const bot = botOf(botId);
      if (bot) await this.wake(bot, botId, channelId, goOn).catch(() => {});
    }
  }

  /**
   * Has the worked-on Changelog draft of a place go on by itself, with a turn addressed by its place and asker (#362). It waits while a turn
   * of the place runs or waits, which goes on with the draft already, and until a pending model retry's time; a paused or ended draft is
   * not woken, nor one without an asker to act as. Reading the place drops a draft left untouched too long, so that one is never woken.
   * A playbook thread's draft goes on only with the thread's bot, any other with the bot of the tenant that found it first.
   */
  private async wake(bot: B, botId: string, channelId: string, goOn: GoOn<B>) {
    const key = `${bot.tenantId}:${channelId}`, claimed = this.working.get(key);
    if (claimed && claimed.botId !== botId) return;
    const fetched = await bot.client.channels.fetch(channelId).catch(() => null);
    const channel = fetched?.isSendable() ? fetched : null;
    if (!channel) return;
    const thread = channel.isThread() ? channel : null;
    const bound = thread?.parentId ? await boundPlaybook(bot.tenantId, { guildId: thread.guildId, channelId: thread.parentId, threadId: thread.id }).catch(() => null) : null;
    if (bound?.binding.botId && bound.binding.botId !== botId) return;
    const draft = await openDraftOf(workPlaceOf(bot.tenantId, botId, channel, bot.client.user?.id ?? ""));
    if (!draft || !isWorkedOn(draft) || !draft.startedBy) {
      if (claimed) this.working.delete(key);
      return;
    }
    this.working.set(key, { botId, channelId });
    const retryAt = retryTime(draft);
    if ((retryAt !== undefined && retryAt > now()) || this.busy(channelId)) return;
    const chain: Chain = { token: {} };
    this.chains.set(`conv:${botId}:${channelId}`, chain);
    goOn(bot, botId, { channelId, asker: askerOf(draft.startedBy) }, { continued: 1, draft: draft.name, chain: chain.token, ...(bound?.playbook ? { playbook: bound.playbook, binding: bound.binding } : {}) });
  }

  /**
   * A turn that went on with a worked-on draft by itself and failed (#362): it counts as a turn without progress unless it added something
   * before it failed (#357), so the second such turn in a row pauses the draft with one line that pings its asker, and the work never fails
   * over and over. Otherwise the work goes on. `turn.count` is the turn's own count when it made one, and `turn.counted` says it was used
   * already. A failure no count can be kept for leaves the work to a later scheduler pass, its progress message as it is.
   */
  async failed(place: WorkPlace, opts: HandOver, turn: { progress?: TurnProgress; stop?: StopEntry; count: (() => Promise<boolean>) | null; counted: boolean }, handOn: (next: HandOver, asker: Asker) => void, say: (line: string, askerId: string) => Promise<unknown>, language: Language) {
    const open = await openDraftNamed(place, opts.draft);
    if (!open?.startedBy || !isWorkedOn(open)) { await turn.progress?.finish(false, !!open && !isWorkedOn(open)); return; }
    const count = turn.counted ? null : turn.count ?? await measureTurn(place, open.draft).catch(() => null);
    const stalled = count ? await count().catch(() => null) : turn.counted ? false : null;
    if (stalled === null) { turn.progress?.leave(); return; }
    if (stalled) {
      this.keep(place.tenantId, place.channelId ?? "", place.botId ?? "", false);
      await turn.progress?.finish(true, true);
      await say(textIn(turn.stop?.language ?? language).changelogNoProgress, open.startedBy.id).catch(() => {});
      return;
    }
    handOn({ ...opts, continued: (opts.continued ?? 0) + 1, progress: turn.progress, stop: turn.stop }, askerOf(open.startedBy));
  }

  /**
   * The draft a Stop button names, when it is still open in the place the button was pressed in: the place, as its asker presses it, and
   * the draft.
   */
  async stopTarget(tenantId: string, botId: string, i: ButtonLike & { channel?: Message["channel"] | null }) {
    const name = i.customId.startsWith(`${DRAFT_STOP_PREFIX}:`) ? i.customId.slice(DRAFT_STOP_PREFIX.length + 1) : null;
    const place = name && i.channel ? workPlaceOf(tenantId, botId, i.channel, i.user.id) : null;
    const open = place ? await openDraftNamed(place, name!) : undefined;
    return place && open ? { place, open } : null;
  }

  /**
   * Its asker's Stop on a draft's progress message pauses the draft there and then, whatever turn runs in its place (#361). With no turn of
   * the place running or waiting in line to say so, as while a model retry waits, the progress message says the draft paused, and a retry
   * this process waits on never runs (#362).
   */
  async stop(botId: string, i: ButtonLike & { message?: { createdTimestamp?: number } }, target: { place: WorkPlace; open: OpenDraft }, entry: StopEntry) {
    await pauseDraft(target.place, target.open.draft, { reason: "stopped" }).catch(() => {});
    if (this.busy(target.place.channelId ?? "", false)) { await i.update({ components: [] }); return; }
    this.retries.get(`conv:${botId}:${target.place.channelId}`)?.leave();
    const shown = i.message?.createdTimestamp;
    await i.update({ content: `-# ${textIn(entry.language).progress.paused(elapsed(shown ? now() - shown : 0, entry.language))}`, components: [] });
  }
}
