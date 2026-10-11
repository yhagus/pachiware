/**
 * Discord scenario harness: the real bot manager and agent loop behind a fake discord.js client.
 *
 *   discordScenario("name", async (s) => {
 *     s.model.script({ tool: "repoList", args: {} }, (turn) => `saw ${turn.toolResults[0].items.length}`);
 *     s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api" }]);
 *     await s.git({ repos: ["acme/*"] });
 *     const msg = await s.discord.send(`${s.discord.mention} list repos`);
 *     await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
 *     await s.discord.contextMenu("Draft issues", msg);
 *     expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes.md")).toContain("...");
 *     const [first] = s.discord.history([{ content: "said an hour ago", at: Date.now() - 3600_000 }]);
 *     s.discord.deny("channel-1", s.discord.bob.id, ["ReadMessageHistory"]);
 *   });
 *
 * Each scenario runs in its own `bun test` subprocess with a fresh SQLite database and Workspace folder, so
 * `mock.module("discord.js")` and the stubbed `fetch` never leak. The callback must not close over variables
 * from the test file. Every `send`, `click`, and `contextMenu` returns after the bot has finished handling it.
 * An unscripted model call or an unstubbed request fails the scenario.
 * Defaults: guild "guild-1", channel "channel-1", author `s.discord.alice`; the bot's user id is "bot-user".
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
export type ModelStep = string | ToolCallStep | ToolCallStep[] | ((turn: ModelTurn) => ModelStep);
export type HttpRequest = { method: string; url: string; body: any };

export type Payload = { content?: string; embeds?: any[]; components?: any[]; files?: any[] };
export type FakeUser = { id: string; name: string };
export interface FakeMessage {
  id: string; channelId: string; guildId: string | null; author: FakeUser & { bot: boolean };
  content: string; embeds: any[]; components: any[]; files: any[];
  reactions: string[]; edits: Payload[]; reference?: { messageId: string }; thread?: FakeChannel;
}
export interface FakeChannel { id: string; guildId: string | null; parentId: string | null; ownerId: string | null; name: string; messages: FakeMessage[]; /** History reads (one per `messages.fetch` page). */ fetches: number }
export type ChannelOptions = { thread?: boolean; parentId?: string; ownerId?: string; dm?: boolean; private?: boolean; members?: string[] };
/** A message written before the bot was listening; `at` is its creation time in ms. */
export type PastMessage = { content: string; author?: FakeUser & { bot?: boolean }; at?: number; attachments?: any[] };
/** A button click or context-menu command as the bot received it, with every response it made. */
export interface FakeInteraction { responses: { kind: "reply" | "update" | "deferReply" | "deferUpdate" | "editReply" | "followUp"; payload: any }[] }

