import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

// Web chat has no Workspace place to keep a long text as a Document, so it takes inline text up to 50,000 characters.
test("web chat answers 50,000 characters and refuses 50,001 in the language they were written in", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-webchat-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (c, m) => { if (!c) throw new Error(m); };
        const imp = (p) => import(${JSON.stringify(w + "/")} + p);
        const { runMigrations } = await imp("packages/db/src/migrate.ts");
        const { runSeed } = await imp("packages/db/src/seed.ts");
        const { db, tenants, usageEvents, and, eq } = await imp("packages/db/src/index.ts");
        const { createTenant, issueApiKey } = await imp("packages/db/src/tenancy.ts");
        await runMigrations(); await runSeed();
        const t = await createTenant({ name: "Web", slug: "web" }); const key = await issueApiKey("web");
        await db.update(tenants).set({ apiKeyId: key.keyId }).where(eq(tenants.id, t.id));
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
        const denied = await db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, t.id), eq(usageEvents.type, "guardrail_denied")));
        assert(denied.length === 2 && denied.every((e) => e.metadata.kind === "limit" && e.metadata.platform === "web"), "refusals not audited: " + JSON.stringify(denied.map((e) => e.metadata)));
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "w.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test", GUARDRAIL_MODE: "enforce" },
    });
    expect(decode(r.stderr).trim()).toBe("");
    expect(decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
