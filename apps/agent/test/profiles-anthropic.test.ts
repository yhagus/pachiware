import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const src = (path: string) => JSON.stringify(join(workspace, path));

// Each scenario runs in its own process because the database dialect binds at import time.
function scenario(body: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-profiles-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const { runMigrations } = await import(${src("packages/db/src/migrate.ts")}); const { runSeed } = await import(${src("packages/db/src/seed.ts")});
        const { db, agentsConfig, eq } = await import(${src("packages/db/src/index.ts")}); const { createTenant, createBot } = await import(${src("packages/db/src/tenancy.ts")});
        await runMigrations(); await runSeed();
        const tenant = await createTenant({ name: "Images", slug: "images" });
        const { createServer } = await import(${src("apps/agent/src/server.ts")}); const app = createServer();
        const { llmRouter } = await import(${src("apps/agent/src/llm/router.ts")});
        const admin = { "X-Platform-Key": "profiles-admin-key", "Content-Type": "application/json" };
        const post = async (path, body) => app.request("/api/admin" + path, { method: "POST", headers: admin, body: JSON.stringify(body) });
        const patch = async (path, body) => app.request("/api/admin" + path, { method: "PATCH", headers: admin, body: JSON.stringify(body) });
        const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        const calls = []; let reply = () => json({});
        globalThis.fetch = async (url, init = {}) => { const call = { url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null }; calls.push(call); return reply(call); };
        ${body}
        console.log(JSON.stringify({ ok: true }));
      `],
      cwd: workspace,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "profiles.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 36).toString("base64"), PLATFORM_ADMIN_KEY: "profiles-admin-key", NODE_ENV: "test" },
    });
    return { code: result.exitCode, stderr: new TextDecoder().decode(result.stderr).trim() };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("Anthropic profiles and image input", () => {
  test("an Anthropic profile attached to a bot answers through the Messages API with the profile's key and model", () => {
    const { code, stderr } = scenario(`
      const created = await post("/tenants/" + tenant.id + "/profiles", { name: "Claude", provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-profile" });
      assert(created.status === 201, "anthropic profile rejected: " + created.status);
      const { profile } = await created.json();
      const bot = await createBot({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: profile.id });
      reply = () => json({ content: [{ type: "text", text: "hello from claude" }], usage: { input_tokens: 4, output_tokens: 3 } });
      const answer = await llmRouter.complete([{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id });
      const [call] = calls;
      assert(answer.content === "hello from claude", "answer not read: " + JSON.stringify(answer));
      assert(call.url === "https://api.anthropic.com/v1/messages" && call.headers["x-api-key"] === "sk-ant-profile" && call.headers["anthropic-version"], "wrong request: " + JSON.stringify(call));
      assert(call.body.model === "claude-sonnet-5-5" && call.body.system === "Be brief." && JSON.stringify(call.body.messages) === JSON.stringify([{ role: "user", content: "hi" }]), "wrong body: " + JSON.stringify(call.body));
      assert(!("temperature" in call.body), "current Claude models reject a non-default temperature");
    `);
    expect(code, stderr).toBe(0);
  });

  test("an Anthropic tenant default with no model uses Claude Sonnet 5.5, and the connection test pings Claude Haiku 5.5", () => {
    const { code, stderr } = scenario(`
      const { encryptSecret } = await import(${src("packages/db/src/index.ts")});
      const { LLMRouter } = await import(${src("apps/agent/src/llm/router.ts")});
      await db.update(agentsConfig).set({ defaultProvider: "anthropic", defaultModel: "", anthropicModel: null, anthropicApiKeyEncrypted: encryptSecret("sk-ant-default") }).where(eq(agentsConfig.tenantId, tenant.id));
      reply = () => json({ content: [{ type: "text", text: "hi" }] });
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id });
      assert(calls[0].body.model === "claude-sonnet-5-5", "default model wrong: " + calls[0].body.model);
      const tested = await LLMRouter.testAnthropic("sk-ant-check");
      assert(tested.success && calls[1].url === "https://api.anthropic.com/v1/messages" && calls[1].body.model === "claude-haiku-5-5", "connection test wrong: " + JSON.stringify(calls[1]));
    `);
    expect(code, stderr).toBe(0);
  });

  test("a profile's accepts-images flag is off by default and the admin API reads and writes it", () => {
    const { code, stderr } = scenario(`
      const plain = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Plain", provider: "openai", model: "gpt-x" })).json()).profile;
      assert(plain.acceptsImages === false, "flag not off by default: " + JSON.stringify(plain));
      const seeing = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Seeing", provider: "anthropic", model: "claude-opus-5-5", acceptsImages: true })).json()).profile;
      assert(seeing.acceptsImages === true, "flag not stored on create");
      const turnedOff = (await (await patch("/profiles/" + seeing.id, { acceptsImages: false })).json()).profile;
      assert(turnedOff.acceptsImages === false && turnedOff.model === "claude-opus-5-5", "flag not updated alone");
      assert((await patch("/profiles/" + plain.id, { acceptsImages: "yes" })).status === 400, "non-boolean flag accepted");
      const listed = (await (await app.request("/api/admin/tenants/" + tenant.id + "/profiles", { headers: admin })).json()).profiles;
      assert(listed.every((p) => p.acceptsImages === false), "list does not carry the flag: " + JSON.stringify(listed));
    `);
    expect(code, stderr).toBe(0);
  });

  test("model discovery for an Anthropic profile lists the models endpoint with Anthropic's headers", () => {
    const { code, stderr } = scenario(`
      reply = () => json({ data: [{ id: "claude-sonnet-5-5", capabilities: {} }, { id: "claude-haiku-5-5" }], has_more: false });
      const listed = await (await post("/profiles/models", { provider: "anthropic", apiKey: "sk-ant-typed" })).json();
      const [call] = calls;
      assert(JSON.stringify(listed.models) === '["claude-haiku-5-5","claude-sonnet-5-5"]', "models wrong: " + JSON.stringify(listed));
      assert(call.url.startsWith("https://api.anthropic.com/v1/models") && call.headers["x-api-key"] === "sk-ant-typed" && call.headers["anthropic-version"] && !call.headers.Authorization, "wrong request: " + JSON.stringify(call));
    `);
    expect(code, stderr).toBe(0);
  });

  test("the Test action sends text and then a tiny image in each provider's shape and reports both", () => {
    const { code, stderr } = scenario(`
      const run = async (body) => (await post("/profiles/test", body)).json();
      reply = (call) => call.url.endsWith("/messages") ? json({ content: [{ type: "text", text: "ok" }] }) : json({ choices: [{ message: { content: "ok" } }] });
      const claude = await run({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-typed" });
      assert(claude.text.ok && claude.image.ok, "anthropic probe not reported as working: " + JSON.stringify(claude));
      const [text, image] = calls;
      assert(text.url === "https://api.anthropic.com/v1/messages" && text.headers["x-api-key"] === "sk-ant-typed" && text.body.model === "claude-opus-5-5" && typeof text.body.messages[0].content === "string", "anthropic text probe wrong: " + JSON.stringify(text));
      const [block, prompt] = image.body.messages[0].content;
      assert(image.body.messages[0].role === "user" && block.type === "image" && block.source.type === "base64" && block.source.media_type === "image/png" && !block.source.data.startsWith("data:") && prompt.type === "text", "anthropic image block wrong: " + JSON.stringify(image.body));
      calls.length = 0;
      const gpt = await run({ provider: "custom", model: "vision-x", baseUrl: "https://llm.example/v1", apiKey: "proxy-key" });
      assert(gpt.text.ok && gpt.image.ok, "custom probe not reported as working: " + JSON.stringify(gpt));
      const part = calls[1].body.messages[0].content.find((p) => p.type === "image_url");
      assert(calls[1].url === "https://llm.example/v1/chat/completions" && calls[1].headers.Authorization === "Bearer proxy-key" && part.image_url.url.startsWith("data:image/png;base64,"), "openai-shaped image part wrong: " + JSON.stringify(calls[1]));
    `);
    expect(code, stderr).toBe(0);
  });

  test("the Test action reports text working and the image rejected separately, reusing the saved key", () => {
    const { code, stderr } = scenario(`
      const saved = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Text only", provider: "openai", model: "gpt-text", apiKey: "saved-key" })).json()).profile;
      reply = (call) => Array.isArray(call.body.messages[0].content) ? json({ error: { message: "image_url is only supported by certain models" } }, 400) : json({ choices: [{ message: { content: "ok" } }] });
      const result = await (await post("/profiles/test", { provider: "openai", model: "gpt-text", profileId: saved.id })).json();
      assert(result.text.ok === true && result.image.ok === false && result.image.message, "rejection not reported separately: " + JSON.stringify(result));
      assert(calls.every((c) => c.headers.Authorization === "Bearer saved-key" && c.url === "https://api.openai.com/v1/chat/completions"), "saved key not reused");
      calls.length = 0; reply = () => json({ error: { message: "bad key" } }, 401);
      const denied = await (await post("/profiles/test", { provider: "openai", model: "gpt-text", apiKey: "wrong" })).json();
      assert(denied.text.ok === false && denied.image.ok === false && calls.length === 1, "image tried after text failed: " + JSON.stringify(denied));
    `);
    expect(code, stderr).toBe(0);
  });

  test("image capability follows the bot's profile flag, and an Anthropic tenant default asks the models endpoint", () => {
    const { code, stderr } = scenario(`
      const { encryptSecret } = await import(${src("packages/db/src/index.ts")});
      const make = async (body) => (await (await post("/tenants/" + tenant.id + "/profiles", { provider: "openai", model: "gpt-x", ...body })).json()).profile;
      const seeing = await createBot({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: (await make({ name: "Seeing", acceptsImages: true })).id });
      const blind = await createBot({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: (await make({ name: "Blind" })).id });
      const plain = await createBot({ tenantId: tenant.id, token: "t", isEnabled: false });
      assert(await llmRouter.acceptsImages(tenant.id, seeing.id) === true && await llmRouter.acceptsImages(tenant.id, blind.id) === false, "profile flag not followed");
      assert(await llmRouter.acceptsImages(tenant.id, plain.id) === false && calls.length === 0, "an OpenAI tenant default has no declared image input");

      const other = await createTenant({ name: "Default", slug: "default-anthropic" });
      await db.update(agentsConfig).set({ defaultProvider: "anthropic", defaultModel: "claude-text-only", anthropicApiKeyEncrypted: encryptSecret("sk-ant-other") }).where(eq(agentsConfig.tenantId, other.id));
      reply = (call) => json({ id: call.url.split("/").pop(), capabilities: { image_input: { supported: call.url.endsWith("claude-opus-5-5") } } });
      assert(await llmRouter.acceptsImages(other.id) === false, "unsupported image input reported as accepted");
      calls.length = 0;
      const fresh = await createTenant({ name: "Fresh", slug: "fresh-anthropic" });
      await db.update(agentsConfig).set({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", anthropicApiKeyEncrypted: encryptSecret("sk-ant-fresh") }).where(eq(agentsConfig.tenantId, fresh.id));
      assert(await llmRouter.acceptsImages(fresh.id) === true, "models endpoint capability not used");
      const [call] = calls;
      assert(call.method === "GET" && call.url === "https://api.anthropic.com/v1/models/claude-opus-5-5" && call.headers["x-api-key"] === "sk-ant-fresh" && call.headers["anthropic-version"], "wrong models request: " + JSON.stringify(call));
      await llmRouter.acceptsImages(fresh.id);
      assert(calls.length === 1, "capability looked up again instead of cached");
      reply = () => json({ content: [{ type: "text", text: "hi" }] });
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: fresh.id });
      assert(calls[1].url === "https://api.anthropic.com/v1/messages" && calls[1].body.model === "claude-opus-5-5", "chat and capability lookup disagree on the model: " + JSON.stringify(calls[1]));
      reply = () => json({ error: { message: "nope" } }, 500);
      const broken = await createTenant({ name: "Broken", slug: "broken-anthropic" });
      await db.update(agentsConfig).set({ defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", anthropicApiKeyEncrypted: encryptSecret("sk-ant-broken") }).where(eq(agentsConfig.tenantId, broken.id));
      assert(await llmRouter.acceptsImages(broken.id) === false, "a failed lookup must not claim image input");
    `);
    expect(code, stderr).toBe(0);
  });
});