export interface Scenario {
  tenant: { id: string };
  bot: { id: string };
  db: any;
  model: { script(...steps: ModelStep[]): void; calls: ChatMessage[][] };
  http: { on(match: string | RegExp, respond: (req: HttpRequest) => unknown): void; requests: HttpRequest[] };
  /** Attaches a git account to the bot and opens these repositories in the guild. */
  git(options?: { provider?: "github" | "gitlab"; repos?: string[] }): Promise<{ id: string }>;
  guildSettings(input: { systemPrompt?: string | null; useThreads?: boolean; alwaysChannelIds?: string[] }): Promise<void>;
  /** Paths are tenant-relative, e.g. "guilds/guild-1/channels/channel-1/brief.md". */
  workspace: { read(path: string): Promise<string | null>; write(path: string, content: string): Promise<void>; list(path: string): Promise<string[]> };
  discord: {
    mention: string; botUserId: string; guildId: string; alice: FakeUser; bob: FakeUser;
    botMessages: FakeMessage[];
    /** Application commands the bot registered through `client.application.commands.set`, as JSON. */
    readonly registeredCommands: any[];
    /** A private thread admits only the bot plus `members`. */
    channel(id: string, options?: ChannelOptions): FakeChannel;
    /** Adds messages to a channel's history without the bot seeing them arrive, oldest first. */
    history(messages: PastMessage[], options?: { channel?: FakeChannel | string }): FakeMessage[];
    /** Takes permissions (names such as "ReadMessageHistory") from a user or the bot in a channel; a thread also inherits its parent's. */
    deny(channel: FakeChannel | string, userId: string, permissions: string[]): void;
    send(content: string, options?: { author?: FakeUser; channel?: FakeChannel | string; replyTo?: FakeMessage; attachments?: any[] }): Promise<FakeMessage>;
    /** Clicks the button whose label or custom id matches. */
    click(message: FakeMessage, button: string, options?: { user?: FakeUser }): Promise<FakeInteraction>;
    contextMenu(commandName: string, target: FakeMessage, options?: { user?: FakeUser }): Promise<FakeInteraction>;
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
  const frame = new Error().stack!.split("\n").map((line) => /(\/[^\s()]+\.test\.ts)\b/.exec(line)?.[1]).find(Boolean);
  if (!frame) throw new Error("discordScenario must be called from a *.test.ts file");
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
  const GUILD: any = { id: "guild-1", name: "Acme" };
  GUILD.members = { fetch: async (id: string) => ({ id, user: { id }, guild: GUILD, displayName: id }) };
  let nextId = 1000n;
  const snowflake = () => String(nextId++);
  const channels = new Map<string, any>();
  const botMessages: FakeMessage[] = [];

  const denied = new Map<string, Map<string, string[]>>();
  const deniedIn = (channel: any, userId: string): string[] => [...(denied.get(channel.id)?.get(userId) ?? []), ...(channel.parentId ? deniedIn(channels.get(channel.parentId) ?? { id: channel.parentId }, userId) : [])];
  const makeChannel = (id: string, o: ChannelOptions = {}) => {
    if (channels.has(id)) return channels.get(id);
    const channel: any = {
      id, name: id, guildId: o.dm ? null : GUILD.id, guild: o.dm ? null : GUILD, parentId: o.thread ? o.parentId ?? "channel-1" : null, ownerId: o.ownerId ?? null,
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
      id: snowflake(), channelId: channel.id, guildId: channel.guildId, author: { ...author, username: author.name }, ...body,
      reactions: [], edits: [], reference: extra.reference ? { messageId: extra.reference } : undefined, thread: undefined,
      channel, guild: channel.guild,
      member: channel.guildId ? { displayName: author.name, roles: { cache: new Collection() }, permissions: { toArray: () => [] } } : null,
      mentions: { users: mentioned },
      attachments: new Collection((extra.attachments ?? []).map((a, i) => [a.id ?? String(i), a])),
      createdTimestamp: extra.at ?? Date.now(),
      get url() { return `https://discord.com/channels/${channel.guildId ?? "@me"}/${channel.id}/${message.id}`; },
      react: async (emoji: string) => { message.reactions.push(emoji); },
      reply: async (p: string | Payload) => post(channel, BOT_USER, p, { reference: message.id }),
      edit: async (p: string | Payload) => { const next = normalize(p); message.edits.push(next); Object.assign(message, typeof p === "string" ? { content: p } : Object.fromEntries(Object.entries(next).filter(([k]) => k in (p as object)))); return message; },
      fetchReference: async () => { const ref = message.reference && channel.messages.find((m: FakeMessage) => m.id === message.reference.messageId); if (!ref) throw new Error("Unknown Message"); return ref; },
      startThread: async ({ name }: { name: string }) => { message.thread = makeChannel(message.id, { thread: true, parentId: channel.id, ownerId: BOT_USER.id }); message.thread.name = name; return message.thread; },
    };
    channel.messages.push(message);
    if (author.id === BOT_USER.id) botMessages.push(message);
    return message;
  };

  class FakeClient extends (await import("node:events")).EventEmitter {
    static last: FakeClient;
    user = { id: BOT_USER.id, tag: "Pachiware#0001", username: BOT_USER.name };
    guilds = { cache: new Collection([[GUILD.id, GUILD]]), fetch: async () => GUILD };
    channels = { cache: channels, fetch: async (id: string) => channels.get(id) ?? null };
    application = { id: "app-1", commands: { registered: [] as any[], set: async (commands: any[]) => { this.application.commands.registered = commands.map(json); return new Collection(); } } };
    constructor(public options: unknown) { super(); FakeClient.last = this; }
    async login(token: string) { queueMicrotask(() => this.emit(Events.ClientReady, this)); return token; }
    async destroy() { this.removeAllListeners(); }
  }
  mock.module("discord.js", () => ({ ...discordjs, Client: FakeClient }));

  const { runMigrations } = await import("../../../../packages/db/src/migrate.ts");
  const { runSeed } = await import("../../../../packages/db/src/seed.ts");
  const dbModule = await import("../../../../packages/db/src/index.ts");
  const { db, gitAccounts, tenantSkills, encryptSecret, setBotGitAccounts, replaceGitScopes, and, eq } = dbModule as any;
  const { createTenant, createBot, upsertGuildConfig } = await import("../../../../packages/db/src/tenancy.ts");
  await runMigrations(); await runSeed();
  const { llmRouter } = await import("../../src/llm/router.ts");
  const { DiscordBotManager } = await import("../../src/discord/client.ts");
  const { CacheService } = await import("../../src/cache/redis.ts");
  const { guildCacheKey } = await import("../../src/loop/prompt.ts");
  const { workspaceStore } = await import("../../../../packages/skills/src/workspace/store.ts");

  const tenant = await createTenant({ name: "Acme", slug: "acme" });
  const bot = await createBot({ tenantId: tenant.id, token: "scenario-token", guildIds: [GUILD.id] });

  const steps: ModelStep[] = [];
  const calls: ChatMessage[][] = [];
  let callId = 0;
  const toResponse = (step: ModelStep, turn: ModelTurn): LLMResponse => {
    if (typeof step === "function") return toResponse(step(turn), turn);
    if (typeof step === "string") return { content: step, toolCalls: [], finishReason: "stop" };
    const list = Array.isArray(step) ? step : [step];
    return { content: null, finishReason: "tool_calls", toolCalls: list.map((c) => ({ id: `call-${++callId}`, name: c.tool, arguments: c.args ?? {} })) };
  };
  (llmRouter as any).complete = async (messages: ChatMessage[]) => {
    calls.push(messages.map((m) => ({ ...m })));
    const step = steps.shift();
    if (step === undefined) throw fail(`The model was called with no scripted step left (call ${calls.length}).`);
    const lastUser = messages.findLastIndex((m) => m.role === "user");
    return toResponse(step, { messages, toolResults: messages.slice(lastUser + 1).filter((m) => m.role === "tool").map((m) => unwrapTool(m.content)) });
  };

  const routes: { match: string | RegExp; respond: (req: HttpRequest) => unknown }[] = [];
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
    const out = await route.respond(req);
    return out instanceof Response ? out : Response.json(out ?? null);
  }) as typeof fetch;

  const manager = new DiscordBotManager(0);
  const started = await manager.startBot(bot.id);
  if (!started.success) throw new Error(`bot did not start: ${started.message}`);
  let client = FakeClient.last;
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await manager.idle();
    if (failures.length) throw new Error(failures.join("\n"));
  };
  makeChannel("channel-1");

  const alice = { id: "user-alice", name: "Alice" }, bob = { id: "user-bob", name: "Bob" };
  const responder = (interaction: FakeInteraction & Record<string, any>, channel: any, user: FakeUser) => {
    let replyMessage: FakeMessage | null = null;
    const record = (kind: FakeInteraction["responses"][number]["kind"], payload: any) => { interaction.responses.push({ kind, payload: payload === undefined ? undefined : typeof payload === "string" ? payload : { ...payload, ...normalize(payload) } }); };
    Object.assign(interaction, {
      id: snowflake(), user: { ...user, username: user.name }, member: { displayName: user.name, roles: { cache: new Collection() }, permissions: { toArray: () => [] } },
      channel, channelId: channel.id, guildId: channel.guildId, guild: channel.guild, replied: false, deferred: false,
      isButton: () => false, isMessageContextMenuCommand: () => false, isContextMenuCommand: () => false, isChatInputCommand: () => false, isCommand: () => false, isRepliable: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
      reply: async (p: any) => { record("reply", p); interaction.replied = true; if (!p?.ephemeral) replyMessage = await post(channel, BOT_USER, p); return replyMessage; },
      deferReply: async (p?: any) => { record("deferReply", p); interaction.deferred = true; },
      editReply: async (p: any) => { record("editReply", p); return replyMessage ? (replyMessage as any).edit(p) : (replyMessage = await post(channel, BOT_USER, p)); },
      followUp: async (p: any) => { record("followUp", p); return p?.ephemeral ? null : post(channel, BOT_USER, p); },
    });
    return interaction;
  };
  const channelOf = (c: FakeChannel | string | undefined) => (typeof c === "string" ? makeChannel(c) : c ? channels.get(c.id) : channels.get("channel-1"));

  return {
    tenant, bot, db,
    model: { script: (...more) => { steps.push(...more); }, calls },
    http: { on: (match, respond) => { routes.push({ match, respond }); }, requests },
    git: async ({ provider = "github", repos = ["acme/*"] } = {}) => {
      await db.update(tenantSkills).set({ isEnabled: true }).where(and(eq(tenantSkills.tenantId, tenant.id), eq(tenantSkills.skillId, "git_repositories")));
      const [account] = await db.insert(gitAccounts).values({ tenantId: tenant.id, name: provider, provider, username: "octo", tokenEncrypted: encryptSecret("git-token") }).returning();
      await setBotGitAccounts(tenant.id, bot.id, [account.id]);
      await replaceGitScopes(tenant.id, bot.id, GUILD.id, "", [{ gitAccountId: account.id, repoPatterns: repos }]);
      return account;
    },
    guildSettings: async (input) => { await upsertGuildConfig(tenant.id, bot.id, GUILD.id, input); await CacheService.del(guildCacheKey(tenant.id, bot.id, GUILD.id)); },
    workspace: {
      read: async (path) => (await workspaceStore().read(tenant.id, path))?.content ?? null,
      write: async (path, content) => { const current = await workspaceStore().read(tenant.id, path); await workspaceStore().write(tenant.id, path, content, current?.version); },
      list: async (path) => (await workspaceStore().list(tenant.id, path)).map((e) => e.path),
    },
    discord: {
      mention: `<@${BOT_USER.id}>`, botUserId: BOT_USER.id, guildId: GUILD.id, alice, bob, botMessages,
      get registeredCommands() { return client.application.commands.registered; },
      channel: (id, options) => makeChannel(id, options),
      history: (messages, { channel } = {}) => messages.map((m) => post(channelOf(channel), { ...(m.author ?? alice), bot: !!m.author?.bot }, m.content, { attachments: m.attachments, at: m.at })),
      deny: (channel, userId, permissions) => {
        const id = typeof channel === "string" ? channel : channel.id;
        const byUser = denied.get(id) ?? new Map<string, string[]>();
        denied.set(id, byUser);
        byUser.set(userId, [...(byUser.get(userId) ?? []), ...permissions]);
      },
      send: async (content, { author = alice, channel, replyTo, attachments } = {}) => {
        const message = post(channelOf(channel), { ...author, bot: false }, content, { reference: replyTo?.id, attachments });
        client.emit(Events.MessageCreate, message);
        await settle();
        return message;
      },
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
    },
    settle,
    restart: async () => { await manager.restartBot(bot.id); client = FakeClient.last; await settle(); },
    close: async () => { await manager.stopBot(bot.id); },
  };
}

/** "GET api.github.com/repos/acme/api/issues" matches that method and any URL containing the rest; the method is optional. */
function matchesRoute(route: string, method: string, url: string) {
  const [first, ...rest] = route.split(" ");
  const hasMethod = rest.length > 0 && /^[A-Z]+$/.test(first!);
  return (!hasMethod || first === method) && url.includes(hasMethod ? rest.join(" ") : route);
}
