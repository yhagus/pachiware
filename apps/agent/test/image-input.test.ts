import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const src = (path: string) => JSON.stringify(join(workspace, path));

// The LLM router's HTTP seam: a bot with a profile, a stubbed provider, and the request bodies it receives.
function scenario(body: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-images-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const { runMigrations } = await import(${src("packages/db/src/migrate.ts")}); const { runSeed } = await import(${src("packages/db/src/seed.ts")});
        const { encryptSecret, repositories } = await import(${src("packages/db/src/index.ts")});
        await runMigrations(); await runSeed();
        const tenant = await repositories().tenants.create({ name: "Images", slug: "images" });
        const { llmRouter } = await import(${src("apps/agent/src/llm/router.ts")});
        const botWith = async (provider, model) => {
          const profile = await repositories().profiles.create(tenant.id, { name: model, provider, model, apiKeyEncrypted: encryptSecret("key"), acceptsImages: true });
          return repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false, profileId: profile.id });
        };
        const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        const calls = []; let reply = () => json({});
        globalThis.fetch = async (url, init = {}) => { const call = { url: String(url), body: init.body ? JSON.parse(init.body) : null }; calls.push(call); return reply(call); };
        const image = { type: "image", mediaType: "image/webp", data: "UklGRg==" };
        ${body}
      `],
      cwd: workspace,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "images.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 37).toString("base64"), NODE_ENV: "test" },
    });
    return { code: result.exitCode, stderr: new TextDecoder().decode(result.stderr).trim() };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("image input at the LLM router", () => {
  test("an Anthropic request carries an image block with its media type, and tool results stay first in a tool-answer turn", () => {
    const { code, stderr } = scenario(`
      const bot = await botWith("anthropic", "claude-opus-5-5");
      reply = () => json({ content: [{ type: "text", text: "seen" }] });
      await llmRouter.complete([
        { role: "system", content: "Be brief." },
        { role: "user", content: "list files" },
        { role: "assistant", content: null, toolCalls: [{ id: "t1", name: "listFiles", arguments: {} }] },
        { role: "tool", toolCallId: "t1", content: "[]" },
        { role: "user", content: [{ type: "text", text: "Alice: and this? [image: a.webp]" }, image] },
      ], { tenantId: tenant.id, botId: bot.id });
      const sent = calls[0].body.messages;
      assert(sent.length === 3, "consecutive user turns not merged: " + JSON.stringify(sent));
      assert(JSON.stringify(sent[2]) === JSON.stringify({ role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: "[]" },
        { type: "image", source: { type: "base64", media_type: "image/webp", data: "UklGRg==" } },
        { type: "text", text: "Alice: and this? [image: a.webp]" },
      ] }), "tool-answer turn wrong: " + JSON.stringify(sent[2]));
    `);
    expect(code, stderr).toBe(0);
  });

  test("a 400 on a request with images is retried once without them and marked as rejected", () => {
    const { code, stderr } = scenario(`
      const bot = await botWith("openai", "gpt-text");
      reply = (call) => JSON.stringify(call.body).includes("image_url") ? json({ error: { message: "image_url is only supported by certain models" } }, 400) : json({ choices: [{ message: { content: "text answer" } }] });
      const answer = await llmRouter.complete([{ role: "user", content: [{ type: "text", text: "what is this? [image: a.webp]" }, image] }], { tenantId: tenant.id, botId: bot.id });
      assert(calls.length === 2, "expected one retry, got " + calls.length + " calls");
      assert(JSON.stringify(calls[1].body.messages) === JSON.stringify([{ role: "user", content: "what is this? [image: a.webp]" }]), "retry still carries the image: " + JSON.stringify(calls[1].body));
      assert(answer.content === "text answer" && answer.imagesRejected === true, "retry answer not marked: " + JSON.stringify(answer));

      calls.length = 0; reply = () => json({ error: { message: "bad request" } }, 400);
      const plain = await llmRouter.complete([{ role: "user", content: "hi" }], { tenantId: tenant.id, botId: bot.id });
      assert(calls.length === 1 && plain.finishReason === "error" && plain.httpStatus === 400 && !plain.imagesRejected, "a text-only 400 must not be retried: " + JSON.stringify(plain));

      calls.length = 0;
      const still = await llmRouter.complete([{ role: "user", content: [{ type: "text", text: "x" }, image] }], { tenantId: tenant.id, botId: bot.id });
      assert(calls.length === 2 && still.finishReason === "error" && !still.imagesRejected, "a retry that also fails is an error, not a rejection: " + JSON.stringify(still));
    `);
    expect(code, stderr).toBe(0);
  });
});
