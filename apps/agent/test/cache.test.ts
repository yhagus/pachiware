import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedTokensOf } from "../src/llm/usage";
import { dropLeadingOrphans, historyOffset, storedToolResult } from "../src/loop/history";

describe("prompt cache helpers", () => {
  test("reads cached tokens from OpenAI, DeepSeek and Anthropic-style usage", () => {
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: 128 } })).toBe(128);
    expect(cachedTokensOf({ prompt_cache_hit_tokens: 64 })).toBe(64);
    expect(cachedTokensOf({ cache_read_input_tokens: 32 })).toBe(32);
    expect(cachedTokensOf({ prompt_tokens: 10 })).toBe(0);
    expect(cachedTokensOf(undefined)).toBe(0);
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: "x" } })).toBe(0);
  });
  test("history window advances in steps so the prefix repeats", () => {
    expect(historyOffset(10)).toBe(0);
    expect(historyOffset(30)).toBe(0);
    const starts = new Set([31, 32, 35, 39].map((n) => historyOffset(n)));
    expect(starts.size).toBe(1);
    expect(historyOffset(40)).toBe(10);
    expect(historyOffset(41)).toBe(10);
    expect(historyOffset(50)).toBe(20);
  });
  test("drops a tool result left without its assistant call", () => {
    const rows = [{ role: "tool" }, { role: "tool" }, { role: "user" }, { role: "tool" }];
    expect(dropLeadingOrphans(rows).map((r) => r.role)).toEqual(["user", "tool"]);
    expect(dropLeadingOrphans([])).toEqual([]);
  });
  test("a stored tool result stays under 1000 characters whatever the tool returned", () => {
    const huge = { items: Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, title: "t".repeat(500), body: "b".repeat(5000) })) };
    expect(storedToolResult({ success: true, data: huge }).length).toBeLessThan(1000);
    expect(storedToolResult({ success: false, error: "e".repeat(20000) }).length).toBeLessThan(1000);
    expect(storedToolResult({ success: true, data: "x".repeat(20000) }).length).toBeLessThan(1000);
  });
});

describe("system prompt stays stable between turns", () => {
  test("static prompt ignores user, channel and tasks; dynamic part carries them; tools are sorted", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-cache-"));
    const root = process.cwd();
    const script = `
      const assert = (c, m) => { if (!c) throw new Error(m); };
      const { runMigrations } = await import(${JSON.stringify(join(root, "packages/db/src/migrate.ts"))});
      const { runSeed } = await import(${JSON.stringify(join(root, "packages/db/src/seed.ts"))});
      await runMigrations(); await runSeed();
      const db = await import(${JSON.stringify(join(root, "packages/db/src/index.ts"))});
      const { SystemPromptBuilder } = await import(${JSON.stringify(join(root, "apps/agent/src/loop/prompt.ts"))});
      const { skillRegistry } = await import(${JSON.stringify(join(root, "packages/skills/src/index.ts"))});
      const t = await db.createTenant({ name: "T", slug: "t" });
      const base = { tenantId: t.id, platform: "discord", guildId: "g1", guildName: "Srv" };
      const a = await SystemPromptBuilder.build({ ...base, userName: "Ana", userId: "1", channelId: "c1" });
      await skillRegistry.executeTool({ id: "s", name: "createTask", arguments: { title: "new task" } }, { db: db.db, tenantId: t.id, guildId: "g1", channelId: "c2", userId: "2" });
      const b = await SystemPromptBuilder.build({ ...base, userName: "Budi", userId: "2", channelId: "c2" });
      assert(a === b, "static prompt changed between users/tasks");
      assert(!a.includes("Ana") && !a.includes("new task") && !a.includes("c1"), "dynamic data leaked into static prompt");
      const d = await SystemPromptBuilder.buildDynamic({ ...base, userName: "Budi", userId: "2", channelId: "c2" });
      assert(d.includes("Budi") && d.includes("new task") && d.includes("c2"), "dynamic part incomplete");
      const names = (await skillRegistry.getActiveTools(t.id)).map((x) => x.name);
      assert(names.length > 0 && names.join() === [...names].sort().join(), "tools not sorted");
      console.log("ok");
    `;
    const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "c.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), WORKSPACE_DIR: join(directory, "ws"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
    try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
