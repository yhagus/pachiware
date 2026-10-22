import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const src = (path: string) => JSON.stringify(join(workspace, path));

// Each scenario runs in its own process because the database dialect binds at import time.
// The fetch stub honours `init.signal` so the router's timeout is observable, and `reply` may return HANG to never answer.
function scenario(body: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-router-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const { runMigrations } = await import(${src("packages/db/src/migrate.ts")}); const { runSeed } = await import(${src("packages/db/src/seed.ts")});
        const { encryptSecret, repositories } = await import(${src("packages/db/src/index.ts")});
        await runMigrations(); await runSeed();
        const tenant = await repositories().tenants.create({ name: "Router", slug: "router" });
        const { createServer } = await import(${src("apps/agent/src/server.ts")}); const app = createServer();
        const { llmRouter } = await import(${src("apps/agent/src/llm/router.ts")});
        const { retryPolicy } = await import(${src("apps/agent/src/llm/retry.ts")});
        const waits = []; retryPolicy.sleep = async (ms) => { waits.push(ms); };
        const admin = { "X-Platform-Key": "router-admin-key", "Content-Type": "application/json" };
        const post = async (path, body) => app.request("/api/admin" + path, { method: "POST", headers: admin, body: JSON.stringify(body) });
        const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
        const openai = (content) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
        const useOpenAI = async (id) => repositories().agentConfig.update(id, { openaiApiKeyEncrypted: encryptSecret("sk-openai") });
        const HANG = Symbol("hang");
        const calls = []; let reply = () => json({});
        globalThis.fetch = (url, init = {}) => new Promise((resolve, reject) => {
          const call = { url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null, aborted: false };
          calls.push(call);
          init.signal?.addEventListener("abort", () => { call.aborted = true; reject(init.signal.reason); });
          Promise.resolve().then(() => reply(call)).then((out) => { if (out !== HANG) resolve(out); }, reject);
        });
        ${body}
        console.log(JSON.stringify({ ok: true }));
      `],
      cwd: workspace,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "router.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 36).toString("base64"), PLATFORM_ADMIN_KEY: "router-admin-key", NODE_ENV: "test" },
    });
    return { code: result.exitCode, stderr: new TextDecoder().decode(result.stderr).trim() };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("Router hardening", () => {
  test("a 429 then a 200 yields one answer over two requests, honouring Retry-After; 5xx and network failures retry three times with backoff; a 400 is never retried", () => {
    const { code, stderr } = scenario(`
      await useOpenAI(tenant.id);
      const ask = () => llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id });
      reply = () => calls.length === 1 ? json({ error: { message: "slow down" } }, 429, { "Retry-After": "2" }) : json(openai("answer"));
      const answer = await ask();
      assert(answer.content === "answer" && answer.finishReason === "stop", "answer not read: " + JSON.stringify(answer));
      assert(calls.length === 2, "expected two requests, got " + calls.length);
      assert(JSON.stringify(waits) === "[2000]", "Retry-After not honoured: " + JSON.stringify(waits));

      calls.length = 0; waits.length = 0; reply = () => json({ error: { message: "overloaded" } }, 503);
      const down = await ask();
      assert(down.finishReason === "error" && down.httpStatus === 503, "503 not reported: " + JSON.stringify(down));
      assert(down.content === "Saya sedang tidak bisa terhubung ke layanan AI. Coba lagi sebentar lagi.", "fallback not in the tenant's language: " + down.content);
      assert(calls.length === 4 && waits.length === 3, "expected four requests and three waits: " + calls.length + " / " + JSON.stringify(waits));
      assert(waits.every((ms, i) => ms >= 500 * 2 ** i && ms <= 1500 * 2 ** i), "backoff not exponential with jitter: " + JSON.stringify(waits));
      assert((await repositories().usage.list()).filter((r) => r.type === "llm_tokens").length === 1, "a failed call must not record usage");

      calls.length = 0; waits.length = 0; reply = () => { throw new TypeError("fetch failed"); };
      const gone = await ask();
      assert(gone.finishReason === "error" && calls.length === 4 && waits.length === 3, "network failure not retried: " + calls.length);

      calls.length = 0; waits.length = 0;
      reply = (call) => Array.isArray(call.body.messages[0].content) ? json({ error: { message: "no images" } }, 400) : json(openai("text only"));
      const seen = await llmRouter.complete([{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", mediaType: "image/png", data: "AAAA" }] }], { tenantId: tenant.id });
      assert(seen.content === "text only" && seen.imagesRejected === true, "image fallback changed: " + JSON.stringify(seen));
      assert(calls.length === 2 && waits.length === 0, "a 400 was retried: " + calls.length + " / " + JSON.stringify(waits));
    `);
    expect(code, stderr).toBe(0);
  });

  test("a hung request aborts at the timeout and the retry answers", () => {
    const { code, stderr } = scenario(`
      await useOpenAI(tenant.id);
      retryPolicy.timeoutMs = 40;
      reply = () => calls.length === 1 ? HANG : json(openai("late but here"));
      const started = performance.now();
      const answer = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id });
      const elapsed = performance.now() - started;
      assert(answer.content === "late but here", "retry after timeout not answered: " + JSON.stringify(answer));
      assert(calls.length === 2 && calls[0].aborted && !calls[1].aborted, "first request not aborted: " + JSON.stringify(calls.map((c) => c.aborted)));
      assert(elapsed >= 40 && elapsed < 2000, "timeout not at the configured limit: " + elapsed);
      assert(waits.length === 1, "timeout not followed by a backoff wait: " + JSON.stringify(waits));

      calls.length = 0; waits.length = 0; reply = () => HANG;
      const never = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id });
      assert(never.finishReason === "error" && calls.length === 4 && calls.every((c) => c.aborted), "hung requests not given up after three retries: " + calls.length);
    `);
    expect(code, stderr).toBe(0);
  });

  test("a turn's deadline cuts a hung request at the deadline and starts no retry or fallback that would run past it", () => {
    const { code, stderr } = scenario(`
      await useOpenAI(tenant.id);
      reply = () => HANG;
      const started = performance.now();
      const hung = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, deadline: Date.now() + 60 });
      const elapsed = performance.now() - started;
      assert(hung.finishReason === "error" && calls.length === 1 && calls[0].aborted, "hung request retried past the deadline: " + calls.length);
      assert(elapsed >= 50 && elapsed < 1000, "not cut at the deadline: " + elapsed);

      calls.length = 0; waits.length = 0; reply = () => json({ error: { message: "overloaded" } }, 503);
      const down = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, deadline: Date.now() + 200 });
      assert(down.finishReason === "error" && down.httpStatus === 503 && calls.length === 1 && waits.length === 0, "a retry waited past the deadline: " + calls.length + " / " + JSON.stringify(waits));

      calls.length = 0;
      const late = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, deadline: Date.now() - 1 });
      assert(late.finishReason === "error" && calls.length === 0, "a request started past the deadline: " + calls.length);
    `);
    expect(code, stderr).toBe(0);
  });

  test("a tool's own model call given the turn's deadline is cut there in flight and gets null, and one made past it sends no request", () => {
    const { code, stderr } = scenario(`
      await useOpenAI(tenant.id);
      const { botCompletion } = await import(${src("apps/agent/src/llm/completion.ts")});
      // A short attempt timeout, so a call that ignored the deadline still ends here, well after it.
      retryPolicy.timeoutMs = 1500; retryPolicy.retries = 0;
      const ask = { system: "Name the venue in one word.", user: "Hall B or Hall C?" };
      reply = () => HANG;
      const started = performance.now();
      const hung = await botCompletion({ tenantId: tenant.id, language: "en" }, Date.now() + 60)(ask);
      const elapsed = performance.now() - started;
      assert(hung === null && calls.length === 1 && calls[0].aborted, "hung call not given up: " + JSON.stringify(hung) + " / " + calls.length);
      assert(elapsed >= 50 && elapsed < 1000, "not cut at the deadline: " + elapsed);

      calls.length = 0; reply = () => json(openai("Hall B"));
      const late = await botCompletion({ tenantId: tenant.id, language: "en" }, Date.now() - 1)(ask);
      assert(late === null && calls.length === 0, "a call made past the deadline: " + JSON.stringify(late) + " / " + calls.length);
      const inTime = await botCompletion({ tenantId: tenant.id, language: "en" }, Date.now() + 5000)(ask);
      assert(inTime === "Hall B" && calls.length === 1, "a call within the deadline not answered: " + JSON.stringify(inTime));
    `);
    expect(code, stderr).toBe(0);
  });

  test("a tool's own model call given its own deadline, before the turn's, is cut there in flight, and one made past it sends no request", () => {
    const { code, stderr } = scenario(`
      await useOpenAI(tenant.id);
      const { botCompletion } = await import(${src("apps/agent/src/llm/completion.ts")});
      retryPolicy.timeoutMs = 1500; retryPolicy.retries = 0;
      const ask = { system: "Name the venue in one word.", user: "Hall B or Hall C?" };
      const turn = botCompletion({ tenantId: tenant.id, language: "en" }, Date.now() + 60_000);
      reply = () => HANG;
      const started = performance.now();
      const hung = await turn({ ...ask, deadline: Date.now() + 60 });
      const elapsed = performance.now() - started;
      assert(hung === null && calls.length === 1 && calls[0].aborted, "hung call not given up: " + JSON.stringify(hung) + " / " + calls.length);
      assert(elapsed >= 50 && elapsed < 1000, "not cut at its own deadline: " + elapsed);

      calls.length = 0; reply = () => json(openai("Hall B"));
      const late = await turn({ ...ask, deadline: Date.now() - 1 });
      assert(late === null && calls.length === 0, "a call made past its own deadline: " + JSON.stringify(late) + " / " + calls.length);
      const inTime = await turn({ ...ask, deadline: Date.now() + 5000 });
      assert(inTime === "Hall B" && calls.length === 1, "a call within its own deadline not answered: " + JSON.stringify(inTime));
    `);
    expect(code, stderr).toBe(0);
  });

  test("an Anthropic request marks the last system block and the last tool for caching, sends no temperature, and records cached tokens", () => {
    const { code, stderr } = scenario(`
      const created = await post("/tenants/" + tenant.id + "/profiles", { name: "Claude", provider: "anthropic", model: "claude-sonnet-5-5", apiKey: "sk-ant-profile" });
      const { profile } = await created.json();
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: profile.id });
      reply = () => json({ content: [{ type: "text", text: "hello" }], usage: { input_tokens: 40, output_tokens: 3, cache_read_input_tokens: 30, cache_creation_input_tokens: 10 } });
      const tools = [{ name: "listTasks", description: "Lists tasks.", parameters: { type: "object", properties: {} } }, { name: "createTask", description: "Creates a task.", parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } }];
      const answer = await llmRouter.complete([{ role: "system", content: "Be brief." }, { role: "system", content: "Be kind." }, { role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id, tools });
      assert(answer.content === "hello", "answer not read: " + JSON.stringify(answer));
      const [call] = calls;
      assert(JSON.stringify(call.body.system) === JSON.stringify([{ type: "text", text: "Be brief." }, { type: "text", text: "Be kind.", cache_control: { type: "ephemeral" } }]), "system blocks wrong: " + JSON.stringify(call.body.system));
      assert(call.body.tools.length === 2 && !("cache_control" in call.body.tools[0]) && JSON.stringify(call.body.tools[1].cache_control) === '{"type":"ephemeral"}' && call.body.tools[1].name === "createTask", "tool cache mark wrong: " + JSON.stringify(call.body.tools));
      assert(!("temperature" in call.body), "current Claude models reject a non-default temperature");
      assert(answer.usage.cachedTokens === 30 && answer.usage.promptTokens === 40, "cached tokens not read: " + JSON.stringify(answer.usage));
      const [row] = (await repositories().usage.list()).filter((r) => r.type === "llm_tokens");
      assert(row && row.metadata.cachedTokens === 30 && row.promptTokens === 40, "cached tokens not in the usage event: " + JSON.stringify(row));
      const aggregate = await (await app.request("/api/admin/tenants/" + tenant.id + "/usage", { headers: admin })).json();
      const line = aggregate.usage.find((r) => r.type === "llm_tokens");
      assert(line && line.cachedTokens === 30 && line.promptTokens === 40, "usage aggregate lacks cached tokens: " + JSON.stringify(aggregate));
    `);
    expect(code, stderr).toBe(0);
  });

  test("temperature is 0.2 from the seed and in OpenAI-shaped requests, and a tenant's own value still wins", () => {
    const { code, stderr } = scenario(`
      const config = await repositories().agentConfig.get(tenant.id);
      assert(config.temperature === 0.2, "seed wrote temperature " + config.temperature);
      await useOpenAI(tenant.id);
      reply = () => json(openai("ok"));
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id });
      assert(calls[0].body.temperature === 0.2, "default temperature wrong: " + calls[0].body.temperature);
      const warm = await repositories().tenants.create({ name: "Warm", slug: "warm" });
      await useOpenAI(warm.id); await repositories().agentConfig.update(warm.id, { temperature: 0.9 });
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: warm.id });
      assert(calls[1].body.temperature === 0.9, "tenant temperature not kept: " + calls[1].body.temperature);
      await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: warm.id, temperature: 0 });
      assert(calls[2].body.temperature === 0, "request temperature not kept: " + calls[2].body.temperature);
    `);
    expect(code, stderr).toBe(0);
  });

  test("a request's output floor lifts the tenant's output limit but never lowers it", () => {
    const { code, stderr } = scenario(`
      await useOpenAI(tenant.id);
      reply = () => json(openai("ok"));
      const ask = (options) => llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, ...options });
      await ask({});
      assert(calls[0].body.max_tokens === 4096, "tenant limit not sent: " + calls[0].body.max_tokens);
      await ask({ minOutputTokens: 16384 });
      assert(calls[1].body.max_tokens === 16384, "floor not applied: " + calls[1].body.max_tokens);
      // The tenant config is cached per tenant, so a tenant with its own higher limit is another tenant.
      const roomy = await repositories().tenants.create({ name: "Roomy", slug: "roomy" });
      await useOpenAI(roomy.id); await repositories().agentConfig.update(roomy.id, { maxTokens: 32000 });
      await ask({ tenantId: roomy.id, minOutputTokens: 16384 });
      assert(calls[2].body.max_tokens === 32000, "floor lowered the tenant's limit: " + calls[2].body.max_tokens);
    `);
    expect(code, stderr).toBe(0);
  });

  test("a Profile's reasoning effort goes out as each API format names it, a custom word as typed, and none without one", () => {
    const { code, stderr } = scenario(`
      const profile = async (body) => (await (await post("/tenants/" + tenant.id + "/profiles", { name: body.apiFormat ?? body.provider, model: "m", apiKey: "k", ...body })).json()).profile;
      const botOn = async (p) => (await repositories().bots.create({ tenantId: tenant.id, token: "t-" + p.id, isEnabled: false, profileId: p.id })).id;
      const ask = (botId) => llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId });
      reply = (call) => call.url.endsWith("/messages") ? json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" })
        : call.url.endsWith("/responses") ? json({ object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }] })
        : json(openai("ok"));

      const chat = await profile({ provider: "custom", baseUrl: "https://llm.example/v1", reasoningEffort: "low" });
      assert(chat.reasoningEffort === "low", "effort not kept: " + JSON.stringify(chat));
      await ask(await botOn(chat));
      assert(calls.at(-1).body.reasoning_effort === "low", "chat effort: " + JSON.stringify(calls.at(-1).body));
      await ask(await botOn(await profile({ provider: "custom", apiFormat: "responses", baseUrl: "https://llm.example/v1", reasoningEffort: "high" })));
      assert(JSON.stringify(calls.at(-1).body.reasoning) === JSON.stringify({ effort: "high" }), "responses effort: " + JSON.stringify(calls.at(-1).body));
      await ask(await botOn(await profile({ provider: "anthropic", reasoningEffort: " xhigh " })));
      assert(JSON.stringify(calls.at(-1).body.output_config) === JSON.stringify({ effort: "xhigh" }), "messages effort: " + JSON.stringify(calls.at(-1).body));
      const plain = await profile({ provider: "anthropic" });
      await ask(await botOn(plain));
      assert(!("output_config" in calls.at(-1).body) && plain.reasoningEffort === null, "an unset effort was sent: " + JSON.stringify(calls.at(-1).body));

      // An update clears it with null; two words are refused.
      const cleared = await (await app.request("/api/admin/profiles/" + chat.id, { method: "PATCH", headers: admin, body: JSON.stringify({ reasoningEffort: null }) })).json();
      assert(cleared.profile.reasoningEffort === null, "not cleared: " + JSON.stringify(cleared));
      const refused = await post("/tenants/" + tenant.id + "/profiles", { name: "x", provider: "openai", model: "m", reasoningEffort: "very high" });
      assert(refused.status === 400, "two words accepted: " + refused.status);

      // The Test button sends the form's effort too.
      await post("/profiles/test", { provider: "custom", baseUrl: "https://llm.example/v1", model: "m", apiKey: "k", reasoningEffort: "medium" });
      assert(calls.some((c) => c.url.endsWith("/chat/completions") && c.body?.reasoning_effort === "medium"), "test did not send the effort");
    `);
    expect(code, stderr).toBe(0);
  });

  test("an answer cut at the output limit reads as \"length\" in every request format, keeping the cut tool call it holds", () => {
    const { code, stderr } = scenario(`
      const profile = async (body) => (await (await post("/tenants/" + tenant.id + "/profiles", { name: body.apiFormat ?? body.provider, model: "m", apiKey: "k", ...body })).json()).profile;
      const botOn = async (p) => (await repositories().bots.create({ tenantId: tenant.id, token: "t-" + p.id, isEnabled: false, profileId: p.id })).id;
      const ask = (botId) => llmRouter.complete([{ role: "user", content: "write it all" }], { tenantId: tenant.id, botId });

      await useOpenAI(tenant.id);
      reply = () => json({ choices: [{ message: { content: "The release moves" }, finish_reason: "length" }] });
      const openaiCut = await ask();
      assert(openaiCut.finishReason === "length" && openaiCut.content === "The release moves", "OpenAI cut not read: " + JSON.stringify(openaiCut));
      reply = () => json({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "writeFile", arguments: '{"path":"notes/a.md","con' } }] }, finish_reason: "length" }] });
      const openaiTool = await ask();
      assert(openaiTool.finishReason === "length" && openaiTool.toolCalls.length === 1 && openaiTool.toolCalls[0].name === "writeFile", "OpenAI cut tool call not kept as cut: " + JSON.stringify(openaiTool));

      const anthropic = await botOn(await profile({ provider: "anthropic" }));
      reply = () => json({ content: [{ type: "text", text: "The release moves" }], stop_reason: "max_tokens", usage: { input_tokens: 4, output_tokens: 3 } });
      const claudeCut = await ask(anthropic);
      assert(claudeCut.finishReason === "length" && claudeCut.content === "The release moves", "Anthropic cut not read: " + JSON.stringify(claudeCut));

      const messages = await botOn(await profile({ provider: "custom", apiFormat: "messages", baseUrl: "https://proxy.example/v1" }));
      const proxyCut = await ask(messages);
      assert(proxyCut.finishReason === "length", "Messages-format cut not read: " + JSON.stringify(proxyCut));

      const chat = await botOn(await profile({ provider: "custom", baseUrl: "https://llm.example/v1" }));
      reply = () => json({ choices: [{ message: { content: "The release moves" }, finish_reason: "length" }] });
      const chatCut = await ask(chat);
      assert(chatCut.finishReason === "length", "custom Chat Completions cut not read: " + JSON.stringify(chatCut));

      const responses = await botOn(await profile({ provider: "custom", apiFormat: "responses", baseUrl: "https://llm.example/v1" }));
      reply = () => json({ object: "response", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The release moves" }] }] });
      const responsesCut = await ask(responses);
      assert(responsesCut.finishReason === "length" && responsesCut.content === "The release moves", "Responses cut not read: " + JSON.stringify(responsesCut));
      reply = () => json({ object: "response", status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Filtered" }] }] });
      const filtered = await ask(responses);
      assert(filtered.finishReason === "stop", "an answer incomplete for another reason is not a length cut: " + JSON.stringify(filtered));

      reply = () => json({ choices: [{ message: { content: "Done." }, finish_reason: "stop" }] });
      const whole = await ask(chat);
      assert(whole.finishReason === "stop", "a whole answer read as cut: " + JSON.stringify(whole));
    `);
    expect(code, stderr).toBe(0);
  });
});
