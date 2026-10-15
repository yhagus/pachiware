/**
 * Discord scenario harness: the real bot manager and agent loop behind a fake discord.js client.
 *
 *   discordScenario("name", async (s) => {
 *     s.model.script({ tool: "repoList", args: {} }, (turn) => `saw ${turn.toolResults[0].items.length}`, { error: "Provider request failed" });
 *     s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api" }]);
 *     await s.git({ repos: ["acme/*"] });
 *     const msg = await s.discord.send(`${s.discord.mention} list repos`);
 *     await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
 *     await s.discord.contextMenu("Draft issues", msg);
 *     await s.discord.slash("issue-draft", { text: "login loops on Safari", file: attachment(s, "log.txt", bytes) });
 *     expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes.md")).toContain("...");
 *     const [first] = s.discord.history([{ content: "said an hour ago", at: Date.now() - 3600_000 }]);
 *     s.discord.deny("channel-1", s.discord.bob.id, ["ReadMessageHistory"]);
 *     s.discord.hide("channel-2"); // @everyone cannot view it: not a Public channel
 *     s.discord.grant(s.discord.alice, ["ManageGuild"]);
 *     const helper = await s.discord.addBot(); // a second bot of the tenant in the same guild
 *   });
 *
 * Each scenario runs in its own `bun test` subprocess with a fresh SQLite database and Workspace folder, so
 * `mock.module("discord.js")` and the stubbed `fetch` never leak. The callback must not close over variables
 * from the test file. Every `send`, `click`, and `contextMenu` returns after the bot has finished handling it.
 * An unscripted model call or an unstubbed request fails the scenario.
 * Defaults: guild "guild-1", channel "channel-1", author `s.discord.alice`; the bot's user id is "bot-user".
 * Live evals (`*.eval.ts`) call `s.model.live()` to answer with the bot's real profile, and `s.http.passthrough(...)` for its provider.
 */
import { expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChatMessage, LLMResponse } from "../../src/llm/types";

const ROOT = resolve(import.meta.dir, "../../../..");
const SELECTED = process.env.PACHIWARE_SCENARIO;

/** What the model step functions see: the request so far, plus the parsed results of this turn's tool calls. */
export type ModelTurn = { messages: ChatMessage[]; toolResults: any[] };
export type ToolCallStep = { tool: string; args?: Record<string, unknown> };
/** The provider failed: the router's fallback answer, as a real outage would produce. */
export type ErrorStep = { error: string };
/** A function step may be async, to change state while the model call is in flight. */
export type ModelStep = string | ToolCallStep | ToolCallStep[] | ErrorStep | ((turn: ModelTurn) => ModelStep | Promise<ModelStep>);
export type HttpRequest = { method: string; url: string; body: any };

export type Payload = { content?: string; embeds?: any[]; components?: any[]; files?: any[] };
/** `name` is the display name; `username` defaults to it. */
export type FakeUser = { id: string; name: string; username?: string };
export interface FakeMessage {
  id: string; channelId: string; guildId: string | null; author: FakeUser & { bot: boolean }; readonly url: string;
  content: string; embeds: any[]; components: any[]; files: any[];
  /** As the bot sent it; absent when it posted a plain string. */ allowedMentions?: { parse?: string[]; users?: string[] };
  reactions: string[]; edits: Payload[]; reference?: { messageId: string }; thread?: FakeChannel; pinned: boolean;
}
export interface FakeChannel { id: string; guildId: string | null; parentId: string | null; ownerId: string | null; name: string; messages: FakeMessage[]; /** History reads (one per `messages.fetch` page). */ fetches: number }
/** `guild` places a channel in a guild the bot joined with `joinGuild`; the default is "guild-1". */
export type ChannelOptions = { thread?: boolean; parentId?: string; ownerId?: string; dm?: boolean; private?: boolean; members?: string[]; guild?: string };
/** A message written before the bot was listening; `at` is its creation time in ms. */
export type PastMessage = { content: string; author?: FakeUser & { bot?: boolean }; at?: number; attachments?: any[] };
/** A button click or context-menu command as the bot received it, with every response it made. */
export interface FakeInteraction { responses: { kind: "reply" | "update" | "deferReply" | "deferUpdate" | "editReply" | "followUp"; payload: any }[] }
/** Another bot of the scenario's tenant, running in the same guild beside the default one. */
export interface FakeBot { id: string; botUserId: string; mention: string; messages: FakeMessage[]; readonly registeredCommands: any[] }

