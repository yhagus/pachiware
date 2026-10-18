import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { respondReason, isNoise, speakerTurn, threadName, requestedWord, type Trigger } from "../src/discord/routing";

const base: Trigger = { authorIsBot: false, guildId: "g1", allowedGuildIds: [], mentioned: false, repliedToBot: false, inOwnThread: false, channelId: "c1", alwaysChannelIds: [], lastMessageFromBot: false, addressesOthers: false };
const reason = (o: Partial<Trigger>) => respondReason({ ...base, ...o });

describe("respondReason", () => {
  test("decides when the bot answers", () => {
    expect(reason({ guildId: null })).toBe("direct");
    expect(reason({ mentioned: true })).toBe("mention");
    expect(reason({ repliedToBot: true })).toBe("mention");
    expect(reason({ inOwnThread: true })).toBeNull();
    expect(reason({ inOwnThread: true, lastMessageFromBot: true })).toBe("direct");
    expect(reason({ inOwnThread: true, lastMessageFromBot: true, addressesOthers: true })).toBeNull();
    expect(reason({ inOwnThread: true, addressesOthers: true, mentioned: true })).toBe("direct");
    expect(reason({ alwaysChannelIds: ["c1"], addressesOthers: true })).toBeNull();
    expect(reason({ alwaysChannelIds: ["c1"] })).toBe("direct");
    expect(reason({})).toBeNull();
    expect(reason({ mentioned: true, authorIsBot: true })).toBeNull();
    expect(reason({ mentioned: true, allowedGuildIds: ["other"] })).toBeNull();
    expect(reason({ guildId: null, authorIsBot: true })).toBeNull();
  });
  test("ignores noise", () => {
    for (const t of ["😂", "<:pog:123456789>", "👍🏽 !!", "  ", "..."]) expect(isNoise(t)).toBe(true);
    expect(isNoise("ok 😂")).toBe(false);
    expect(isNoise("😂", true)).toBe(false);
  });
  test("formats turns and thread names", () => {
    expect(speakerTurn("g1", "Ana", "hi")).toBe("Ana: hi");
    expect(speakerTurn(null, "Ana", "hi")).toBe("hi");
    expect(speakerTurn("g1", "Ana", "hi", "42")).toBe("Ana (message 42): hi");
    expect(speakerTurn(null, "Ana", "hi", "42")).toBe("(message 42): hi");
    expect(threadName("  a\n\n b ")).toBe("a b");
    expect(threadName("x".repeat(100))).toHaveLength(60);
    expect(threadName("   ")).toBe("Conversation");
  });
});

describe("guild config", () => {
  test("API validates and isolates, prompt carries the server instructions, cache invalidates", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-guild-"));
    const root = process.cwd();
    const script = `
      const assert = (c, m) => { if (!c) throw new Error(m); };
      const { runMigrations } = await import(${JSON.stringify(join(root, "packages/db/src/migrate.ts"))});
      await runMigrations(); await runMigrations();
      const { repositories } = await import(${JSON.stringify(join(root, "packages/db/src/index.ts"))});
      const { createServer } = await import(${JSON.stringify(join(root, "apps/agent/src/server.ts"))});
      const { SystemPromptBuilder } = await import(${JSON.stringify(join(root, "apps/agent/src/loop/prompt.ts"))});
      const app = createServer();
      const admin = { "X-Platform-Key": "k", "Content-Type": "application/json" };
      const t = await repositories().tenants.create({ name: "T", slug: "t" });
      const bot = await repositories().bots.create({ tenantId: t.id, token: "tok" });
      const url = "/api/admin/bots/" + bot.id + "/guilds/g1/config";
      const put = (b) => app.request(url, { method: "PUT", headers: admin, body: JSON.stringify(b) });
      const ctx = { tenantId: t.id, botId: bot.id, platform: "discord", guildId: "g1", guildName: "Srv" };
      assert((await app.request(url)).status === 401, "admin key required");
      let got = (await (await app.request(url, { headers: admin })).json()).config;
      assert(got.useThreads === true && got.systemPrompt === "", "defaults wrong");
      assert(!(await SystemPromptBuilder.build(ctx)).includes("Server instructions"), "prompt before config");
      assert((await put({ systemPrompt: "x".repeat(8001) })).status === 400, "long prompt accepted");
      assert((await put({ useThreads: "yes" })).status === 400, "bad useThreads accepted");
      assert((await put({ alwaysChannelIds: [1] })).status === 400, "bad channel ids accepted");
      assert((await put({ systemPrompt: "Answer in Indonesian", alwaysChannelIds: ["c9"], useThreads: false })).status === 200, "save failed");
      const p1 = await SystemPromptBuilder.build(ctx);
      assert(p1.includes("Answer in Indonesian"), "prompt missing server instructions");
      assert(!(await SystemPromptBuilder.build({ ...ctx, guildId: "g2" })).includes("Answer in Indonesian"), "leaked to other server");
      await put({ systemPrompt: "Answer in French" });
      assert((await SystemPromptBuilder.build(ctx)).includes("French"), "cache not invalidated");
      got = (await (await app.request(url, { headers: admin })).json()).config;
      assert(got.useThreads === false && got.alwaysChannelIds[0] === "c9", "partial update lost fields");
      assert((await app.request("/api/admin/bots/nope/guilds/g1/config", { headers: admin })).status === 404, "unknown bot");
      console.log("ok");
    `;
    const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "g.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
    try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

test("a short request names the one word in it that is not a request word, the trigger of an in-place playbook (#245)", () => {
  expect(requestedWord("notulen dong")).toBe("notulen");
  expect(requestedWord("tolong bikinin notulen rapat tadi ya!")).toBe("notulen");
  expect(requestedWord("Take the minutes, please")).toBe("minutes");
  expect(requestedWord("notulen rapat vendor kemarin di mana?")).toBeNull();
  expect(requestedWord("tolong dong")).toBeNull();
  expect(requestedWord("catat notulen dan kirim ke Bob")).toBeNull();
});
