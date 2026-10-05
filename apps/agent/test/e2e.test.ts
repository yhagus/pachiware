import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const encryptionKey = Buffer.alloc(32, 19).toString("base64");

function runApiScenario(script: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-api-"));
  const result = Bun.spawnSync({
    cmd: ["bun", "--eval", script],
    cwd: workspace,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:${join(directory, "phase13.db")}`,
      PLATFORM_ENCRYPTION_KEY: encryptionKey,
      PLATFORM_ADMIN_KEY: "phase13-admin-key",
      NODE_ENV: "test",
    },
  });
  return { directory, result };
}

function stderr(result: ReturnType<typeof Bun.spawnSync>) {
  return new TextDecoder().decode(result.stderr).trim();
}

function jsonOutput(result: ReturnType<typeof Bun.spawnSync>) {
  const stdout = new TextDecoder().decode(result.stdout).trim().split("\n");
  return JSON.parse(stdout.at(-1)!);
}

describe("Phase 13 tenant API", () => {
  test("enforces admin, tenant auth, scopes, isolation, encrypted config, and bot lifecycle", () => {
    const { directory, result } = runApiScenario(`
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const { runMigrations } = await import(${JSON.stringify(join(workspace, "packages/db/src/migrate.ts"))});
      const { runSeed } = await import(${JSON.stringify(join(workspace, "packages/db/src/seed.ts"))});
      const { db, agentsConfig, eq } = await import(${JSON.stringify(join(workspace, "packages/db/src/index.ts"))});
      await runMigrations(); await runSeed();
      const { createServer } = await import(${JSON.stringify(join(workspace, "apps/agent/src/server.ts"))});
      const { discordBotManager } = await import(${JSON.stringify(join(workspace, "apps/agent/src/discord/client.ts"))});
      const calls = [];
      discordBotManager.startBot = async (id) => (calls.push(["start", id]), { success: true });
      discordBotManager.restartBot = async (id) => (calls.push(["restart", id]), { success: true });
      discordBotManager.removeBot = async (id) => (calls.push(["remove", id]), { success: true });
      discordBotManager.stopBot = async (id) => (calls.push(["stop", id]), { success: true });
      const app = createServer();
      const admin = { "X-Platform-Key": "phase13-admin-key", "Content-Type": "application/json" };
      const request = async (path, init = {}) => app.request(path, init);
      const body = async (res) => await res.json();
      const create = async (name, slug) => { const res = await request("/api/admin/tenants", { method: "POST", headers: admin, body: JSON.stringify({ name, slug }) }); assert(res.status === 201, "tenant provisioning failed"); return (await body(res)).tenant; };
      const first = await create("First", "first"); const second = await create("Second", "second");
      const issue = async (tenant, scopes = []) => { const res = await request("/api/admin/tenants/" + tenant.id + "/api-keys", { method: "POST", headers: admin, body: JSON.stringify({ name: "test", scopes }) }); assert(res.status === 201, "key issuance failed"); return body(res); };
      const firstKey = await issue(first); const secondKey = await issue(second); const scoped = await issue(first, ["tasks:read"]);
      const auth = (key) => ({ Authorization: "Bearer " + key, "Content-Type": "application/json" });
      assert((await request("/api/admin/tenants")).status === 401, "admin key required");
      assert((await request("/api/v1/tasks")).status === 401, "tenant key required");
      assert((await request("/api/v1/tasks", { headers: auth("bad") })).status === 401, "bad key rejected");
      assert((await request("/api/v1/tasks", { method: "POST", headers: auth(scoped.raw), body: JSON.stringify({ title: "denied" }) })).status === 403, "write scope rejected");
      const created = await request("/api/v1/tasks", { method: "POST", headers: auth(firstKey.raw), body: JSON.stringify({ title: "private deploy", priority: "high" }) });
      assert(created.status === 201, "task creation failed"); const task = (await body(created)).task;
      const secondList = await body(await request("/api/v1/tasks?search=private", { headers: auth(secondKey.raw) }));
      assert(secondList.tasks.length === 0 && secondList.counts.total === 0, "task crossed tenant boundary");
      assert((await request("/api/v1/tasks/" + task.id, { method: "PATCH", headers: auth(secondKey.raw), body: JSON.stringify({ status: "completed" }) })).status === 404, "foreign task update rejected");
      const list = await body(await request("/api/v1/tasks?search=private", { headers: auth(firstKey.raw) }));
      assert(list.tasks.length === 1 && list.counts.pending === 1, "tenant task search/counts failed");
      assert((await request("/api/v1/tasks/" + task.id, { method: "DELETE", headers: auth(firstKey.raw) })).status === 200, "task delete failed");
      assert((await request("/api/admin/api-keys/" + firstKey.keyId, { method: "DELETE", headers: admin })).status === 200, "key revoke failed");
      assert((await request("/api/v1/tasks", { headers: auth(firstKey.raw) })).status === 401, "revoked key accepted");
      const configPut = await request("/api/v1/config", { method: "PUT", headers: auth(secondKey.raw), body: JSON.stringify({ openaiApiKeyEncrypted: "tenant-secret", defaultModel: "tenant-model" }) });
      assert(configPut.status === 200, "config update failed");
      const config = await body(await request("/api/v1/config", { headers: auth(secondKey.raw) }));
      assert(config.config.openaiApiKeyEncrypted === "••••••••", "config secret exposed");
      const [stored] = await db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, second.id));
      assert(stored.openaiApiKeyEncrypted !== "tenant-secret" && stored.openaiApiKeyEncrypted.startsWith("v1:"), "config secret not encrypted");
      const botRes = await request("/api/v1/bots", { method: "POST", headers: auth(secondKey.raw), body: JSON.stringify({ name: "test bot", token: "bot-secret", isEnabled: false }) });
      assert(botRes.status === 201, "bot creation failed"); const bot = (await body(botRes)).bot;
      assert(!JSON.stringify(bot).includes("bot-secret"), "bot secret exposed");
      assert((await request("/api/v1/bots/" + bot.id, { method: "PATCH", headers: auth(secondKey.raw), body: JSON.stringify({ name: "updated" }) })).status === 200, "bot update failed");
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ id: "discord-user", username: "mock" }), { status: 200, headers: { "Content-Type": "application/json" } });
      assert((await request("/api/v1/bots/" + bot.id + "/test", { method: "POST", headers: auth(secondKey.raw), body: JSON.stringify({}) })).status === 200, "bot token test failed"); globalThis.fetch = originalFetch;
      assert((await request("/api/v1/bots/" + bot.id + "/restart", { method: "POST", headers: auth(secondKey.raw) })).status === 200, "bot restart failed");
      assert((await request("/api/v1/bots/" + bot.id, { method: "DELETE", headers: auth(secondKey.raw) })).status === 200, "bot delete failed");
      assert(calls.some(([name]) => name === "restart") && calls.some(([name]) => name === "remove"), "bot manager was not called");
      assert((await request("/api/admin/tenants/" + second.id, { method: "PATCH", headers: admin, body: JSON.stringify({ status: "suspended" }) })).status === 200, "tenant suspend failed");
      assert((await request("/api/v1/tasks", { headers: auth(secondKey.raw) })).status === 403, "suspended tenant accepted");
      const cors = await request("/api/v1/tasks", { method: "OPTIONS", headers: { Origin: "https://operator.example", "Access-Control-Request-Method": "GET" } });
      assert(cors.headers.get("access-control-allow-methods")?.includes("GET"), "CORS preflight missing");
      console.log(JSON.stringify({ ok: true, botCalls: calls.length }));
    `);
    try { expect(result.exitCode, stderr(result)).toBe(0); expect(jsonOutput(result)).toMatchObject({ ok: true, botCalls: expect.any(Number) }); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("rejects cross-tenant conversations and records ReAct LLM/tool usage", () => {
    const { directory, result } = runApiScenario(`
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const { runMigrations } = await import(${JSON.stringify(join(workspace, "packages/db/src/migrate.ts"))}); const { runSeed } = await import(${JSON.stringify(join(workspace, "packages/db/src/seed.ts"))});
      const { db, usageEvents, tenantSkills, eq } = await import(${JSON.stringify(join(workspace, "packages/db/src/index.ts"))}); const { createTenant, issueApiKey } = await import(${JSON.stringify(join(workspace, "packages/db/src/tenancy.ts"))});
      await runMigrations(); await runSeed(); const first = await createTenant({ name: "Chat one", slug: "chat-one" }); const second = await createTenant({ name: "Chat two", slug: "chat-two" }); const firstKey = await issueApiKey(first.id); const secondKey = await issueApiKey(second.id);
      const { createServer } = await import(${JSON.stringify(join(workspace, "apps/agent/src/server.ts"))}); const app = createServer(); const auth = (key) => ({ Authorization: "Bearer " + key, "Content-Type": "application/json" });
      assert((await app.request("/api/v1/config", { method: "PUT", headers: auth(firstKey.raw), body: JSON.stringify({ openaiApiKeyEncrypted: "mock-openai-key" }) })).status === 200, "LLM config failed");
      let completions = 0; const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_url, init) => { completions++; const request = JSON.parse(init.body); assert(request.tools.some((tool) => tool.function.name === "createTask"), "active tool absent"); return new Response(JSON.stringify({ choices: [{ message: completions === 1 ? { content: null, tool_calls: [{ id: "tool-1", type: "function", function: { name: "createTask", arguments: JSON.stringify({ title: "via react" }) } }] } : { content: "created" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }), { headers: { "Content-Type": "application/json" } }); };
      const chat = await app.request("/api/v1/chat", { method: "POST", headers: auth(firstKey.raw), body: JSON.stringify({ message: "create a task" }) }); globalThis.fetch = originalFetch;
      assert(chat.status === 200, "ReAct chat failed"); const payload = await chat.json(); assert(payload.reply === "created" && payload.toolsExecuted.length === 1 && payload.toolsExecuted[0].result.success, "ReAct tool cycle failed: " + JSON.stringify(payload));
      assert((await app.request("/api/v1/conversations/" + payload.conversationId + "/messages", { headers: auth(secondKey.raw) })).status === 404, "foreign conversation visible");
      assert((await app.request("/api/v1/chat", { method: "POST", headers: auth(secondKey.raw), body: JSON.stringify({ message: "reuse", conversationId: payload.conversationId }) })).status === 404, "foreign conversation reuse accepted");
      const usage = await db.select().from(usageEvents).where(eq(usageEvents.tenantId, first.id)); assert(usage.filter((row) => row.type === "llm_tokens").length === 2 && usage.some((row) => row.type === "tool_call"), "usage events absent");
      const aggregate = await (await app.request("/api/admin/tenants/" + first.id + "/usage", { headers: { "X-Platform-Key": "phase13-admin-key" } })).json(); assert(aggregate.usage.some((row) => row.type === "llm_tokens" && row.events === 2), "usage aggregate incorrect");
      await db.update(tenantSkills).set({ isEnabled: false }).where(eq(tenantSkills.tenantId, second.id)); const skills = await (await app.request("/api/v1/skills", { headers: auth(secondKey.raw) })).json(); assert(skills.skills.every((skill) => !skill.isEnabled), "all skills not disabled");
      const disabled = await (await app.request("/api/v1/skills/test", { method: "POST", headers: auth(secondKey.raw), body: JSON.stringify({ toolName: "createTask", arguments: { title: "blocked" } }) })).json(); assert(!disabled.result.success && disabled.result.error.includes("disabled"), "disabled tool executed");
      console.log(JSON.stringify({ ok: true, usage: usage.length, completions }));
    `);
    try { expect(result.exitCode, stderr(result)).toBe(0); expect(jsonOutput(result)).toMatchObject({ ok: true, completions: 2 }); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