export interface Scenario {
  tenant: { id: string };
  bot: { id: string };
  db: any;
  /** `live()` hands every later model call to the real router instead of the script. */
  model: { script(...steps: ModelStep[]): void; calls: ChatMessage[][]; /** Tool names offered on each call. */ tools: string[][]; live(): void };
  /** `passthrough` sends matching requests to the network. */
  http: { on(match: string | RegExp, respond: (req: HttpRequest) => unknown): void; passthrough(match: string | RegExp): void; requests: HttpRequest[] };
  /** Attaches a git account to the bot and opens these repositories in the guild. */
  git(options?: { provider?: "github" | "gitlab"; repos?: string[] }): Promise<{ id: string }>;
  /** Saves guild settings as the console does, Digest schedule rows included. */
  guildSettings(input: { systemPrompt?: string | null; useThreads?: boolean; alwaysChannelIds?: string[]; timezone?: string | null; language?: "id" | "en" | null; digestChannels?: { channelId: string; hour: number }[] }): Promise<void>;
  /** The clock the time context, task dates and the scheduler read. `set` pins it (ms, Date, or ISO text); `advance` moves it forward. */
  clock: { set(at: number | string | Date): void; advance(ms: number): void; now(): number };
  /** One scheduler pass at the fake clock's time, as the agent's minute loop would run it; returns once every post has landed. */
  scheduler: { tick(): Promise<void> };
  /** Writes an availability rule as the admin API does and returns once commands are re-registered; `botId` defaults to this bot and the guild to "guild-1". */
  availability(at: { level: "tenant" | "bot" | "guild" | "channel"; botId?: string; guildId?: string; channelId?: string }, rule: { kind: string; name: string; value: string }): Promise<void>;
  /** Paths are tenant-relative, e.g. "guilds/guild-1/channels/channel-1/brief.md". */
  workspace: { read(path: string): Promise<string | null>; write(path: string, content: string): Promise<void>; list(path: string): Promise<string[]> };
  discord: {
    mention: string; botUserId: string; guildId: string; alice: FakeUser; bob: FakeUser;
    botMessages: FakeMessage[];
    /** The commands the bot last registered in the default guild, as JSON. */
    readonly registeredCommands: any[];
    /** Every bulk overwrite the bot sent, oldest first; `guildId` is null for the global list. */
    readonly commandOverwrites: { guildId: string | null; commands: any[] }[];
    /** The commands the bot last registered in this guild, or null when it sent none there. */
    commandsIn(guildId: string): any[] | null;
    /**
     * The bot joins another guild, as when someone invites it; `setUp: false` leaves it out of the guilds the bot is set up for.
     * With `members`, only they (and whoever later posts there) are in it: Discord says "Unknown Member" for anyone else. Without, everyone is.
     */
    joinGuild(id: string, name?: string, options?: { setUp?: boolean; members?: FakeUser[] }): Promise<void>;
    /** Discord refuses (or, with false, accepts again) the bot's command overwrites in a guild. */
    refuseCommands(guildId: string, refused?: boolean): void;
    /** A private thread admits only the bot plus `members`. */
    channel(id: string, options?: ChannelOptions): FakeChannel;
    /** Adds messages to a channel's history without the bot seeing them arrive, oldest first. */
    history(messages: PastMessage[], options?: { channel?: FakeChannel | string }): FakeMessage[];
    /** Takes permissions (names such as "ReadMessageHistory") from a user or the bot in a channel; a thread also inherits its parent's. */
    deny(channel: FakeChannel | string, userId: string, permissions: string[]): void;
    /** Takes View Channel from the guild's @everyone role in a channel, so it is no Public channel; members keep seeing it unless denied too. */
    hide(channel: FakeChannel | string): void;
    /** Gives a user guild permissions (discord.js names such as "ManageGuild", "ManageMessages", "Administrator"); every user starts with none. */
    grant(user: FakeUser | string, permissions: string[]): void;
    send(content: string, options?: { author?: FakeUser; channel?: FakeChannel | string; replyTo?: FakeMessage; attachments?: any[] }): Promise<FakeMessage>;
    /** Sends several messages back to back, as a person pasting one long text in parts does; in a shared channel the bot joins them into one turn after the pause. */
    burst(contents: string[], options?: { author?: FakeUser; channel?: FakeChannel | string }): Promise<FakeMessage[]>;
    /** Lifts the ten-messages-a-minute limit for a user, so a scenario can hold a long conversation. */
    unlimited(user: FakeUser): void;
    /** Clicks the button whose label or custom id matches. */
    click(message: FakeMessage, button: string, options?: { user?: FakeUser }): Promise<FakeInteraction>;
    contextMenu(commandName: string, target: FakeMessage, options?: { user?: FakeUser }): Promise<FakeInteraction>;
    /** Runs a slash command with its `text` and `file` options; Discord offers only the commands registered in the guild, so it must be one. */
    slash(commandName: string, options?: { text?: string; file?: any; user?: FakeUser; channel?: FakeChannel | string }): Promise<FakeInteraction>;
    /** Starts another bot of the tenant in the guild; every later `send` reaches both bots. Clicks and commands still go to the default bot. */
    addBot(options?: { name?: string }): Promise<FakeBot>;
  };
  settle(): Promise<void>;
  /** Stops and starts the bot again, as a process restart would; Workspace and database state stay. */
  restart(): Promise<void>;
}

