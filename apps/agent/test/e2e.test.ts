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
      const issue = async () => { const res = await request("/api/admin/api-keys", { method: "POST", headers: admin, body: JSON.stringify({ name: "test" }) }); assert(res.status === 201, "key issuance failed"); return body(res); };
      const firstKey = await issue(); const secondKey = await issue();
      const link = async (tenant, key) => { const res = await request("/api/admin/tenants", { method: "POST", headers: admin, body: JSON.stringify({ name: tenant.name + " owned", slug: tenant.slug + "-owned", apiKeyId: key.keyId }) }); assert(res.status === 201, "owned tenant failed"); return (await body(res)).tenant; };
      const firstOwned = await link(first, firstKey); const secondOwned = await link(second, secondKey);
      const auth = (key, tenant) => ({ Authorization: "Bearer " + key, "Content-Type": "application/json", ...(tenant ? { "X-Tenant-Id": tenant.id } : {}) });
      assert((await request("/api/admin/tenants")).status === 401, "admin key required");
      assert((await request("/api/v1/tasks")).status === 401, "tenant key required");
      assert((await request("/api/v1/tasks", { headers: auth("bad", firstOwned) })).status === 401, "bad key rejected");
      assert((await request("/api/v1/tasks", { headers: auth(firstKey.raw) })).status === 400, "tenant header required");
      assert((await request("/api/v1/tasks", { headers: auth(firstKey.raw, secondOwned) })).status === 404, "foreign tenant rejected");
      assert((await request("/api/v1/tasks", { headers: auth(firstKey.raw, first) })).status === 404, "unowned tenant rejected");
      const viaSlug = await request("/api/v1/tasks", { headers: { ...auth(firstKey.raw), "X-Tenant-Id": firstOwned.slug } }); assert(viaSlug.status === 200, "tenant slug header failed");
      const keyTenants = await body(await request("/api/v1/tenants", { headers: auth(firstKey.raw, firstOwned) })); assert(keyTenants.tenants.length === 1 && keyTenants.tenants[0].id === firstOwned.id, "key tenant list wrong");
      const made = await request("/api/v1/tenants", { method: "POST", headers: auth(firstKey.raw, firstOwned), body: JSON.stringify({ name: "From key", slug: "from-key" }) }); assert(made.status === 201 && (await body(made)).tenant.apiKeyId === firstKey.keyId, "key-created tenant not owned");
      assert((await request("/api/v1/tenants", { method: "POST", headers: auth(firstKey.raw, firstOwned), body: JSON.stringify({ name: "Dupe", slug: "from-key" }) })).status === 409, "duplicate slug accepted");
      const created = await request("/api/v1/tasks", { method: "POST", headers: auth(firstKey.raw, firstOwned), body: JSON.stringify({ title: "private deploy", priority: "high" }) });
      assert(created.status === 201, "task creation failed"); const task = (await body(created)).task;
      const { workspaceStore } = await import(${JSON.stringify(join(workspace, "packages/skills/src/workspace/store.ts"))});
      const apiFiles = (await workspaceStore().list(firstOwned.id, "shared/tasks")).filter((entry) => !entry.path.endsWith("/.name"));
      assert(apiFiles.length === 1 && apiFiles[0].type === "file", "REST task was not written to Workspace files");
      const apiFile = await workspaceStore().read(firstOwned.id, apiFiles[0].path);
      assert(apiFile?.content.includes('title: "private deploy"') && apiFile.content.includes('priority: "high"'), "REST task file shape is wrong");
      const secondList = await body(await request("/api/v1/tasks?search=private", { headers: auth(secondKey.raw, secondOwned) }));
      assert(secondList.tasks.length === 0 && secondList.counts.total === 0, "task crossed tenant boundary");
      assert((await request("/api/v1/tasks/" + task.id, { method: "PATCH", headers: auth(secondKey.raw, secondOwned), body: JSON.stringify({ status: "completed" }) })).status === 404, "foreign task update rejected");
      assert((await request("/api/v1/tasks/" + task.id, { method: "PATCH", headers: auth(firstKey.raw, firstOwned), body: JSON.stringify({ status: "completed" }) })).status === 200, "task update failed");
      const list = await body(await request("/api/v1/tasks?search=private", { headers: auth(firstKey.raw, firstOwned) }));
      assert(list.tasks.length === 1 && list.counts.completed === 1, "tenant task search/counts failed");
      const afterPatch = await workspaceStore().read(firstOwned.id, apiFiles[0].path);
      assert(afterPatch?.content.includes('status: "completed"'), "REST update did not update the Workspace file");
      assert((await request("/api/v1/tasks/" + task.id, { method: "DELETE", headers: auth(firstKey.raw, firstOwned) })).status === 200, "task delete failed");
      assert((await request("/api/admin/api-keys/" + firstKey.keyId, { method: "DELETE", headers: admin })).status === 200, "key revoke failed");
      assert((await request("/api/v1/tasks", { headers: auth(firstKey.raw, firstOwned) })).status === 401, "revoked key accepted");
      const configPut = await request("/api/v1/config", { method: "PUT", headers: auth(secondKey.raw, secondOwned), body: JSON.stringify({ openaiApiKeyEncrypted: "tenant-secret", defaultModel: "tenant-model" }) });
      assert(configPut.status === 200, "config update failed");
      const config = await body(await request("/api/v1/config", { headers: auth(secondKey.raw, secondOwned) }));
      assert(config.config.openaiApiKeyEncrypted === "••••••••", "config secret exposed");
      const [stored] = await db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, secondOwned.id));
      assert(stored.openaiApiKeyEncrypted !== "tenant-secret" && stored.openaiApiKeyEncrypted.startsWith("v1:"), "config secret not encrypted");
      const botRes = await request("/api/v1/bots", { method: "POST", headers: auth(secondKey.raw, secondOwned), body: JSON.stringify({ name: "test bot", token: "bot-secret", isEnabled: false }) });
      assert(botRes.status === 201, "bot creation failed"); const bot = (await body(botRes)).bot;
      assert(!JSON.stringify(bot).includes("bot-secret"), "bot secret exposed");
      assert((await request("/api/v1/bots/" + bot.id, { method: "PATCH", headers: auth(secondKey.raw, secondOwned), body: JSON.stringify({ name: "updated" }) })).status === 200, "bot update failed");
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ id: "discord-user", username: "mock" }), { status: 200, headers: { "Content-Type": "application/json" } });
      assert((await request("/api/v1/bots/" + bot.id + "/test", { method: "POST", headers: auth(secondKey.raw, secondOwned), body: JSON.stringify({}) })).status === 200, "bot token test failed"); globalThis.fetch = originalFetch;
      assert((await request("/api/v1/bots/" + bot.id + "/restart", { method: "POST", headers: auth(secondKey.raw, secondOwned) })).status === 200, "bot restart failed");
      assert((await request("/api/v1/bots/" + bot.id, { method: "DELETE", headers: auth(secondKey.raw, secondOwned) })).status === 200, "bot delete failed");
      assert(calls.some(([name]) => name === "restart") && calls.some(([name]) => name === "remove"), "bot manager was not called");
      assert((await request("/api/admin/tenants/" + secondOwned.id, { method: "PATCH", headers: admin, body: JSON.stringify({ status: "suspended" }) })).status === 200, "tenant suspend failed");
      assert((await request("/api/v1/tasks", { headers: auth(secondKey.raw, secondOwned) })).status === 403, "suspended tenant accepted");
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
      const { db, usageEvents, tenantSkills, bots, eq, repositories } = await import(${JSON.stringify(join(workspace, "packages/db/src/index.ts"))});
      await runMigrations(); await runSeed(); const first = await repositories().tenants.create({ name: "Chat one", slug: "chat-one" }); const second = await repositories().tenants.create({ name: "Chat two", slug: "chat-two" }); const firstKey = await repositories().tenants.issueApiKey("one"); const secondKey = await repositories().tenants.issueApiKey("two"); await repositories().tenants.linkApiKey(first.id, firstKey.keyId); await repositories().tenants.linkApiKey(second.id, secondKey.keyId);
      const { createServer } = await import(${JSON.stringify(join(workspace, "apps/agent/src/server.ts"))}); const app = createServer(); const auth = (key, tenant) => ({ Authorization: "Bearer " + key, "Content-Type": "application/json", "X-Tenant-Id": tenant.id });
      assert((await app.request("/api/v1/config", { method: "PUT", headers: auth(firstKey.raw, first), body: JSON.stringify({ openaiApiKeyEncrypted: "mock-openai-key" }) })).status === 200, "LLM config failed");
      let completions = 0; const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_url, init) => { completions++; const request = JSON.parse(init.body); assert(request.tools.some((tool) => tool.function.name === "createTask"), "active tool absent"); return new Response(JSON.stringify({ choices: [{ message: completions === 1 ? { content: null, tool_calls: [{ id: "tool-1", type: "function", function: { name: "createTask", arguments: JSON.stringify({ title: "via react" }) } }] } : { content: "created" } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }), { headers: { "Content-Type": "application/json" } }); };
      const chat = await app.request("/api/v1/chat", { method: "POST", headers: auth(firstKey.raw, first), body: JSON.stringify({ message: "create a task" }) }); globalThis.fetch = originalFetch;
      assert(chat.status === 200, "ReAct chat failed"); const payload = await chat.json(); assert(payload.reply === "created" && payload.toolsExecuted.length === 1 && payload.toolsExecuted[0].result.success, "ReAct tool cycle failed: " + JSON.stringify(payload));
      assert((await app.request("/api/v1/conversations/" + payload.conversationId + "/messages", { headers: auth(secondKey.raw, second) })).status === 404, "foreign conversation visible");
      assert((await app.request("/api/v1/chat", { method: "POST", headers: auth(secondKey.raw, second), body: JSON.stringify({ message: "reuse", conversationId: payload.conversationId }) })).status === 404, "foreign conversation reuse accepted");
      const usage = await db.select().from(usageEvents).where(eq(usageEvents.tenantId, first.id)); assert(usage.filter((row) => row.type === "llm_tokens").length === 2 && usage.some((row) => row.type === "tool_call"), "usage events absent");
      const aggregate = await (await app.request("/api/admin/tenants/" + first.id + "/usage", { headers: { "X-Platform-Key": "phase13-admin-key" } })).json(); assert(aggregate.usage.some((row) => row.type === "llm_tokens" && row.events === 2), "usage aggregate incorrect");
      await db.update(tenantSkills).set({ isEnabled: false }).where(eq(tenantSkills.tenantId, second.id)); const skills = await (await app.request("/api/v1/skills", { headers: auth(secondKey.raw, second) })).json(); assert(skills.skills.every((skill) => !skill.isEnabled), "all skills not disabled");
      const disabled = await (await app.request("/api/v1/skills/test", { method: "POST", headers: auth(secondKey.raw, second), body: JSON.stringify({ toolName: "createTask", arguments: { title: "blocked" } }) })).json(); assert(!disabled.result.success && disabled.result.error.includes("disabled"), "disabled tool executed");
      // Profiles: a bot's profile overrides the tenant default model/provider/key for that bot only, and cannot cross tenants.
      const admin = { "X-Platform-Key": "phase13-admin-key", "Content-Type": "application/json" };
      const mk = async (tenant, body) => (await (await app.request("/api/admin/tenants/" + tenant.id + "/profiles", { method: "POST", headers: admin, body: JSON.stringify(body) })).json()).profile;
      const profile = await mk(first, { name: "Custom", provider: "custom", model: "my-model", baseUrl: "https://llm.example/v1", apiKey: "profile-secret" });
      assert(profile.hasApiKey && !("apiKeyEncrypted" in profile), "profile key exposed");
      assert((await app.request("/api/admin/tenants/" + first.id + "/profiles", { method: "POST", headers: admin, body: JSON.stringify({ name: "x", provider: "custom", model: "m" }) })).status === 400, "custom profile without baseUrl accepted");
      assert((await app.request("/api/admin/tenants/" + first.id + "/profiles", { method: "POST", headers: admin, body: JSON.stringify({ name: "x", provider: "gemini", model: "m" }) })).status === 400, "unsupported provider accepted");
      const foreign = await mk(second, { name: "Theirs", provider: "openai", model: "gpt-x" });
      const botRes = await app.request("/api/v1/bots", { method: "POST", headers: auth(firstKey.raw, first), body: JSON.stringify({ name: "p-bot", token: "t", isEnabled: false, profileId: profile.id }) });
      assert(botRes.status === 201 && (await botRes.json()).bot.profileId === profile.id, "bot profile not saved");
      assert((await app.request("/api/v1/bots", { method: "POST", headers: auth(firstKey.raw, first), body: JSON.stringify({ name: "bad", token: "t", isEnabled: false, profileId: foreign.id }) })).status === 400, "foreign profile accepted");
      const [profiled] = await db.select().from(bots).where(eq(bots.name, "p-bot"));
      let seen; globalThis.fetch = async (url, init) => { seen = { url: String(url), auth: init.headers.Authorization, model: JSON.parse(init.body).model }; return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "Content-Type": "application/json" } }); };
      const { llmRouter } = await import(${JSON.stringify(join(workspace, "apps/agent/src/llm/router.ts"))});
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: first.id, botId: profiled.id });
      assert(seen.url === "https://llm.example/v1/chat/completions" && seen.model === "my-model" && seen.auth === "Bearer profile-secret", "profile not used: " + JSON.stringify(seen));
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: first.id });
      assert(seen.url.startsWith("https://api.openai.com") && seen.model !== "my-model", "tenant default not used without bot");
      assert((await app.request("/api/admin/profiles/" + profile.id, { method: "DELETE", headers: admin })).status === 200, "profile delete failed");
      const [after] = await db.select().from(bots).where(eq(bots.id, profiled.id)); assert(after.profileId === null, "bot not reset to default on profile delete");
      // Model discovery: GET <baseUrl>/models with the key, server-side; blank key reuses the saved profile's key.
      const modelsPost = (body) => app.request("/api/admin/profiles/models", { method: "POST", headers: admin, body: JSON.stringify(body) });
      let modelsAuth; globalThis.fetch = async (url, init) => { modelsAuth = { url: String(url), auth: init.headers.Authorization }; return String(url).includes("bad.example") ? new Response("no", { status: 401 }) : new Response(JSON.stringify({ data: [{ id: "zeta" }, { id: "alpha" }, { id: "alpha" }] }), { headers: { "Content-Type": "application/json" } }); };
      const listed = await (await modelsPost({ provider: "custom", baseUrl: "https://llm.example/v1/", apiKey: "typed-key" })).json();
      assert(JSON.stringify(listed.models) === '["alpha","zeta"]' && modelsAuth.url === "https://llm.example/v1/models" && modelsAuth.auth === "Bearer typed-key", "model list wrong: " + JSON.stringify([listed, modelsAuth]));
      const saved = await mk(first, { name: "Saved", provider: "custom", model: "m", baseUrl: "https://llm.example/v1", apiKey: "saved-key" });
      await modelsPost({ provider: "custom", baseUrl: "https://llm.example/v1", profileId: saved.id }); assert(modelsAuth.auth === "Bearer saved-key", "saved key not reused");
      assert((await modelsPost({ provider: "custom", baseUrl: "https://bad.example/v1", apiKey: "k" })).status === 502, "provider error not surfaced");
      assert((await modelsPost({ provider: "custom" })).status === 400, "custom without base URL accepted");
      assert((await modelsPost({ provider: "gemini", baseUrl: "https://x" })).status === 400, "unsupported provider accepted");
      globalThis.fetch = originalFetch;
      console.log(JSON.stringify({ ok: true, usage: usage.length, completions }));
    `);
    try { expect(result.exitCode, stderr(result)).toBe(0); expect(jsonOutput(result)).toMatchObject({ ok: true, completions: 2 }); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
