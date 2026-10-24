import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();

test("git accounts: verified, write-only token, shared across bots, tenant-bound, delete blocked while used", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-git-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (c, m) => { if (!c) throw new Error(m); };
        const { runMigrations } = await import(${JSON.stringify(join(w, "packages/db/src/migrate.ts"))});
        const { runSeed } = await import(${JSON.stringify(join(w, "packages/db/src/seed.ts"))});
        const { repositories } = await import(${JSON.stringify(join(w, "packages/db/src/index.ts"))});
        await runMigrations(); await runSeed();
        const { createServer } = await import(${JSON.stringify(join(w, "apps/agent/src/server.ts"))});
        const app = createServer();
        const admin = { "X-Platform-Key": "k", "Content-Type": "application/json" };
        const realFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => String(url).endsWith("/user")
          ? (init.headers.Authorization === "Bearer good" || init.headers["PRIVATE-TOKEN"] === "good" ? Response.json({ login: "octo", username: "octo" }) : new Response("no", { status: 401 }))
          : realFetch(url, init);
        const j = async (res) => res.json();
        const tenant = async (slug) => (await j(await app.request("/api/admin/tenants", { method: "POST", headers: admin, body: JSON.stringify({ name: slug, slug }) }))).tenant;
        const a = await tenant("a"), b = await tenant("b");
        const post = (t, body) => app.request("/api/admin/tenants/" + t.id + "/git-accounts", { method: "POST", headers: admin, body: JSON.stringify(body) });
        assert((await post(a, { name: "x", provider: "github", token: "bad" })).status === 400, "bad token accepted");
        assert((await post(a, { name: "x", provider: "bitbucket", token: "good" })).status === 400, "bad provider accepted");
        assert((await post(a, { name: "x", provider: "gitlab", baseUrl: "http://plain", token: "good" })).status === 400, "http baseUrl accepted");
        const created = await post(a, { name: "main", provider: "github", token: "good" });
        assert(created.status === 201, "create failed");
        const acc = (await j(created)).gitAccount;
        assert(acc.username === "octo" && acc.hasToken && !("tokenEncrypted" in acc), "public shape wrong");
        const row = await repositories().git.getAccount(acc.id);
        assert(row.tokenEncrypted && row.tokenEncrypted !== "good", "token not encrypted");
        assert((await post(a, { name: "main", provider: "github", token: "good" })).status === 409, "duplicate name accepted");
        const other = (await j(await post(b, { name: "main", provider: "gitlab", token: "good" }))).gitAccount;
        const mkBot = (t, body) => app.request("/api/admin/tenants/" + t.id + "/bots", { method: "POST", headers: admin, body: JSON.stringify({ token: "t", isEnabled: false, ...body }) });
        const acc2 = (await j(await post(a, { name: "second", provider: "github", token: "good" }))).gitAccount;
        const b1 = await j(await mkBot(a, { name: "b1", gitAccountIds: [acc.id, acc2.id] }));
        const b2 = await j(await mkBot(a, { name: "b2", gitAccountIds: [acc.id] }));
        assert(b1.bot.gitAccountIds.length === 2 && b2.bot.gitAccountIds[0] === acc.id, "many/shared binding failed");
        const gitSkill = async (t) => (await repositories().skills.getForTenant(t.id, "git_repositories"))?.isEnabled;
        assert(await gitSkill(a) === true, "attaching an account did not turn the git skill on");
        assert(await gitSkill(b) === false, "another tenant's git skill was turned on");
        assert((await mkBot(a, { name: "b3", gitAccountIds: [other.id] })).status === 400, "cross-tenant account accepted");
        assert((await app.request("/api/admin/git-accounts/" + acc.id, { method: "DELETE", headers: admin })).status === 409, "delete allowed while in use");
        // Scopes: channel rules must sit inside server rules, and only attached accounts can be scoped.
        const put = (path, rules) => app.request("/api/admin/bots/" + b1.bot.id + "/guilds/g1" + path + "/git", { method: "PUT", headers: admin, body: JSON.stringify({ rules }) });
        assert((await put("", [{ gitAccountId: other.id, repoPatterns: ["*"] }])).status === 400, "unattached account scoped");
        assert((await put("/channels/c1", [{ gitAccountId: acc.id, repoPatterns: ["*"] }])).status === 400, "channel rule without server rule");
        assert((await put("", [{ gitAccountId: acc.id, repoPatterns: ["Org/*"] }, { gitAccountId: acc2.id, repoPatterns: ["*"] }])).status === 200, "server rule rejected");
        assert((await put("/channels/c1", [{ gitAccountId: acc.id, repoPatterns: ["org/api"] }])).status === 200, "narrower channel rule rejected");
        assert((await put("/channels/c2", [{ gitAccountId: acc.id, repoPatterns: ["*"] }])).status === 400, "wider channel rule accepted");
        const got = await j(await app.request("/api/admin/bots/" + b1.bot.id + "/guilds/g1/git", { headers: admin }));
        assert(got.server.length === 2 && (got.server[0].repoPatterns[0] === "org/*" || got.server[1].repoPatterns[0] === "org/*"), "server rules not stored lowercased");
        assert(got.channels.c1.length === 1, "channel rule not stored");
        // Narrowing the server rule drops channel rules that no longer fit.
        await put("", [{ gitAccountId: acc2.id, repoPatterns: ["*"] }]);
        assert(!(await j(await app.request("/api/admin/bots/" + b1.bot.id + "/guilds/g1/git", { headers: admin }))).channels.c1, "stale channel rule kept");
        const detach = async (bot, ids) => j(await app.request("/api/admin/bots/" + bot.id, { method: "PATCH", headers: admin, body: JSON.stringify({ gitAccountIds: ids }) }));
        assert((await detach(b1.bot, [])).bot.gitAccountIds.length === 0, "detach failed");
        assert((await j(await app.request("/api/admin/bots/" + b1.bot.id + "/guilds/g1/git", { headers: admin }))).server.length === 0, "scopes survived detach");
        await detach(b2.bot, []);
        assert((await app.request("/api/admin/git-accounts/" + acc.id, { method: "DELETE", headers: admin })).status === 200, "delete after unbind failed");
        // Allowlist: rejects other hosts, accepts listed ones, and rejects bad entries.
        const hosts = (h) => app.request("/api/admin/infrastructure/git-hosts", { method: "PUT", headers: admin, body: JSON.stringify({ hosts: h }) });
        assert((await hosts(["https://x.com"])).status === 400, "scheme accepted in host list");
        assert((await hosts(["gitlab.corp.example"])).status === 200, "host list not saved");
        assert((await post(a, { name: "w", provider: "gitlab", baseUrl: "https://evil.example", token: "good" })).status === 400, "unlisted host accepted");
        assert((await post(a, { name: "w", provider: "gitlab", baseUrl: "https://gitlab.corp.example", token: "good" })).status === 201, "listed host rejected");
        assert((await post(a, { name: "gh", provider: "github", token: "good" })).status === 201, "default host blocked by allowlist");
        // Changing the host without re-entering the token is refused, so the saved token never reaches a new host.
        const patch = (id, b) => app.request("/api/admin/git-accounts/" + id, { method: "PATCH", headers: admin, body: JSON.stringify(b) });
        const listed = (await j(await app.request("/api/admin/tenants/" + a.id + "/git-accounts", { headers: admin }))).gitAccounts.find((x) => x.name === "w");
        assert((await patch(listed.id, { baseUrl: "https://gitlab.corp.example" })).status === 200, "unchanged host should not need a token");
        await hosts(["gitlab.corp.example", "other.corp.example"]);
        assert((await patch(listed.id, { baseUrl: "https://other.corp.example" })).status === 400, "host change without token accepted");
        assert((await patch(listed.id, { baseUrl: "https://other.corp.example", token: "good" })).status === 200, "host change with token rejected");
        await hosts([]);
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "g.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" },
    });
    expect(r.exitCode, new TextDecoder().decode(r.stderr)).toBe(0);
    expect(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
