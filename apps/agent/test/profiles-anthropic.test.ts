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
        const { repositories } = await import(${src("packages/db/src/index.ts")});
        await runMigrations(); await runSeed();
        const tenant = await repositories().tenants.create({ name: "Images", slug: "images" });
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
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: profile.id });
      reply = () => json({ content: [{ type: "text", text: "hello from claude" }], usage: { input_tokens: 4, output_tokens: 3 } });
      const answer = await llmRouter.complete([{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id });
      const [call] = calls;
      assert(answer.content === "hello from claude", "answer not read: " + JSON.stringify(answer));
      assert(call.url === "https://api.anthropic.com/v1/messages" && call.headers["x-api-key"] === "sk-ant-profile" && call.headers["anthropic-version"], "wrong request: " + JSON.stringify(call));
      assert(call.body.model === "claude-sonnet-5-5" && JSON.stringify(call.body.system) === JSON.stringify([{ type: "text", text: "Be brief.", cache_control: { type: "ephemeral" } }]) && JSON.stringify(call.body.messages) === JSON.stringify([{ role: "user", content: "hi" }]), "wrong body: " + JSON.stringify(call.body));
      assert(!("temperature" in call.body), "current Claude models reject a non-default temperature");
    `);
    expect(code, stderr).toBe(0);
  });

  test("an Anthropic tenant default with no model uses Claude Sonnet 5.5, and the connection test pings Claude Haiku 5.5", () => {
    const { code, stderr } = scenario(`
      const { encryptSecret } = await import(${src("packages/db/src/index.ts")});
      const { LLMRouter } = await import(${src("apps/agent/src/llm/router.ts")});
      await repositories().agentConfig.update(tenant.id, { defaultProvider: "anthropic", defaultModel: "", anthropicModel: null, anthropicApiKeyEncrypted: encryptSecret("sk-ant-default") });
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
  }, 30_000);

  test("the Test checklist lists models, then sends text and a tiny image in each provider's shape, and reports every step", () => {
    const { code, stderr } = scenario(`
      const run = async (body) => (await post("/profiles/test", body)).json();
      const said = (call, text) => call.url.endsWith("/messages") ? json({ content: [{ type: "text", text }] }) : json({ choices: [{ message: { content: text } }] });
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "claude-opus-5-5" }, { id: "vision-x" }] }) : said(call, Array.isArray(call.body.messages[0].content) ? "Red." : "OK");
      const claude = await run({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-typed" });
      assert(claude.success && Object.values(claude.checks).every((c) => c.status === "ok"), "anthropic checklist not all ok: " + JSON.stringify(claude));
      assert(claude.checks.text.reply === "OK" && claude.checks.image.reply === "Red.", "replies not shown: " + JSON.stringify(claude.checks));
      const [models, text, image] = calls;
      assert(models.method === "GET" && models.url.startsWith("https://api.anthropic.com/v1/models") && models.headers["x-api-key"] === "sk-ant-typed", "models request wrong: " + JSON.stringify(models));
      assert(text.url === "https://api.anthropic.com/v1/messages" && text.headers["x-api-key"] === "sk-ant-typed" && text.body.model === "claude-opus-5-5" && typeof text.body.messages[0].content === "string", "anthropic text probe wrong: " + JSON.stringify(text));
      const [block, prompt] = image.body.messages[0].content;
      assert(image.body.messages[0].role === "user" && block.type === "image" && block.source.type === "base64" && block.source.media_type === "image/png" && !block.source.data.startsWith("data:") && prompt.type === "text", "anthropic image block wrong: " + JSON.stringify(image.body));
      calls.length = 0;
      const gpt = await run({ provider: "custom", model: "vision-x", baseUrl: "https://llm.example/v1", apiKey: "proxy-key" });
      assert(gpt.success && gpt.checks.image.status === "ok", "custom checklist not ok: " + JSON.stringify(gpt));
      const part = calls[2].body.messages[0].content.find((p) => p.type === "image_url");
      assert(calls[2].url === "https://llm.example/v1/chat/completions" && calls[2].headers.Authorization === "Bearer proxy-key" && part.image_url.url.startsWith("data:image/png;base64,"), "openai-shaped image part wrong: " + JSON.stringify(calls[2]));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("the Test checklist reports the image rejected separately, reuses the saved key, and stops at a refused key", () => {
    const { code, stderr } = scenario(`
      const saved = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Text only", provider: "openai", model: "gpt-text", apiKey: "saved-key" })).json()).profile;
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "gpt-text" }] }) : Array.isArray(call.body.messages[0].content) ? json({ error: { message: "image_url is only supported by certain models" } }, 400) : json({ choices: [{ message: { content: "OK" } }] });
      const result = await (await post("/profiles/test", { provider: "openai", model: "gpt-text", profileId: saved.id })).json();
      assert(result.success && result.checks.text.status === "ok" && result.checks.image.status === "failed" && result.checks.image.message.includes("image_url is only supported"), "rejection not reported separately: " + JSON.stringify(result));
      assert(calls.every((c) => c.headers.Authorization === "Bearer saved-key" && c.url.startsWith("https://api.openai.com/v1/")), "saved key not reused");
      calls.length = 0; reply = () => json({ error: { message: "Incorrect API key provided" } }, 401);
      const denied = await (await post("/profiles/test", { provider: "openai", model: "gpt-text", apiKey: "wrong" })).json();
      const { url, key, model, text, image } = denied.checks;
      assert(!denied.success && url.status === "ok" && key.status === "failed" && key.message.includes("Incorrect API key"), "refused key not reported on the key step: " + JSON.stringify(denied));
      assert([model, text, image].every((c) => c.status === "skipped") && calls.length === 1, "steps after a refused key were tried: " + JSON.stringify(denied));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("the Test checklist tells an unreachable host apart from a server that answers in the wrong format", () => {
    const { code, stderr } = scenario(`
      globalThis.fetch = async (url) => { calls.push(String(url)); throw new TypeError("fetch failed"); };
      const down = await (await post("/profiles/test", { provider: "custom", model: "m", baseUrl: "http://127.0.0.1:9/v1" })).json();
      assert(!down.success && down.checks.url.status === "failed" && down.checks.url.message.includes("127.0.0.1:9") && calls.length === 1, "unreachable host not reported on the URL step: " + JSON.stringify(down));
      assert(["key", "model", "text", "image"].every((k) => down.checks[k].status === "skipped"), "steps after an unreachable host were not skipped");
      calls.length = 0;
      globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("<html>Welcome</html>", { status: 200, headers: { "Content-Type": "text/html" } }); };
      const website = await (await post("/profiles/test", { provider: "custom", model: "m", baseUrl: "https://example.com" })).json();
      const { url, key, text, image } = website.checks;
      assert(!website.success && url.status === "ok" && key.status === "skipped" && text.status === "failed" && text.message.includes("format"), "a 200 HTML page passed as a model: " + JSON.stringify(website));
      assert(image.status === "skipped" && calls.length === 2, "image tried after text failed");
      globalThis.fetch = async () => new Response("Not Found", { status: 404 });
      const wrongPath = await (await post("/profiles/test", { provider: "custom", model: "m", baseUrl: "https://llm.example" })).json();
      assert(wrongPath.checks.text.status === "failed" && wrongPath.checks.text.message.includes("Failed (404).") && wrongPath.checks.text.message.includes("/v1"), "a 404 gives no hint: " + JSON.stringify(wrongPath.checks.text));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("the Test checklist flags an unlisted model, a reply that ignores the instruction, and a wrong image colour, and confirms the key by text when there is no model list", () => {
    const { code, stderr } = scenario(`
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "gpt-a" }, { id: "gpt-b" }] }) : json({ choices: [{ message: { content: Array.isArray(call.body.messages[0].content) ? "Blue" : "Sure! How can I help?" } }] });
      const odd = await (await post("/profiles/test", { provider: "openai", model: "gpt-typo", apiKey: "k" })).json();
      assert(odd.success && odd.checks.model.status === "warning" && odd.checks.model.message.includes("2 models"), "unlisted model not flagged: " + JSON.stringify(odd.checks.model));
      assert(odd.checks.text.status === "warning" && odd.checks.text.reply === "Sure! How can I help?", "ignored instruction not flagged: " + JSON.stringify(odd.checks.text));
      assert(odd.checks.image.status === "failed" && odd.checks.image.message.includes("Blue"), "wrong colour accepted: " + JSON.stringify(odd.checks.image));
      reply = (call) => call.method === "GET" ? json({ error: { message: "not found" } }, 404) : json({ choices: [{ message: { content: "OK" } }] });
      const bare = await (await post("/profiles/test", { provider: "custom", model: "local", baseUrl: "http://ollama.local/v1" })).json();
      assert(bare.success && bare.checks.key.status === "ok" && bare.checks.model.status === "ok" && bare.checks.model.message.includes("text"), "key and model not confirmed by the text request: " + JSON.stringify(bare.checks));
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "o-think" }] }) : json({ choices: [{ message: { content: null }, finish_reason: "length" }] });
      const empty = await (await post("/profiles/test", { provider: "openai", model: "o-think", apiKey: "k" })).json();
      assert(!empty.success && empty.checks.text.status === "failed" && empty.checks.text.message.includes("length"), "empty reply passed: " + JSON.stringify(empty.checks.text));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("the Playground sends a prompt with an optional system prompt in each provider's shape and returns the reply, timing, and tokens", () => {
    const { code, stderr } = scenario(`
      const saved = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Claude", provider: "anthropic", model: "claude-haiku-5-5", apiKey: "sk-ant-saved" })).json()).profile;
      reply = () => json({ content: [{ type: "text", text: "Halo!" }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 3 } });
      const claude = await (await post("/profiles/playground", { provider: "anthropic", model: "claude-haiku-5-5", profileId: saved.id, system: "Answer in Indonesian.", prompt: "Say hello" })).json();
      assert(!("ok" in claude) && claude.success && claude.reply === "Halo!" && claude.finishReason === "end_turn" && claude.usage.input === 12 && claude.usage.output === 3 && typeof claude.ms === "number", "anthropic playground reply wrong: " + JSON.stringify(claude));
      assert(calls[0].body.system === "Answer in Indonesian." && calls[0].body.messages.length === 1 && calls[0].headers["x-api-key"] === "sk-ant-saved", "anthropic system prompt or key wrong: " + JSON.stringify(calls[0]));
      calls.length = 0;
      reply = () => json({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 1 } });
      const gpt = await (await post("/profiles/playground", { provider: "openai", model: "gpt-x", apiKey: "k", system: "Be brief.", prompt: "Say hello" })).json();
      assert(gpt.success && gpt.reply === "hi" && gpt.usage.output === 1, "openai playground reply wrong: " + JSON.stringify(gpt));
      assert(JSON.stringify(calls[0].body.messages) === JSON.stringify([{ role: "system", content: "Be brief." }, { role: "user", content: "Say hello" }]), "openai system prompt wrong: " + JSON.stringify(calls[0].body));
      reply = () => json({ error: { message: "model gpt-x does not exist" } }, 404);
      const missing = await (await post("/profiles/playground", { provider: "openai", model: "gpt-x", apiKey: "k", prompt: "hi" })).json();
      assert(missing.success === false && missing.error.includes("does not exist") && missing.status === 404, "provider error not passed through: " + JSON.stringify(missing));
      assert((await post("/profiles/playground", { provider: "openai", model: "gpt-x", apiKey: "k", prompt: "  " })).status === 400, "blank prompt accepted");
    `);
    expect(code, stderr).toBe(0);
  });

  test("a BYOK profile stores its API format, Chat Completions by default, and rejects an unknown one", () => {
    const { code, stderr } = scenario(`
      const plain = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Plain", provider: "custom", model: "m", baseUrl: "https://llm.example/v1" })).json()).profile;
      assert(plain.apiFormat === "chat_completions", "default format wrong: " + JSON.stringify(plain));
      const changed = (await (await patch("/profiles/" + plain.id, { apiFormat: "responses" })).json()).profile;
      assert(changed.apiFormat === "responses" && changed.model === "m", "format not updated alone: " + JSON.stringify(changed));
      assert((await patch("/profiles/" + plain.id, { apiFormat: "completions" })).status === 400, "unknown format accepted");
      assert((await post("/profiles/test", { provider: "custom", apiFormat: "soap", model: "m", baseUrl: "https://llm.example/v1" })).status === 400, "unknown format accepted by Test");
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("a BYOK profile on the Responses format sends the conversation and flat tools to /responses and reads text, tool calls, and usage back", () => {
    const { code, stderr } = scenario(`
      const profile = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Responses", provider: "custom", apiFormat: "responses", model: "gpt-r", baseUrl: "https://llm.example/v1", apiKey: "byok-key" })).json()).profile;
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: profile.id });
      reply = () => json({ object: "response", status: "completed", output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checking." }] }, { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' }], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, input_tokens_details: { cached_tokens: 8 } } });
      const tools = [{ name: "lookup", description: "Look up", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }];
      const history = [
        { role: "system", content: "Be brief." },
        { role: "user", content: [{ type: "text", text: "what is this" }, { type: "image", mediaType: "image/png", data: "AAAA" }] },
        { role: "assistant", content: "Let me look.", toolCalls: [{ id: "call_0", name: "lookup", arguments: { q: "y" } }] },
        { role: "tool", toolCallId: "call_0", content: "found y" },
      ];
      const answer = await llmRouter.complete(history, { tenantId: tenant.id, botId: bot.id, tools });
      const [call] = calls;
      assert(call.url === "https://llm.example/v1/responses" && call.headers.Authorization === "Bearer byok-key", "wrong request: " + JSON.stringify(call));
      assert(call.body.model === "gpt-r" && call.body.store === false && call.body.max_output_tokens > 0 && !("messages" in call.body), "wrong body: " + JSON.stringify(call.body));
      const expected = [
        { role: "system", content: "Be brief." },
        { role: "user", content: [{ type: "input_text", text: "what is this" }, { type: "input_image", image_url: "data:image/png;base64,AAAA" }] },
        { role: "assistant", content: "Let me look." },
        { type: "function_call", call_id: "call_0", name: "lookup", arguments: '{"q":"y"}' },
        { type: "function_call_output", call_id: "call_0", output: "found y" },
      ];
      assert(JSON.stringify(call.body.input) === JSON.stringify(expected), "wrong input: " + JSON.stringify(call.body.input));
      assert(JSON.stringify(call.body.tools) === JSON.stringify([{ type: "function", name: "lookup", description: "Look up", parameters: tools[0].parameters, strict: false }]), "wrong tools: " + JSON.stringify(call.body.tools));
      assert(answer.content === "Checking." && answer.finishReason === "tool_calls" && JSON.stringify(answer.toolCalls) === JSON.stringify([{ id: "call_1", name: "lookup", arguments: { q: "x" } }]), "answer not read: " + JSON.stringify(answer));
      assert(answer.usage.promptTokens === 20 && answer.usage.completionTokens === 5 && answer.usage.cachedTokens === 8, "usage not read: " + JSON.stringify(answer.usage));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("a BYOK profile on the Messages format answers through <base URL>/messages with both key headers", () => {
    const { code, stderr } = scenario(`
      const profile = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Proxy", provider: "custom", apiFormat: "messages", model: "claude-proxy", baseUrl: "https://proxy.example/v1", apiKey: "proxy-key" })).json()).profile;
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: profile.id });
      reply = () => json({ content: [{ type: "text", text: "hello via proxy" }], usage: { input_tokens: 4, output_tokens: 3 } });
      const answer = await llmRouter.complete([{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id });
      const [call] = calls;
      assert(answer.content === "hello via proxy", "answer not read: " + JSON.stringify(answer));
      assert(call.url === "https://proxy.example/v1/messages" && call.headers["x-api-key"] === "proxy-key" && call.headers.Authorization === "Bearer proxy-key" && call.headers["anthropic-version"], "wrong request: " + JSON.stringify(call));
      assert(call.body.model === "claude-proxy" && call.body.system[0].text === "Be brief.", "wrong body: " + JSON.stringify(call.body));
    `);
    expect(code, stderr).toBe(0);
  });

  test("Test and Playground follow the API format, and a reply in another format names the format to pick", () => {
    const { code, stderr } = scenario(`
      const responsesAnswer = (text) => json({ object: "response", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 3, output_tokens: 1 } });
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "gpt-r" }] }) : responsesAnswer(JSON.stringify(call.body).includes("image") ? "Red" : "OK");
      const byok = { provider: "custom", apiFormat: "responses", model: "gpt-r", baseUrl: "https://llm.example/v1", apiKey: "k" };
      const checked = await (await post("/profiles/test", byok)).json();
      assert(checked.success && Object.values(checked.checks).every((c) => c.status === "ok"), "responses checklist not ok: " + JSON.stringify(checked));
      assert(calls[1].url === "https://llm.example/v1/responses" && calls[1].body.store === false && calls[2].body.input[0].content.some((p) => p.type === "input_image"), "responses probe wrong: " + JSON.stringify(calls.slice(1)));
      const tried = await (await post("/profiles/playground", { ...byok, system: "Be brief.", prompt: "hi" })).json();
      assert(tried.success && tried.reply === "OK" && tried.usage.input === 3 && tried.finishReason === "completed", "responses playground wrong: " + JSON.stringify(tried));
      const mismatched = await (await post("/profiles/test", { ...byok, apiFormat: "chat_completions" })).json();
      assert(!mismatched.success && mismatched.checks.text.message.includes("looks like Responses, so pick that API format"), "format mismatch not named: " + JSON.stringify(mismatched.checks.text));
      globalThis.fetch = async (url, init = {}) => (init.method || "GET") === "GET" ? json({ data: [{ id: "gpt-r" }] }) : new Response('data: {"choices":[]}', { status: 200, headers: { "Content-Type": "text/event-stream" } });
      const streamed = await (await post("/profiles/test", { ...byok, apiFormat: "chat_completions" })).json();
      assert(streamed.checks.text.message.includes("text/event-stream") && streamed.checks.text.message.includes("data: "), "streamed answer not described: " + JSON.stringify(streamed.checks.text));
    `);
    expect(code, stderr).toBe(0);
  });

  test("every request says stream: false, so a router that streams unless told otherwise answers Test, Playground, and the bot in JSON", () => {
    const { code, stderr } = scenario(`
      // Like 9router: a POST without "stream": false gets a stream back.
      const answers = {
        responses: { object: "response", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] },
        chat_completions: { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] },
        messages: { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" },
      };
      const formatOf = (url) => url.endsWith("/responses") ? "responses" : url.endsWith("/messages") ? "messages" : "chat_completions";
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "cc/claude-sonnet-5-5" }] })
        : call.body.stream !== false ? new Response('event: response.created\\ndata: {"type":"response.created"}\\n\\n', { status: 200, headers: { "Content-Type": "text/event-stream" } })
        : json(answers[formatOf(call.url)]);
      for (const apiFormat of ["responses", "chat_completions", "messages"]) {
        const byok = { provider: "custom", apiFormat, model: "cc/claude-sonnet-5-5", baseUrl: "http://localhost:20128/v1", apiKey: "k" };
        const tried = await (await post("/profiles/playground", { ...byok, prompt: "hi" })).json();
        assert(tried.success && tried.reply === "OK", apiFormat + " playground streamed: " + JSON.stringify(tried));
        const profile = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Router " + apiFormat, ...byok })).json()).profile;
        const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t-" + apiFormat, isEnabled: false, profileId: profile.id });
        const answer = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id });
        assert(answer.content === "OK", apiFormat + " bot answer streamed: " + JSON.stringify(answer));
      }
      const anthropic = await post("/tenants/" + tenant.id + "/profiles", { name: "Claude", provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant" });
      const claudeBot = await repositories().bots.create({ tenantId: tenant.id, token: "t-claude", isEnabled: false, profileId: (await anthropic.json()).profile.id });
      assert((await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: claudeBot.id })).content === "OK", "anthropic answer streamed");
    `);
    expect(code, stderr).toBe(0);
  });

  test("a server that streams even when asked not to is read by assembling its events: text, tool calls, and usage, in every format", () => {
    const { code, stderr } = scenario(`
      const sse = (events) => new Response(events.map(([name, data]) => (name ? "event: " + name + "\\n" : "") + "data: " + (typeof data === "string" ? data : JSON.stringify(data)) + "\\n\\n").join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
      const streams = {
        chat_completions: () => sse([
          [null, { choices: [{ index: 0, delta: { role: "assistant", content: "O" } }] }],
          [null, { choices: [{ index: 0, delta: { content: "K" } }] }],
          [null, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "listFiles", arguments: '{"pa' } }] } }] }],
          [null, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"channel"}' } }] } }] }],
          [null, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }],
          [null, "[DONE]"],
        ]),
        // The completed event leaves out the output, as some proxies do, so the items are taken from their own events.
        responses: () => sse([
          ["response.created", { type: "response.created", response: { id: "r", status: "in_progress", output: [] } }],
          ["response.output_text.delta", { type: "response.output_text.delta", delta: "O" }],
          ["response.output_text.delta", { type: "response.output_text.delta", delta: "K" }],
          ["response.output_item.done", { type: "response.output_item.done", item: { type: "message", content: [{ type: "output_text", text: "OK" }] } }],
          ["response.output_item.done", { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "listFiles", arguments: '{"path":"channel"}' } }],
          ["response.completed", { type: "response.completed", response: { id: "r", status: "completed", output: [], usage: { input_tokens: 3, output_tokens: 2 } } }],
        ]),
        messages: () => sse([
          ["message_start", { type: "message_start", message: { id: "m", role: "assistant", content: [], usage: { input_tokens: 3, output_tokens: 1 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "O" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "K" } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "c1", name: "listFiles", input: {} } }],
          ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"pa' } }],
          ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'th":"channel"}' } }],
          ["content_block_stop", { type: "content_block_stop", index: 1 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } }],
          ["message_stop", { type: "message_stop" }],
        ]),
      };
      const formatOf = (url) => url.endsWith("/responses") ? "responses" : url.endsWith("/messages") ? "messages" : "chat_completions";
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "m" }] }) : streams[formatOf(call.url)]();
      const tools = [{ name: "listFiles", description: "List files", parameters: { type: "object", properties: { path: { type: "string" } } } }];
      const check = (answer, label) => {
        assert(answer.content === "OK", label + " text not assembled: " + JSON.stringify(answer));
        assert(JSON.stringify(answer.toolCalls) === JSON.stringify([{ id: "c1", name: "listFiles", arguments: { path: "channel" } }]), label + " tool call not assembled: " + JSON.stringify(answer.toolCalls));
        assert(answer.usage?.promptTokens === 3 && answer.usage?.completionTokens === 2, label + " usage not read: " + JSON.stringify(answer.usage));
      };
      for (const apiFormat of ["chat_completions", "responses", "messages"]) {
        const byok = { provider: "custom", apiFormat, model: "m", baseUrl: "http://localhost:20128/v1", apiKey: "k" };
        const tried = await (await post("/profiles/playground", { ...byok, prompt: "hi" })).json();
        assert(tried.success && tried.reply === "OK" && tried.usage.input === 3 && tried.usage.output === 2, apiFormat + " playground not assembled: " + JSON.stringify(tried));
        const profile = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Streams " + apiFormat, ...byok })).json()).profile;
        const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t-" + apiFormat, isEnabled: false, profileId: profile.id });
        check(await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id, tools }), apiFormat);
      }
      const openai = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "GPT", provider: "openai", model: "gpt-4o", apiKey: "sk" })).json()).profile;
      check(await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: (await repositories().bots.create({ tenantId: tenant.id, token: "t-openai", isEnabled: false, profileId: openai.id })).id, tools }), "openai");
      const claude = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Claude", provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant" })).json()).profile;
      check(await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: (await repositories().bots.create({ tenantId: tenant.id, token: "t-claude", isEnabled: false, profileId: claude.id })).id, tools }), "anthropic");
    `);
    expect(code, stderr).toBe(0);
  });

  // A proxy seen in use (2026-10-19): without streaming it answers a tool call as empty text with finish_reason "tool_use" and no
  // tool_calls, so the bot said "Selesai." to everything that needed a tool; streamed, the same proxy sends the call, and its text
  // starts with an empty <think></think>.
  test("a Chat Completions server that drops tool calls unless it streams is asked again streaming, remembered, and its <think> block left out", () => {
    const { code, stderr } = scenario(`
      const sse = (chunks) => new Response(chunks.map((c) => "data: " + JSON.stringify(c) + "\\n\\n").join("") + "data: [DONE]\\n\\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
      let streamed = "call";
      reply = (call) => {
        if (call.method === "GET") return json({ data: [{ id: "dsh/deepseek-flash" }] });
        if (call.body.stream !== true) return json({ choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "tool_use" }], usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 } });
        return sse([
          { choices: [{ index: 0, delta: { role: "assistant" } }] },
          { choices: [{ index: 0, delta: { content: "<think>" } }] },
          { choices: [{ index: 0, delta: { content: "</think>" } }] },
          ...(streamed === "call"
            ? [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "listFiles", arguments: "" } }] } }] },
               { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"channel"}' } }] } }] },
               { choices: [{ index: 0, delta: {}, finish_reason: "tool_use" }] }]
            : [{ choices: [{ index: 0, delta: { content: "Halo!" } }] }, { choices: [{ index: 0, delta: {}, finish_reason: "end_turn" }] }]),
          { choices: [], usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 } },
        ]);
      };
      const profile = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Proxy", provider: "custom", apiFormat: "chat_completions", model: "dsh/deepseek-flash", baseUrl: "https://proxy.example/v1", apiKey: "k" })).json()).profile;
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t-proxy", isEnabled: false, profileId: profile.id });
      const tools = [{ name: "listFiles", description: "List files", parameters: { type: "object", properties: { path: { type: "string" } } } }];
      const ask = () => llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id, tools });
      const posts = () => calls.filter((c) => c.method === "POST");

      const first = await ask();
      assert(JSON.stringify(first.toolCalls) === JSON.stringify([{ id: "c1", name: "listFiles", arguments: { path: "channel" } }]), "the dropped tool call was not fetched again: " + JSON.stringify(first));
      assert(first.finishReason === "tool_calls" && !first.content, "the call came back with text or the wrong finish: " + JSON.stringify(first));
      assert(posts().length === 2 && posts()[0].body.stream === false && posts()[1].body.stream === true && posts()[1].body.stream_options?.include_usage === true, "not asked again streaming, with usage: " + JSON.stringify(posts().map((c) => [c.body.stream, c.body.stream_options])));
      assert(first.usage?.promptTokens === 9 && first.usage?.completionTokens === 7, "usage of the streamed answer not read: " + JSON.stringify(first.usage));

      calls.length = 0; streamed = "text";
      const next = await ask();
      assert(posts().length === 1 && posts()[0].body.stream === true, "the server's need to stream was not remembered: " + JSON.stringify(posts().map((c) => c.body.stream)));
      assert(next.content === "Halo!" && next.finishReason === "stop", "the empty <think> block reached the reply: " + JSON.stringify(next));
    `);
    expect(code, stderr).toBe(0);
  });

  // The same kind of proxy on the Responses API (2026-10-24): unstreamed, a tool call comes back as a completed, empty message; streamed,
  // each event is wrapped as {"event", "data"}, the call arrives as its own items, and the completed response holds no output or usage.
  test("a Responses server that drops tool calls unless it streams is asked again streaming, remembered, and its wrapped events read", () => {
    const { code, stderr } = scenario(`
      const wrapped = (events) => new Response(events.map((e) => "data: " + JSON.stringify({ event: e.type, data: e }) + "\\n\\n").join("") + "data: [DONE]\\n\\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
      const message = (text) => ({ id: "msg_0", type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      const call = { id: "fc_c1", type: "function_call", call_id: "c1", name: "listFiles", arguments: '{"path":"channel"}' };
      let streamed = "call";
      reply = (c) => {
        if (c.method === "GET") return json({ data: [{ id: "cbai-cli/deepseek-flash" }] });
        if (c.body.stream !== true) return json({ object: "response", status: "completed", output: [message("")], usage: { input_tokens: 9, output_tokens: 7, total_tokens: 16 } });
        const items = streamed === "call" ? [message("Checking."), call] : [message("Halo!")];
        return wrapped([
          { type: "response.created", response: { status: "in_progress", output: [] } },
          ...items.map((item) => ({ type: "response.output_item.done", output_index: 0, item })),
          { type: "response.completed", response: { status: "completed" } },
        ]);
      };
      const profile = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Proxy", provider: "custom", apiFormat: "responses", model: "cbai-cli/deepseek-flash", baseUrl: "https://proxy.example/v1", apiKey: "k" })).json()).profile;
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t-proxy", isEnabled: false, profileId: profile.id });
      const tools = [{ name: "listFiles", description: "List files", parameters: { type: "object", properties: { path: { type: "string" } } } }];
      const ask = () => llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id, tools });
      const posts = () => calls.filter((c) => c.method === "POST");

      const first = await ask();
      assert(JSON.stringify(first.toolCalls) === JSON.stringify([{ id: "c1", name: "listFiles", arguments: { path: "channel" } }]), "the dropped tool call was not fetched again: " + JSON.stringify(first));
      assert(first.finishReason === "tool_calls" && first.content === "Checking.", "the streamed answer was not assembled: " + JSON.stringify(first));
      assert(posts().length === 2 && posts()[0].body.stream === false && posts()[1].body.stream === true, "not asked again streaming: " + JSON.stringify(posts().map((c) => c.body.stream)));

      calls.length = 0; streamed = "text";
      const next = await ask();
      assert(posts().length === 1 && posts()[0].body.stream === true, "the server's need to stream was not remembered: " + JSON.stringify(posts().map((c) => c.body.stream)));
      assert(next.content === "Halo!" && next.finishReason === "stop", "the streamed text was not read: " + JSON.stringify(next));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("a Chat Completions answer that says it called a tool but holds no call or text, streamed or not, is a provider failure, never an empty reply", () => {
    const { code, stderr } = scenario(`
      const sse = (chunks) => new Response(chunks.map((c) => "data: " + JSON.stringify(c) + "\\n\\n").join("") + "data: [DONE]\\n\\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
      reply = (call) => call.method === "GET" ? json({ data: [{ id: "m" }] })
        : call.body.stream === true ? sse([{ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "tool_calls" }] }])
        : json({ choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "tool_calls" }] });
      const profile = (await (await post("/tenants/" + tenant.id + "/profiles", { name: "Broken", provider: "custom", apiFormat: "chat_completions", model: "m", baseUrl: "https://broken.example/v1", apiKey: "k" })).json()).profile;
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t-broken", isEnabled: false, profileId: profile.id });
      const answer = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id, tools: [{ name: "listFiles", description: "List files", parameters: { type: "object", properties: {} } }] });
      assert(answer.finishReason === "error", "an answer with neither the call nor text passed as a reply: " + JSON.stringify(answer));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("image capability follows the bot's profile flag, and an Anthropic tenant default asks the models endpoint", () => {
    const { code, stderr } = scenario(`
      const { encryptSecret } = await import(${src("packages/db/src/index.ts")});
      const make = async (body) => (await (await post("/tenants/" + tenant.id + "/profiles", { provider: "openai", model: "gpt-x", ...body })).json()).profile;
      const seeing = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: (await make({ name: "Seeing", acceptsImages: true })).id });
      const blind = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: (await make({ name: "Blind" })).id });
      const plain = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false });
      assert(await llmRouter.acceptsImages(tenant.id, seeing.id) === true && await llmRouter.acceptsImages(tenant.id, blind.id) === false, "profile flag not followed");
      assert(await llmRouter.acceptsImages(tenant.id, plain.id) === false && calls.length === 0, "an OpenAI tenant default has no declared image input");

      const other = await repositories().tenants.create({ name: "Default", slug: "default-anthropic" });
      await repositories().agentConfig.update(other.id, { defaultProvider: "anthropic", defaultModel: "claude-text-only", anthropicApiKeyEncrypted: encryptSecret("sk-ant-other") });
      reply = (call) => json({ id: call.url.split("/").pop(), capabilities: { image_input: { supported: call.url.endsWith("claude-opus-5-5") } } });
      assert(await llmRouter.acceptsImages(other.id) === false, "unsupported image input reported as accepted");
      calls.length = 0;
      const fresh = await repositories().tenants.create({ name: "Fresh", slug: "fresh-anthropic" });
      await repositories().agentConfig.update(fresh.id, { defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", anthropicApiKeyEncrypted: encryptSecret("sk-ant-fresh") });
      assert(await llmRouter.acceptsImages(fresh.id) === true, "models endpoint capability not used");
      const [call] = calls;
      assert(call.method === "GET" && call.url === "https://api.anthropic.com/v1/models/claude-opus-5-5" && call.headers["x-api-key"] === "sk-ant-fresh" && call.headers["anthropic-version"], "wrong models request: " + JSON.stringify(call));
      await llmRouter.acceptsImages(fresh.id);
      assert(calls.length === 1, "capability looked up again instead of cached");
      reply = () => json({ content: [{ type: "text", text: "hi" }] });
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: fresh.id });
      assert(calls[1].url === "https://api.anthropic.com/v1/messages" && calls[1].body.model === "claude-opus-5-5", "chat and capability lookup disagree on the model: " + JSON.stringify(calls[1]));
      reply = () => json({ error: { message: "nope" } }, 500);
      const broken = await repositories().tenants.create({ name: "Broken", slug: "broken-anthropic" });
      await repositories().agentConfig.update(broken.id, { defaultProvider: "anthropic", defaultModel: "claude-opus-5-5", anthropicApiKeyEncrypted: encryptSecret("sk-ant-broken") });
      assert(await llmRouter.acceptsImages(broken.id) === false, "a failed lookup must not claim image input");
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);
});
