import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

test("web chat answers 50,000 characters and refuses 50,001 in the language they were written in", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-webchat-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (c, m) => { if (!c) throw new Error(m); };
        const imp = (p) => import(${JSON.stringify(w + "/")} + p);
        const { runMigrations } = await imp("packages/db/src/migrate.ts");
        const { runSeed } = await imp("packages/db/src/seed.ts");
        const { repositories } = await imp("packages/db/src/index.ts");
        await runMigrations(); await runSeed();
        const t = await repositories().tenants.create({ name: "Web", slug: "web" }); const key = await repositories().tenants.issueApiKey("web");
        await repositories().tenants.linkApiKey(t.id, key.keyId);
        const { createServer } = await imp("apps/agent/src/server.ts"); const app = createServer();
        const headers = { Authorization: "Bearer " + key.raw, "Content-Type": "application/json", "X-Tenant-Id": t.id };
        assert((await app.request("/api/v1/config", { method: "PUT", headers, body: JSON.stringify({ openaiApiKeyEncrypted: "mock-openai-key" }) })).status === 200, "LLM config failed");
        let completions = 0;
        globalThis.fetch = async () => { completions++; return new Response(JSON.stringify({ choices: [{ message: { content: "Read it." } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "Content-Type": "application/json" } }); };
        const chat = async (message) => { const res = await app.request("/api/v1/chat", { method: "POST", headers, body: JSON.stringify({ message }) }); return { status: res.status, body: await res.json() }; };
        const sized = (text, n) => text.repeat(Math.ceil(n / text.length)).slice(0, n);
        const english = "Please read the minutes from the planning call and tell me what the team agreed on. ";
        const indonesian = "Tolong baca notula rapat ini dan bilang apa yang sudah kami sepakati untuk rilis minggu depan. ";

        const fits = await chat(sized(english, 50000));
        assert(fits.status === 200 && fits.body.reply === "Read it." && completions === 1, "50,000 characters not answered: " + JSON.stringify(fits.body).slice(0, 300));

        const over = await chat(sized(english, 50001));
        assert(over.status === 200 && over.body.reply === "That message is too long (limit 50,000 characters). Please shorten it." && completions === 1, "50,001 English characters not refused: " + JSON.stringify(over.body).slice(0, 300));
        const overId = await chat(sized(indonesian, 50001));
        assert(overId.status === 200 && overId.body.reply === "Pesan itu terlalu panjang (batas 50.000 karakter). Tolong persingkat." && completions === 1, "50,001 Indonesian characters not refused in Indonesian: " + JSON.stringify(overId.body).slice(0, 300));
        const denied = await repositories().usage.list({ tenantId: t.id, type: "guardrail_denied" });
        assert(denied.length === 2 && denied.every((e) => e.metadata.kind === "limit" && e.metadata.platform === "web"), "refusals not audited: " + JSON.stringify(denied.map((e) => e.metadata)));
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "w.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test", GUARDRAIL_MODE: "enforce" },
    });
    expect(r.exitCode, decode(r.stderr)).toBe(0);
    expect(decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("web chat cannot read or search another channel's Minutes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-webchat-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (c, m) => { if (!c) throw new Error(m); };
        const imp = (p) => import(${JSON.stringify(w + "/")} + p);
        const { runMigrations } = await imp("packages/db/src/migrate.ts");
        const { runSeed } = await imp("packages/db/src/seed.ts");
        const { repositories } = await imp("packages/db/src/index.ts");
        const { workspaceStore } = await imp("packages/skills/src/workspace/store.ts");
        await runMigrations(); await runSeed();
        const t = await repositories().tenants.create({ name: "Web", slug: "web" }); const key = await repositories().tenants.issueApiKey("web");
        await repositories().tenants.linkApiKey(t.id, key.keyId);
        await workspaceStore().write(t.id, "guilds/guild-1/channels/channel-2/minutes/2026-10-14-pricing.md", "Pricing agreed\\n");
        const { createServer } = await imp("apps/agent/src/server.ts"); const app = createServer();
        const headers = { Authorization: "Bearer " + key.raw, "Content-Type": "application/json", "X-Tenant-Id": t.id };
        assert((await app.request("/api/v1/config", { method: "PUT", headers, body: JSON.stringify({ openaiApiKeyEncrypted: "mock-openai-key" }) })).status === 200, "LLM config failed");
        const calls = [
          { id: "c1", type: "function", function: { name: "readFile", arguments: JSON.stringify({ path: "#channel-2/minutes/2026-10-14-pricing.md" }) } },
          { id: "c2", type: "function", function: { name: "searchFiles", arguments: JSON.stringify({ query: "pricing" }) } },
        ];
        let completions = 0;
        globalThis.fetch = async (_url, init) => {
          const sent = JSON.parse(init.body).messages;
          const message = completions++ === 0 ? { content: null, tool_calls: calls } : { content: sent.filter((m) => m.role === "tool").map((m) => m.content).join("\\n") };
          return new Response(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "Content-Type": "application/json" } });
        };
        const res = await app.request("/api/v1/chat", { method: "POST", headers, body: JSON.stringify({ message: "what did #channel-2 decide about pricing?" }) });
        const reply = (await res.json()).reply;
        assert(reply.includes("#channel-2 is not a channel whose files you can read from here."), "another channel was read: " + reply);
        assert(reply.includes('{"groups":[],"total":0,"leftOut":0}') && !reply.includes("Pricing agreed"), "search reached another channel: " + reply);
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "w.db")}`, WORKSPACE_DIR: join(dir, "workspace"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" },
    });
    expect(r.exitCode, decode(r.stderr)).toBe(0);
    expect(decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("web chat names the language of the person's message to answer in, as Discord does, and none when the words show no language", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-webchat-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const imp = (p) => import(${JSON.stringify(w + "/")} + p);
        const { runMigrations } = await imp("packages/db/src/migrate.ts");
        const { runSeed } = await imp("packages/db/src/seed.ts");
        const { repositories } = await imp("packages/db/src/index.ts");
        await runMigrations(); await runSeed();
        const t = await repositories().tenants.create({ name: "Web", slug: "web" }); const key = await repositories().tenants.issueApiKey("web");
        await repositories().tenants.linkApiKey(t.id, key.keyId);
        const { createServer } = await imp("apps/agent/src/server.ts"); const app = createServer();
        const headers = { Authorization: "Bearer " + key.raw, "Content-Type": "application/json", "X-Tenant-Id": t.id };
        await app.request("/api/v1/config", { method: "PUT", headers, body: JSON.stringify({ openaiApiKeyEncrypted: "mock-openai-key" }) });
        const named = [];
        globalThis.fetch = async (_url, init) => {
          const sent = JSON.parse(init.body).messages.map((m) => typeof m.content === "string" ? m.content : "").join("\\n");
          named.push([...sent.matchAll(/^Reply in: (\\w+)/gm)].map((m) => m[1]));
          return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "Content-Type": "application/json" } });
        };
        for (const message of ["task bluetooth itu sudah sampai mana?", "what is the status of the bluetooth task?", "ENG-42?"]) await app.request("/api/v1/chat", { method: "POST", headers, body: JSON.stringify({ message }) });
        console.log(JSON.stringify(named));
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "w.db")}`, WORKSPACE_DIR: join(dir, "workspace"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" },
    });
    expect(r.exitCode, decode(r.stderr)).toBe(0);
    expect(JSON.parse(decode(r.stdout).trim().split("\n").at(-1)!)).toEqual([["Indonesian"], ["English"], []]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