/** Registers a test that runs `body` against a fresh bot in a subprocess. */
export function discordScenario(name: string, body: (s: Scenario) => Promise<void>, timeout = 20000) {
  if (SELECTED === undefined) { const file = callerFile(); test(name, () => runInSubprocess(file, name), timeout); return; }
  if (SELECTED === name) test(name, async () => {
    const s = await createScenario();
    try { await body(s); await s.settle(); } finally { await s.close(); }
  }, timeout);
}

function callerFile() {
  const frame = new Error().stack!.split("\n").map((line) => /(\/[^\s()]+\.(?:test|eval)\.ts)\b/.exec(line)?.[1]).find(Boolean);
  if (!frame) throw new Error("discordScenario must be called from a *.test.ts or *.eval.ts file");
  return frame;
}

function runInSubprocess(file: string, name: string) {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-scenario-"));
  try {
    const run = Bun.spawnSync({
      cmd: ["bun", "test", file, "-t", name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")],
      cwd: ROOT,
      env: { ...process.env, PACHIWARE_SCENARIO: name, DATABASE_URL: `sqlite:${join(dir, "scenario.db")}`, WORKSPACE_DIR: join(dir, "workspace"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), PLATFORM_ADMIN_KEY: "scenario", NODE_ENV: "test" },
    });
    const output = new TextDecoder().decode(run.stderr) + new TextDecoder().decode(run.stdout);
    expect(run.exitCode, output).toBe(0);
    expect(output, "the scenario did not run").toMatch(/\b1 pass\b/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const json = (value: unknown) => (value && typeof (value as any).toJSON === "function" ? (value as any).toJSON() : value);
const normalize = (payload: string | Payload): Required<Payload> => {
  const p = typeof payload === "string" ? { content: payload } : payload;
  return { content: p.content ?? "", embeds: (p.embeds ?? []).map(json), components: (p.components ?? []).map(json), files: p.files ?? [] };
};
const unwrapTool = (content: ChatMessage["content"]) => {
  const text = (typeof content === "string" ? content : "").replace(/<\/?untrusted_data[^>]*>/g, "").trim();
  try { return JSON.parse(text); } catch { return text; }
};

async function createScenario(): Promise<Scenario & { close(): Promise<void> }> {
  const discordjs = { ...(await import("discord.js")) };
  const { Collection, Events, ApplicationCommandType, ChannelType, PermissionsBitField } = discordjs;
  const failures: string[] = [];
  const fail = (message: string) => { failures.push(message); return new Error(message); };

  const BOT_USER = { id: "bot-user", name: "Pachiware", bot: true };
  const alice = { id: "user-alice", name: "Alice" }, bob = { id: "user-bob", name: "Bob" };
  // Each guild's known people: its starting members plus everyone who has posted there, what its member search can find.
  // A guild made without a member list (guild-1 included) treats anyone else as a member too; one with a list does not.
  const membersOf = new Map<string, Map<string, FakeUser>>();
  const guilds = new Map<string, any>();
  const makeGuild = (id: string, name: string, list?: FakeUser[]) => {
    // Discord gives a guild's @everyone role the guild's own id.
    const guild: any = { id, name, roles: { everyone: { id } } }, known = new Map<string, FakeUser>((list ?? [alice, bob]).map((u) => [u.id, u]));
    const member = (u: FakeUser) => ({ id: u.id, user: { id: u.id, username: u.username ?? u.name }, guild, displayName: u.name, roles: { cache: new Collection() } });
    guild.members = {
      fetch: async (userId: string) => { const u = known.get(userId); if (!u && list) throw new Error("Unknown Member"); return member(u ?? { id: userId, name: userId }); },
      search: async ({ query, limit = 1 }: { query: string; limit?: number }) => new Collection([...known.values()].filter((u) => [u.name, u.username ?? u.name].some((n) => n.toLowerCase().startsWith(query.toLowerCase()))).slice(0, limit).map((u) => [u.id, member(u)] as [string, any])),
    };
    membersOf.set(id, known);
    guilds.set(id, guild);
    return guild;
  };
  const GUILD = makeGuild("guild-1", "Acme");
  let nextId = 1000n;
  const snowflake = () => String(nextId++);
  const channels = new Map<string, any>();
  const botMessages: FakeMessage[] = [];
  // Messages each bot user posted, by user id; the default bot's are `botMessages`.
  const postedBy = new Map<string, FakeMessage[]>([[BOT_USER.id, botMessages]]);
  const botUsers = new Map<string, FakeUser & { bot: boolean }>([["scenario-token", BOT_USER]]);
  // Bulk command overwrites each bot user sent, by user id; the default bot's are `overwrites`.
  const overwrites: { guildId: string | null; commands: any[] }[] = [];
  const overwritesBy = new Map<string, { guildId: string | null; commands: any[] }[]>([[BOT_USER.id, overwrites]]);
  const overwritesOf = (userId: string) => overwritesBy.get(userId) ?? overwritesBy.set(userId, []).get(userId)!;
  const commandsIn = (guildId: string, userId = BOT_USER.id) => overwritesOf(userId).findLast((o) => o.guildId === guildId)?.commands ?? null;
  // Every bot user starts with a global menu command an older version registered.
  const globalOf = (userId: string) => overwritesOf(userId).findLast((o) => o.guildId === null)?.commands ?? [{ name: "Draft issues", type: 3 }];
  const refusedGuilds = new Set<string>();

  const denied = new Map<string, Map<string, string[]>>();
  const granted = new Map<string, string[]>();
  const memberOf = (user: FakeUser) => ({ displayName: user.name, roles: { cache: new Collection() }, permissions: { toArray: () => granted.get(user.id) ?? [] } });
  const deniedIn = (channel: any, userId: string): string[] => [...(denied.get(channel.id)?.get(userId) ?? []), ...(channel.parentId ? deniedIn(channels.get(channel.parentId) ?? { id: channel.parentId }, userId) : [])];
  const makeChannel = (id: string, o: ChannelOptions = {}) => {
    if (channels.has(id)) return channels.get(id);
    const guild = o.dm ? null : guilds.get(o.guild ?? GUILD.id);
    if (guild === undefined) throw new Error(`No guild "${o.guild}": joinGuild it first`);
    const channel: any = {
      id, name: id, guildId: guild?.id ?? null, guild, parentId: o.thread ? o.parentId ?? "channel-1" : null, ownerId: o.ownerId ?? null,
      type: o.dm ? ChannelType.DM : o.thread ? (o.private ? ChannelType.PrivateThread : ChannelType.PublicThread) : ChannelType.GuildText,
      messages: [] as FakeMessage[], fetches: 0,
      permissionsFor: (who: string | { id: string }) => new PermissionsBitField(PermissionsBitField.All).remove("Administrator", ...(deniedIn(channel, typeof who === "string" ? who : who.id) as any[])),
      members: { fetch: async (userId: string) => { if (o.private && userId !== BOT_USER.id && !o.members?.includes(userId)) throw new Error("Unknown Member"); return { id: userId }; } },
      fetchStarterMessage: async () => { const found = channels.get(channel.parentId)?.messages.find((m: FakeMessage) => m.id === id); if (!found) throw new Error("Unknown Message"); return found; },
      isThread: () => !!o.thread, isDMBased: () => !!o.dm, isTextBased: () => true, isSendable: () => true,
      sendTyping: async () => {},
      send: async (payload: string | Payload) => post(channel, BOT_USER, payload),
    };
    channel.messages.fetch = async (query?: string | { limit?: number; before?: string; after?: string }) => {
      if (typeof query === "string") { const found = channel.messages.find((m: FakeMessage) => m.id === query); if (!found) throw new Error("Unknown Message"); return found; }
      channel.fetches++;
      const list = (channel.messages as FakeMessage[]).filter((m) => (!query?.before || BigInt(m.id) < BigInt(query.before)) && (!query?.after || BigInt(m.id) > BigInt(query.after)));
      return new Collection(list.slice(-(query?.limit ?? 50)).reverse().map((m) => [m.id, m]));
    };
    channels.set(id, channel);
    return channel;
  };

  const post = (channel: any, author: FakeUser & { bot: boolean }, payload: string | Payload, extra: { reference?: string; attachments?: any[]; at?: number } = {}) => {
    const body = normalize(payload);
    const mentioned = new Collection<string, any>([...body.content.matchAll(/<@!?(\w[\w-]*)>/g)].map(([, id]) => [id, { id }]));
    const message: any = {
      id: snowflake(), channelId: channel.id, guildId: channel.guildId, author: { ...author, username: author.username ?? author.name }, ...body,
      allowedMentions: typeof payload === "string" ? undefined : (payload as any).allowedMentions,
      reactions: [], edits: [], reference: extra.reference ? { messageId: extra.reference } : undefined, thread: undefined, pinned: false,
      channel, guild: channel.guild,
      member: channel.guildId ? memberOf(author) : null,
      mentions: { users: mentioned },
      attachments: new Collection((extra.attachments ?? []).map((a, i) => [a.id ?? String(i), a])),
      createdTimestamp: extra.at ?? clockNow(),
      get url() { return `https://discord.com/channels/${channel.guildId ?? "@me"}/${channel.id}/${message.id}`; },
      react: async (emoji: string) => {
        message.reactions.push(emoji);
        return { users: { remove: async () => { const at = message.reactions.lastIndexOf(emoji); if (at >= 0) message.reactions.splice(at, 1); } } };
      },
      pin: async () => { message.pinned = true; },
      delete: async () => { for (const list of [channel.messages, postedBy.get(author.id)]) { const at = list?.indexOf(message) ?? -1; if (at >= 0) list!.splice(at, 1); } return message; },
      reply: async (p: string | Payload) => post(channel, BOT_USER, p, { reference: message.id }),
      edit: async (p: string | Payload) => { const next = normalize(p); message.edits.push(next); Object.assign(message, typeof p === "string" ? { content: p } : Object.fromEntries(Object.entries(next).filter(([k]) => k in (p as object)))); return message; },
      fetchReference: async () => { const ref = message.reference && channel.messages.find((m: FakeMessage) => m.id === message.reference.messageId); if (!ref) throw new Error("Unknown Message"); return ref; },
      startThread: async ({ name }: { name: string }) => openThread(message, name, BOT_USER.id),
    };
    channel.messages.push(message);
    if (postedBy.has(author.id)) postedBy.get(author.id)!.push(message);
    else if (channel.guildId && !membersOf.get(channel.guildId)!.has(author.id)) membersOf.get(channel.guildId)!.set(author.id, { id: author.id, name: author.name, username: author.username });
    return message;
  };

  const openThread = (message: any, name: string, ownerId: string) => {
    message.thread = makeChannel(message.id, { thread: true, parentId: message.channelId, ownerId });
    message.thread.name = name;
    return message.thread;
  };

  // Channels and messages are shared, but whatever a bot sends, replies, or opens through them is that bot's.
  // The default bot uses them as they are; any other bot sees them through a view that acts as its own user.
  const views = new Map<string, WeakMap<object, any>>();
  const as = (user: FakeUser & { bot: boolean }, target: any): any => {
    if (!target || typeof target !== "object" || user.id === BOT_USER.id) return target;
    const cache = views.get(user.id) ?? new WeakMap();
    views.set(user.id, cache);
    if (cache.has(target)) return cache.get(target);
    const wrap = (value: any) => value instanceof Collection ? new Collection([...value].map(([k, v]) => [k, as(user, v)])) : as(user, value);
    const messages = target.messages && new Proxy(target.messages, { get: (list, key) => key === "fetch" ? async (q: any) => wrap(await list.fetch(q)) : Reflect.get(list, key) });
    const overrides: Record<string, () => unknown> = "author" in target ? {
      channel: () => as(user, target.channel),
      thread: () => as(user, target.thread),
      reply: () => async (p: string | Payload) => as(user, post(target.channel, user, p, { reference: target.id })),
      startThread: () => async ({ name }: { name: string }) => as(user, openThread(target, name, user.id)),
      fetchReference: () => async () => as(user, await target.fetchReference()),
      edit: () => async (p: string | Payload) => as(user, await target.edit(p)),
    } : {
      send: () => async (p: string | Payload) => as(user, post(target, user, p)),
      fetchStarterMessage: () => async () => as(user, await target.fetchStarterMessage()),
      messages: () => messages,
    };
    const view = new Proxy(target, { get: (t, key) => typeof key === "string" && Object.hasOwn(overrides, key) ? overrides[key]!() : Reflect.get(t, key) });
    cache.set(target, view);
    return view;
  };

  class FakeClient extends (await import("node:events")).EventEmitter {
    /** The running client of each bot user, by user id. */
    static running = new Map<string, FakeClient>();
    botUser = BOT_USER;
    user = { id: BOT_USER.id, tag: "Pachiware#0001", username: BOT_USER.name };
    guilds = { cache: new Collection<string, any>([[GUILD.id, GUILD]]), fetch: async (id?: string) => (id && guilds.get(id)) || GUILD };
    channels = { cache: channels as Map<string, any>, fetch: async (id: string) => as(this.botUser, channels.get(id) ?? null) };
    application = { id: "app-1", commands: {
      fetch: async () => new Collection(globalOf(this.botUser.id).map((c: any) => [c.name, c])),
      set: async (commands: any[], guildId?: string) => {
        if (guildId && refusedGuilds.has(guildId)) throw new Error("Missing Access");
        overwritesOf(this.botUser.id).push({ guildId: guildId ?? null, commands: commands.map(json) });
        return new Collection();
      },
    } };
    constructor(public options: unknown) { super(); }
    async login(token: string) {
      this.botUser = botUsers.get(token) ?? BOT_USER;
      this.user = { id: this.botUser.id, tag: `${this.botUser.name}#0001`, username: this.botUser.name };
      if (this.botUser !== BOT_USER) this.channels.cache = { get: (id: string) => as(this.botUser, channels.get(id)), has: (id: string) => channels.has(id) } as any;
      FakeClient.running.set(this.botUser.id, this);
      queueMicrotask(() => this.emit(Events.ClientReady, this));
      return token;
    }
    async destroy() { this.removeAllListeners(); if (FakeClient.running.get(this.botUser.id) === this) FakeClient.running.delete(this.botUser.id); }
  }
  mock.module("discord.js", () => ({ ...discordjs, Client: FakeClient }));

  const { now: clockNow, setClock } = await import("../../../../packages/skills/src/clock.ts");
  const { runMigrations } = await import("../../../../packages/db/src/migrate.ts");
  const { runSeed } = await import("../../../../packages/db/src/seed.ts");
  const dbModule = await import("../../../../packages/db/src/index.ts");
  const { db, gitAccounts, encryptSecret, setBotGitAccounts, replaceGitScopes, and, eq } = dbModule as any;
  const { repositories } = await import("../../../../packages/db/src/index.ts");
  await runMigrations(); await runSeed();
  const { llmRouter } = await import("../../src/llm/router.ts");
  const { retryPolicy } = await import("../../src/llm/retry.ts");
  retryPolicy.sleep = async () => {};
  const { DiscordBotManager } = await import("../../src/discord/client.ts");
  const { CacheService, tenantKey } = await import("../../src/cache/redis.ts");
  const { saveGuildSettings } = await import("../../src/loop/prompt.ts");
  const { workspaceStore } = await import("../../../../packages/skills/src/workspace/store.ts");
  const { setAvailabilityRule } = await import("../../../../packages/skills/src/availability.ts");
  const { skillRegistry } = await import("../../../../packages/skills/src/registry.ts");
  const { schedulerTick } = await import("../../src/scheduler.ts");

  const tenant = await repositories().tenants.create({ name: "Acme", slug: "acme" });
  const bot = await repositories().bots.create({ tenantId: tenant.id, token: "scenario-token", guildIds: [GUILD.id] });

  const steps: ModelStep[] = [];
  const calls: ChatMessage[][] = [], offered: string[][] = [];
  let callId = 0;
  const toResponse = async (step: ModelStep, turn: ModelTurn): Promise<LLMResponse> => {
    if (typeof step === "function") return toResponse(await step(turn), turn);
    if (typeof step === "string") return { content: step, toolCalls: [], finishReason: "stop" };
    if ("error" in step) return { content: step.error, toolCalls: [], finishReason: "error" };
    const list = Array.isArray(step) ? step : [step];
    return { content: null, finishReason: "tool_calls", toolCalls: list.map((c) => ({ id: `call-${++callId}`, name: c.tool, arguments: c.args ?? {} })) };
  };
  const realComplete = llmRouter.complete.bind(llmRouter);
  (llmRouter as any).complete = async (messages: ChatMessage[], options?: { tools?: { name: string }[] }) => {
    calls.push(messages.map((m) => ({ ...m })));
    offered.push((options?.tools ?? []).map((t) => t.name));
    const step = steps.shift();
    if (step === undefined) throw fail(`The model was called with no scripted step left (call ${calls.length}).`);
    const lastUser = messages.findLastIndex((m) => m.role === "user");
    return toResponse(step, { messages, toolResults: messages.slice(lastUser + 1).filter((m) => m.role === "tool").map((m) => unwrapTool(m.content)) });
  };

  const routes: { match: string | RegExp; respond: (req: HttpRequest) => unknown; passthrough?: boolean }[] = [];
  const realFetch = globalThis.fetch;
  const requests: HttpRequest[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input), method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: any = init?.body ?? null;
    if (typeof body === "string") try { body = JSON.parse(body); } catch {}
    const req = { method, url, body };
    requests.push(req);
    const line = `${method} ${url}`;
    const route = routes.findLast((r) => typeof r.match === "string" ? matchesRoute(r.match, method, url) : r.match.test(line));
    if (!route) { fail(`Unstubbed request: ${line}`); return new Response("unstubbed", { status: 599 as any }); }
    if (route.passthrough) return realFetch(input, init);
    const out = await route.respond(req);
    return out instanceof Response ? out : Response.json(out ?? null);
  }) as typeof fetch;

  const manager = new DiscordBotManager(0, 0);
  const started = await manager.startBot(bot.id);
  if (!started.success) throw new Error(`bot did not start: ${started.message}`);
  const extraBots: string[] = [];
  const clientOf = (userId: string) => { const c = FakeClient.running.get(userId); if (!c) throw new Error(`Bot user ${userId} is not running`); return c; };
  let client = clientOf(BOT_USER.id);
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await manager.idle();
    if (failures.length) throw new Error(failures.join("\n"));
  };
  makeChannel("channel-1");

  const unlimited = new Set<string>();
  const responder = (interaction: FakeInteraction & Record<string, any>, channel: any, user: FakeUser) => {
    let replyMessage: FakeMessage | null = null;
    let deferredPrivately = false;
    const record = (kind: FakeInteraction["responses"][number]["kind"], payload: any) => { interaction.responses.push({ kind, payload: payload === undefined ? undefined : typeof payload === "string" ? payload : { ...payload, ...normalize(payload) } }); };
    Object.assign(interaction, {
      id: snowflake(), user: { ...user, username: user.name }, member: memberOf(user),
      channel, channelId: channel.id, guildId: channel.guildId, guild: channel.guild, replied: false, deferred: false,
      isButton: () => false, isMessageContextMenuCommand: () => false, isContextMenuCommand: () => false, isChatInputCommand: () => false, isCommand: () => false, isRepliable: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
      // Like discord.js, a second initial response throws, and a reply deferred privately stays private when edited.
      reply: async (p: any) => { if (interaction.replied || interaction.deferred) throw new Error("InteractionAlreadyReplied"); record("reply", p); interaction.replied = true; if (!p?.ephemeral) replyMessage = await post(channel, BOT_USER, p); return replyMessage; },
      deferReply: async (p?: any) => { if (interaction.replied || interaction.deferred) throw new Error("InteractionAlreadyReplied"); record("deferReply", p); interaction.deferred = true; deferredPrivately = !!p?.ephemeral; },
      editReply: async (p: any) => { record("editReply", p); if (deferredPrivately) return null; return replyMessage ? (replyMessage as any).edit(p) : (replyMessage = await post(channel, BOT_USER, p)); },
      followUp: async (p: any) => { record("followUp", p); return p?.ephemeral ? null : post(channel, BOT_USER, p); },
    });
    return interaction;
  };
  const channelOf = (c: FakeChannel | string | undefined) => (typeof c === "string" ? makeChannel(c) : c ? channels.get(c.id) : channels.get("channel-1"));

  return {
    tenant, bot, db,
    model: { script: (...more) => { steps.push(...more); }, calls, tools: offered, live: () => { (llmRouter as any).complete = realComplete; } },
    http: { on: (match, respond) => { routes.push({ match, respond }); }, passthrough: (match) => { routes.push({ match, respond: () => null, passthrough: true }); }, requests },
    git: async ({ provider = "github", repos = ["acme/*"] } = {}) => {
      await repositories().skills.setEnabled(tenant.id, "git_repositories", true);
      const [account] = await db.insert(gitAccounts).values({ tenantId: tenant.id, name: provider, provider, username: "octo", tokenEncrypted: encryptSecret("git-token") }).returning();
      await setBotGitAccounts(tenant.id, bot.id, [account.id]);
      await replaceGitScopes(tenant.id, bot.id, GUILD.id, "", [{ gitAccountId: account.id, repoPatterns: repos }]);
      return account;
    },
    guildSettings: async (input) => { await saveGuildSettings(tenant.id, bot.id, GUILD.id, input); },
    clock: {
      set: (at) => { let fixed = at instanceof Date ? at.getTime() : typeof at === "string" ? Date.parse(at) : at; if (Number.isNaN(fixed)) throw new Error(`Not a time: ${String(at)}`); setClock(() => fixed); },
      advance: (ms) => { const fixed = clockNow() + ms; setClock(() => fixed); },
      now: () => clockNow(),
    },
    scheduler: { tick: async () => { await schedulerTick(manager); await settle(); } },
    availability: async ({ level, botId = bot.id, guildId = GUILD.id, channelId }, rule) => {
      await setAvailabilityRule({ tenantId: tenant.id, level, botId, guildId, channelId }, rule as any, skillRegistry.getAllSkills());
      await settle();
    },
    workspace: {
      read: async (path) => (await workspaceStore().read(tenant.id, path))?.content ?? null,
      write: async (path, content) => { const current = await workspaceStore().read(tenant.id, path); await workspaceStore().write(tenant.id, path, content, current?.version); },
      list: async (path) => (await workspaceStore().list(tenant.id, path)).map((e) => e.path),
    },
    discord: {
      mention: `<@${BOT_USER.id}>`, botUserId: BOT_USER.id, guildId: GUILD.id, alice, bob, botMessages,
      get registeredCommands() { return commandsIn(GUILD.id) ?? []; },
      commandOverwrites: overwrites,
      commandsIn,
      refuseCommands: (guildId, refused = true) => { if (refused) refusedGuilds.add(guildId); else refusedGuilds.delete(guildId); },
      joinGuild: async (id, name = id, { setUp = true, members } = {}) => {
        if (setUp) {
          // Stands in for the admin adding the guild, without the restart that would resend every guild's commands.
          const runtime = (manager as any).clients.get(bot.id);
          runtime.guildIds = [...runtime.guildIds, id];
          await repositories().bots.update(bot.id, { guildIds: runtime.guildIds });
        }
        const guild = makeGuild(id, name, members);
        client.guilds.cache.set(id, guild);
        client.emit(Events.GuildCreate, guild);
        await settle();
      },
      channel: (id, options) => makeChannel(id, options),
      history: (messages, { channel } = {}) => messages.map((m) => post(channelOf(channel), { ...(m.author ?? alice), bot: !!m.author?.bot }, m.content, { attachments: m.attachments, at: m.at })),
      deny: (channel, userId, permissions) => {
        const id = typeof channel === "string" ? channel : channel.id;
        const byUser = denied.get(id) ?? new Map<string, string[]>();
        denied.set(id, byUser);
        byUser.set(userId, [...(byUser.get(userId) ?? []), ...permissions]);
      },
      hide(channel) {
        const found = channelOf(channel);
        this.deny(found, found.guildId, ["ViewChannel"]);
      },
      grant: (user, permissions) => {
        const id = typeof user === "string" ? user : user.id;
        granted.set(id, [...new Set([...(granted.get(id) ?? []), ...permissions])]);
      },
      burst: async (contents, { author = alice, channel } = {}) => {
        if (unlimited.has(author.id)) await CacheService.del(tenantKey(tenant.id, `ratelimit:discord:user:${author.id}`));
        // The scenario's burst window is 0 so single sends answer at once; a real pause is needed here for the messages to meet in one turn.
        const manager0 = manager as any, window = manager0.burstMs;
        manager0.burstMs = 200;
        try {
          const messages = contents.map((content) => post(channelOf(channel), { ...author, bot: false }, content));
          for (const message of messages) for (const running of FakeClient.running.values()) running.emit(Events.MessageCreate, as(running.botUser, message));
          await settle();
          return messages;
        } finally { manager0.burstMs = window; }
      },
      send: async (content, { author = alice, channel, replyTo, attachments } = {}) => {
        if (unlimited.has(author.id)) await CacheService.del(tenantKey(tenant.id, `ratelimit:discord:user:${author.id}`));
        const message = post(channelOf(channel), { ...author, bot: false }, content, { reference: replyTo?.id, attachments });
        for (const running of FakeClient.running.values()) running.emit(Events.MessageCreate, as(running.botUser, message));
        await settle();
        return message;
      },
      unlimited: (user) => { unlimited.add(user.id); },
      click: async (message, button, { user = alice } = {}) => {
        const found = message.components.flatMap((row: any) => row.components ?? []).find((c: any) => c.label === button || c.custom_id === button);
        if (!found) throw new Error(`No button "${button}" on message ${message.id}`);
        const interaction = responder({ responses: [] }, channels.get(message.channelId), user);
        Object.assign(interaction, {
          isButton: () => true, customId: found.custom_id, message,
          update: async (p: any) => { interaction.responses.push({ kind: "update", payload: { ...p, ...normalize(p) } }); await (message as any).edit(p); },
          deferUpdate: async () => { interaction.responses.push({ kind: "deferUpdate", payload: undefined }); },
        });
        if (!client.emit(Events.InteractionCreate, interaction)) throw new Error("The bot does not listen for interactions");
        await settle();
        return interaction;
      },
      contextMenu: async (commandName, target, { user = alice } = {}) => {
        const interaction = responder({ responses: [] }, channels.get(target.channelId), user);
        Object.assign(interaction, { isMessageContextMenuCommand: () => true, isContextMenuCommand: () => true, isCommand: () => true, commandName, commandType: ApplicationCommandType.Message, targetId: target.id, targetMessage: target });
        if (!client.emit(Events.InteractionCreate, interaction)) throw new Error("The bot does not listen for interactions");
        await settle();
        return interaction;
      },
      slash: async (commandName, { text, file, user = alice, channel } = {}) => {
        const where = channelOf(channel);
        await settle();
        if (!commandsIn(GUILD.id)?.some((c) => c.type === ApplicationCommandType.ChatInput && c.name === commandName)) throw new Error(`No slash command /${commandName} is registered in ${GUILD.id}`);
        const interaction = responder({ responses: [] }, where, user);
        const values: Record<string, unknown> = { text, file };
        Object.assign(interaction, {
          isChatInputCommand: () => true, isCommand: () => true, commandName, commandType: ApplicationCommandType.ChatInput,
          options: { getString: (name: string) => (values[name] as string | undefined) ?? null, getAttachment: (name: string) => values[name] ?? null },
        });
        if (!client.emit(Events.InteractionCreate, interaction)) throw new Error("The bot does not listen for interactions");
        await settle();
        return interaction;
      },
      addBot: async ({ name = "Helper" } = {}) => {
        const n = extraBots.length + 2, token = `scenario-token-${n}`;
        const user = { id: `bot-user-${n}`, name, bot: true };
        botUsers.set(token, user);
        postedBy.set(user.id, []);
        const added = await repositories().bots.create({ tenantId: tenant.id, name, token, guildIds: [GUILD.id] });
        const result = await manager.startBot(added.id);
        if (!result.success) throw new Error(`bot did not start: ${result.message}`);
        extraBots.push(added.id);
        await settle();
        return { id: added.id, botUserId: user.id, mention: `<@${user.id}>`, messages: postedBy.get(user.id)!, get registeredCommands() { return commandsIn(GUILD.id, user.id) ?? []; } };
      },
    },
    settle,
    restart: async () => { await manager.restartBot(bot.id); client = clientOf(BOT_USER.id); await settle(); },
    close: async () => { for (const id of [bot.id, ...extraBots]) await manager.stopBot(id); },
  };
}

/** "GET api.github.com/repos/acme/api/issues" matches that method and any URL containing the rest; the method is optional. */
function matchesRoute(route: string, method: string, url: string) {
  const [first, ...rest] = route.split(" ");
  const hasMethod = rest.length > 0 && /^[A-Z]+$/.test(first!);
  return (!hasMethod || first === method) && url.includes(hasMethod ? rest.join(" ") : route);
}
