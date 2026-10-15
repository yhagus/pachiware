import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();

test("a danger effect does not make a git tool owner-only: owner-only stays exactly where it was", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-gitowner-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (c, m) => { if (!c) throw new Error(m); };
        const imp = (p) => import(${JSON.stringify(w + "/")} + p);
        const { runMigrations } = await imp("packages/db/src/migrate.ts");
        const { runSeed } = await imp("packages/db/src/seed.ts");
        const { db, gitAccounts, bots, encryptSecret, setBotGitAccounts, replaceGitScopes, and, eq } = await imp("packages/db/src/index.ts");
        const { repositories } = await imp("packages/db/src/index.ts");
        await runMigrations(); await runSeed();
        const { skillRegistry } = await imp("packages/skills/src/registry.ts");
        const { pendingOf } = await imp("apps/agent/src/discord/gitConfirm.ts");
        const t = await repositories().tenants.create({ name: "T", slug: "t" });
        await repositories().skills.setEnabled(t.id, "git_repositories", true);
        const [acc] = await db.insert(gitAccounts).values({ tenantId: t.id, name: "work", provider: "github", username: "octo", tokenEncrypted: encryptSecret("tok") }).returning();
        const [bot] = await db.insert(bots).values({ tenantId: t.id, tokenEncrypted: "x", isEnabled: false }).returning();
        await setBotGitAccounts(t.id, bot.id, [acc.id]);
        await replaceGitScopes(t.id, bot.id, "g1", "", [{ gitAccountId: acc.id, repoPatterns: ["acme/*"] }]);
        const calls = [];
        globalThis.fetch = async (url, init) => { calls.push((init?.method ?? "GET") + " " + url); return Response.json({}); };
        process.env.GIT_OWNER_DISCORD_IDS = "owner";
        const ctx = (userId) => ({ db, tenantId: t.id, botId: bot.id, guildId: "g1", channelId: "c1", userId });
        const run = (name, args, userId = "alice") => skillRegistry.executeTool({ id: name, name, arguments: args }, ctx(userId));
        const effect = (name) => skillRegistry.catalogue().flatMap((s) => s.tools).find((x) => x.name === name).effect;

        const confirmable = [["repoAddMember", { repo: "acme/api", user: "bob", role: "push" }], ["repoSetRole", { repo: "acme/api", user: "bob", role: "admin" }],
          ["repoVariables", { repo: "acme/api", action: "set", name: "X", value: "1" }], ["repoSnippets", { action: "create", title: "s", files: { "a.md": "x" } }]];
        for (const [name, args] of confirmable) {
          assert(effect(name) === "danger", name + " is not tagged danger");
          const res = await run(name, args);
          assert(res.success && pendingOf(res.data), name + " was not queued for a non-owner: " + JSON.stringify(res));
        }
        for (const [name, args] of [["repoDelete", { repo: "acme/api" }], ["repoTransfer", { repo: "acme/api", target: "x" }], ["repoSecrets", { repo: "acme/api", action: "set", name: "S", value: "v" }]]) {
          const res = await run(name, args);
          assert(!res.success && /limited to the bot's owners/.test(res.error), name + " accepted from a non-owner: " + JSON.stringify(res));
          assert(pendingOf((await run(name, args, "owner")).data), name + " not queued for the owner");
        }
        assert(calls.every((c) => c.startsWith("GET")), "a change reached the provider before Confirm: " + calls);
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: "sqlite:" + join(dir, "t.db"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), NODE_ENV: "test" },
    });
    expect(r.exitCode, new TextDecoder().decode(r.stderr)).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
