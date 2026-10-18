import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();

function runScenario(script: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-discord-"));
  const result = Bun.spawnSync({
    cmd: ["bun", "--eval", script],
    cwd: workspace,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:${join(directory, "discord.db")}`,
      PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 31).toString("base64"),
      NODE_ENV: "test",
    },
  });
  return { directory, result };
}

describe("DiscordBotManager tenant isolation", () => {
  test("isolates client lifecycle and tenant-scoped message dispatch without a Discord login", () => {
    const { directory, result } = runScenario(`
      import { mock } from "bun:test";
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      class FakeClient {
        static instances = []; constructor() { this.events = new Map(); this.user = { id: "bot-user", tag: "Pachiware#0001" }; this.guilds = { cache: { size: 1, first: () => null }, fetch: async () => null }; this.destroyed = 0; FakeClient.instances.push(this); }
        once(event, handler) { this.events.set("once:" + event, handler); return this; }
        on(event, handler) { this.events.set(event, handler); return this; }
        emit(event, value) { const once = this.events.get("once:" + event); if (once) once(value); const handler = this.events.get(event); if (handler) handler(value); }
        async login(token) { if (token === "bad-token") throw new Error("bad token"); this.emit("ready"); return token; }
        async destroy() { this.destroyed++; }
      }
      class FakeEmbed { setTitle() { return this; } setColor() { return this; } addFields() { return this; } setDescription() { return this; } setFooter() { return this; } }
      class FakeBuilder { addComponents() { return this; } setCustomId() { return this; } setLabel() { return this; } setStyle() { return this; } }
      mock.module("discord.js", () => ({ Client: FakeClient, GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8 }, Partials: { Channel: 1, Message: 2 }, Events: { ClientReady: "ready", Error: "error", MessageCreate: "message", InteractionCreate: "interaction" }, EmbedBuilder: FakeEmbed, ActionRowBuilder: FakeBuilder, ButtonBuilder: FakeBuilder, ButtonStyle: { Success: 3, Secondary: 2 }, ChannelType: { GuildText: 0, GuildVoice: 2, GuildAnnouncement: 5, GuildCategory: 4 }, PermissionFlagsBits: {} }));
      const { runMigrations } = await import(${JSON.stringify(join(workspace, "packages/db/src/migrate.ts"))});
      const { runSeed } = await import(${JSON.stringify(join(workspace, "packages/db/src/seed.ts"))});
      const { repositories } = await import(${JSON.stringify(join(workspace, "packages/db/src/index.ts"))});
      await runMigrations(); await runSeed();
      const alpha = await repositories().tenants.create({ name: "Alpha", slug: "alpha-discord" }); const beta = await repositories().tenants.create({ name: "Beta", slug: "beta-discord" });
      const alphaBot = await repositories().bots.create({ tenantId: alpha.id, token: "alpha-token", guildIds: ["guild-a"] });
      const betaBot = await repositories().bots.create({ tenantId: beta.id, token: "beta-token", guildIds: ["guild-b"] });
      const badBot = await repositories().bots.create({ tenantId: beta.id, token: "bad-token", guildIds: ["guild-b"] });
      const { DiscordBotManager } = await import(${JSON.stringify(join(workspace, "apps/agent/src/discord/client.ts"))});
      const { agentReActLoop } = await import(${JSON.stringify(join(workspace, "apps/agent/src/loop/react.ts"))});
      const { CacheService } = await import(${JSON.stringify(join(workspace, "apps/agent/src/cache/redis.ts"))});
      const manager = new DiscordBotManager();
      await manager.startAll(); await Promise.resolve();
      const status = manager.getStatus(); assert(status.length === 2 && status.every((row) => row.connected), "enabled tenants did not receive separate ready clients");
      const badRow = await repositories().bots.get(badBot.id); assert(badRow.connectionStatus === "error", "failed login did not isolate its status");
      let runs = []; agentReActLoop.run = async (input) => { runs.push(input); return { conversationId: "conversation", reply: "x".repeat(3801), iterations: 1, toolCallsExecuted: [{ call: { name: "createTask" }, result: { success: true } }] }; };
      const makeMessage = ({ guildId = "guild-a", mentioned = true, thread = false } = {}) => { const replies = []; const sends = []; const reacts = []; const channel = { ownerId: thread ? "bot-user" : "other", isThread: () => thread, isSendable: () => true, sendTyping: async () => {}, send: async (value) => sends.push(value), messages: { fetch: async () => new Map([["m0", { author: { id: "bot-user" }, createdTimestamp: 0 }]]) } }; return { author: { id: "user-1", username: "Operator", bot: false }, guildId, guild: { name: "Guild" }, channelId: "channel-1", channel, mentions: { users: { has: () => mentioned, keys: () => [] } }, attachments: { size: 0 }, react: async (e) => reacts.push(e), reacts, content: "<@bot-user> do work", reply: async (value) => replies.push(value), replies, sends }; };
      const direct = makeMessage(); await manager.handleMessage(alphaBot.id, direct); await new Promise((r) => setTimeout(r, 2800)); assert(runs.length === 1 && runs[0].tenantId === alpha.id && runs[0].botId === alphaBot.id, "message dispatched outside tenant context");
      assert(direct.replies.filter((reply) => typeof reply === "object" && reply.content).map((reply) => reply.content).join("") === "x".repeat(3801) && direct.replies.every((reply) => typeof reply !== "object" || reply.content.length <= 2000), "long reply was not safely chunked"); assert(direct.sends.length === 0, "generic tool action alert was sent");
      const thread = makeMessage({ mentioned: false, thread: true }); await manager.handleMessage(alphaBot.id, thread); await new Promise((r) => setTimeout(r, 2800)); assert(runs.length === 2, "owned thread was not processed");
      const foreignGuild = makeMessage({ guildId: "foreign" }); await manager.handleMessage(alphaBot.id, foreignGuild); assert(runs.length === 2, "unconfigured guild was processed");
      const oldRate = CacheService.checkRateLimit; CacheService.checkRateLimit = async () => ({ allowed: false, remaining: 0, resetIn: 60 }); const limited = makeMessage(); await manager.handleMessage(alphaBot.id, limited); CacheService.checkRateLimit = oldRate; assert(limited.reacts[0] === "⏳" && limited.replies.length === 0 && runs.length === 2, "rate-limited message dispatched");
      const usage = await repositories().usage.list({ tenantId: alpha.id }); assert(usage.filter((row) => row.type === "discord_message").length === 2, "Discord usage was not tenant-scoped");
      await Promise.all([manager.restartBot(alphaBot.id), manager.stopBot(alphaBot.id)]); assert(manager.getStatus(alphaBot.id) === null, "serialized lifecycle did not finish stopped");
      await manager.startBot(alphaBot.id); await manager.stopTenant(alpha.id); assert(manager.getStatus(alphaBot.id) === null, "stopTenant retained tenant runtime");
      await repositories().tenants.update(beta.id, { status: "suspended" }); await manager.stopTenant(beta.id); const suspended = await manager.startBot(betaBot.id); assert(!suspended.success, "suspended tenant bot started");
      await repositories().bots.remove(betaBot.id); const deleted = await manager.startBot(betaBot.id); assert(!deleted.success, "deleted bot started");
      assert(FakeClient.instances.length >= 4 && FakeClient.instances.some((client) => client.destroyed > 0), "client lifecycle did not destroy old runtimes");
      console.log(JSON.stringify({ ok: true, clients: FakeClient.instances.length, runs: runs.length, usage: usage.length }));
    `);
    try {
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(result.stdout).trim().split("\n").at(-1)!)).toMatchObject({ ok: true, runs: 2 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15000);
});
