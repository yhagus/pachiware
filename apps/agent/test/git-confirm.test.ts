import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();

test("git write tools queue, only the asker can confirm, confirm runs once, cancel runs nothing, scope is re-checked", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-gitconfirm-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (c, m) => { if (!c) throw new Error(m); };
        const imp = (p) => import(${JSON.stringify(w + "/")} + p);
        const { runMigrations } = await imp("packages/db/src/migrate.ts");
        const { runSeed } = await imp("packages/db/src/seed.ts");
        const { encryptSecret } = await imp("packages/db/src/index.ts");
        const { repositories } = await imp("packages/db/src/index.ts");
        await runMigrations(); await runSeed();
        const { skillRegistry } = await imp("packages/skills/src/registry.ts");
        const { handleConfirmButton, pendingOf } = await imp("apps/agent/src/discord/gitConfirm.ts");
        const t = await repositories().tenants.create({ name: "T", slug: "t" });
        await repositories().skills.setEnabled(t.id, "git_repositories", true);
        const acc = await repositories().git.createAccount({ tenantId: t.id, name: "work", provider: "github", username: "octo", tokenEncrypted: encryptSecret("tok") });
        const bot = await repositories().bots.create({ tenantId: t.id, token: "x", isEnabled: false });
        await repositories().git.setBotAccounts(t.id, bot.id, [acc.id]);
        await repositories().git.replaceScopes(t.id, bot.id, "g1", "", [{ gitAccountId: acc.id, repoPatterns: ["acme/*"] }]);

        const calls = [];
        globalThis.fetch = async (url, init) => { calls.push((init?.method ?? "GET") + " " + url); return Response.json({ html_url: "https://x/1", number: 5, merged: true }); };
        const ctx = { tenantId: t.id, botId: bot.id, guildId: "g1", channelId: "c1", userId: "alice" };
        const run = (name, args, c = ctx) => skillRegistry.executeTool({ id: "x", name, arguments: args }, c);
        const click = async (verb, id, user) => {
          const log = { replies: [], updates: [] };
          const handled = await handleConfirmButton({ customId: "gitconfirm:" + verb + ":" + id, user: { id: user }, reply: async (o) => log.replies.push(o), update: async (o) => log.updates.push(o) }, bot.id);
          return { handled, ...log };
        };

        // 1. Queued, nothing sent to the provider.
        const q = await run("repoComment", { repo: "acme/api", number: 3, kind: "issue", body: "hello" });
        const p = pendingOf(q.data);
        assert(q.success && p && p.summary.includes("acme/api#3"), "not queued: " + JSON.stringify(q));
        assert(calls.length === 0, "provider called before confirmation: " + calls);
        // 2. Model-supplied 'confirmed' in arguments does not skip the gate.
        const sneaky = await run("repoCloseItem", { repo: "acme/api", number: 1, kind: "issue", confirmed: true });
        assert(pendingOf(sneaky.data) && calls.length === 0, "arguments bypassed confirmation");
        // 3. Out of scope is refused up front, nothing queued.
        const out = await run("repoComment", { repo: "secret/vault", number: 1, kind: "issue", body: "x" });
        assert(!out.success && out.error.includes("not enabled"), "out-of-scope queued");
        // 4. Another user cannot confirm; the action stays pending.
        const other = await click("ok", p.confirmationId, "mallory");
        assert(other.handled && other.replies.length === 1 && other.updates.length === 0 && calls.length === 0, "wrong user confirmed");
        // 5. The asker confirms: runs exactly once.
        const ok = await click("ok", p.confirmationId, "alice");
        assert(ok.handled && ok.updates.length === 1 && !ok.updates[0].embeds && ok.updates[0].content.includes("Completed") && calls.join().includes("POST https://api.github.com/repos/acme/api/issues/3/comments"), "confirm did not run as assistant text: " + calls);
        const n = calls.length;
        const again = await click("ok", p.confirmationId, "alice");
        assert(calls.length === n && again.updates.length === 1, "ran twice");
        // 6. Cancel runs nothing.
        const q2 = pendingOf((await run("repoMergeMergeRequest", { repo: "acme/api", number: 9 })).data);
        const before = calls.length;
        const no = await click("no", q2.confirmationId, "alice");
        assert(no.updates.length === 1 && calls.length === before, "cancel ran the action");
        // 7. Scope narrowed after queueing: confirm re-checks and refuses.
        const q3 = pendingOf((await run("repoCreateIssue", { repo: "acme/web", title: "T" })).data);
        await repositories().git.replaceScopes(t.id, bot.id, "g1", "", [{ gitAccountId: acc.id, repoPatterns: ["acme/api"] }]);
        const late = await click("ok", q3.confirmationId, "alice");
        assert(late.updates[0].content.includes("couldn't complete") && !late.updates[0].embeds && !calls.join().includes("/repos/acme/web/issues"), "narrowed scope not re-checked");
        // 8. Not a git button: left alone.
        const foreign = await handleConfirmButton({ customId: "other:ok:1", user: { id: "alice" }, reply: async () => {}, update: async () => {} }, bot.id);
        assert(foreign === false, "foreign button handled");
        // 9. A configured owner can grant the current thread once; the waiting action runs and the grant is reusable.
        process.env.GIT_OWNER_DISCORD_IDS = "owner";
        await repositories().git.replaceScopes(t.id, bot.id, "g1", "", [{ gitAccountId: acc.id, repoPatterns: ["acme/*"] }]);
        const grantQueued = pendingOf((await run("repoComment", { repo: "acme/api", number: 7, kind: "issue", body: "grant me" })).data);
        const deniedGrant = await click("grant", grantQueued.confirmationId, "alice");
        assert(deniedGrant.replies.length === 1 && deniedGrant.updates.length === 0 && calls.length === n, "non-owner grant was accepted");
        const granted = await click("grant", grantQueued.confirmationId, "owner");
        assert(granted.updates.length === 1 && granted.updates[0].content.includes("Changes in this thread are confirmed from now on"), "owner grant did not execute waiting action");
        const beforeGrantedFollowup = calls.length;
        const followup = await run("repoComment", { repo: "acme/api", number: 8, kind: "issue", body: "already approved" });
        assert(followup.success && !pendingOf(followup.data) && calls.length === beforeGrantedFollowup + 1, "thread grant did not apply to follow-up action");
        const differentThread = await run("repoComment", { repo: "acme/api", number: 9, kind: "issue", body: "new thread" }, { ...ctx, channelId: "c2" });
        assert(pendingOf(differentThread.data), "grant leaked into another thread");
        // 9. Write tools without a Discord user cannot queue.
        const noUser = await run("repoComment", { repo: "acme/api", number: 1, kind: "issue", body: "x" }, { tenantId: t.id, botId: bot.id, guildId: "g1", channelId: "c1" });
        assert(!noUser.success, "queued without a user");
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "g.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" },
    });
    expect(new TextDecoder().decode(r.stderr).trim()).toBe("");
    expect(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
