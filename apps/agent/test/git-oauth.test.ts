import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();

test("git oauth: start needs an app, callback is single-use, account created, token refreshed, secrets hidden", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-oauth-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (c, m) => { if (!c) throw new Error(m); };
        const { runMigrations } = await import(${JSON.stringify(join(w, "packages/db/src/migrate.ts"))});
        const { runSeed } = await import(${JSON.stringify(join(w, "packages/db/src/seed.ts"))});
        const { db, gitAccounts, eq } = await import(${JSON.stringify(join(w, "packages/db/src/index.ts"))});
        const { getGitToken } = await import(${JSON.stringify(join(w, "packages/skills/src/gitOAuth.ts"))});
        await runMigrations(); await runSeed();
        const { createServer } = await import(${JSON.stringify(join(w, "apps/agent/src/server.ts"))});
        const app = createServer();
        const admin = { "X-Platform-Key": "k", "Content-Type": "application/json" };
        const realFetch = globalThis.fetch; let tokenCalls = [];
        globalThis.fetch = async (url, init) => {
          const u = String(url);
          if (u.endsWith("/login/oauth/access_token")) { tokenCalls.push(init.body.toString()); return Response.json({ access_token: "gho_new" }); }
          if (u.endsWith("/oauth/token")) { tokenCalls.push(init.body.toString()); return Response.json({ access_token: "gl_" + tokenCalls.length, refresh_token: "r" + tokenCalls.length, expires_in: 7200 }); }
          if (u.endsWith("/user")) return Response.json({ login: "octo", username: "octo" });
          return realFetch(url, init);
        };
        const j = (res) => res.json();
        const t = (await j(await app.request("/api/admin/tenants", { method: "POST", headers: admin, body: JSON.stringify({ name: "a", slug: "a" }) }))).tenant;
        const start = (body) => app.request("/api/admin/tenants/" + t.id + "/git-accounts/oauth/start", { method: "POST", headers: admin, body: JSON.stringify(body) });
        assert((await start({ provider: "github" })).status === 404, "start without an OAuth app worked");
        const created = await app.request("/api/admin/git-oauth-apps", { method: "POST", headers: admin, body: JSON.stringify({ provider: "github", clientId: "cid", clientSecret: "shh" }) });
        assert(created.status === 201, "app create failed");
        assert(!JSON.stringify(await j(created)).includes("shh"), "secret leaked");
        assert(!JSON.stringify(await j(await app.request("/api/admin/git-oauth-apps", { headers: admin }))).includes("shh"), "secret leaked in list");
        const { authorizeUrl } = await j(await start({ provider: "github" }));
        const au = new URL(authorizeUrl);
        assert(au.host === "github.com" && au.searchParams.get("client_id") === "cid" && au.searchParams.get("code_challenge_method") === "S256", "bad authorize url");
        const cb = (q) => app.request("/api/oauth/git/callback?" + q);
        assert((await cb("state=bogus&code=x")).status === 400, "unknown state accepted");
        const ok = await cb("state=" + au.searchParams.get("state") + "&code=abc");
        assert(ok.status === 302 && ok.headers.get("location").includes("git=octo"), "callback did not succeed: " + ok.headers.get("location"));
        assert(tokenCalls[0].includes("client_secret=shh") && tokenCalls[0].includes("code_verifier="), "exchange missing secret/verifier");
        assert((await cb("state=" + au.searchParams.get("state") + "&code=abc")).status === 400, "state reused");
        const list = (await j(await app.request("/api/admin/tenants/" + t.id + "/git-accounts", { headers: admin }))).gitAccounts;
        assert(list.length === 1 && list[0].username === "octo" && list[0].authType === "oauth" && !("refreshTokenEncrypted" in list[0]), "account shape wrong");
        // GitLab: expiring token is refreshed and persisted
        await app.request("/api/admin/git-oauth-apps", { method: "POST", headers: admin, body: JSON.stringify({ provider: "gitlab", clientId: "gid", clientSecret: "gs" }) });
        const g = new URL((await j(await start({ provider: "gitlab" }))).authorizeUrl);
        await cb("state=" + g.searchParams.get("state") + "&code=c2");
        const [gl] = await db.select().from(gitAccounts).where(eq(gitAccounts.provider, "gitlab"));
        assert(gl.refreshTokenEncrypted && gl.tokenExpiresAt, "gitlab refresh data not stored");
        assert(await getGitToken(gl) === "gl_2", "fresh token should be returned as-is");
        await db.update(gitAccounts).set({ tokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(gitAccounts.id, gl.id));
        const [stale] = await db.select().from(gitAccounts).where(eq(gitAccounts.id, gl.id));
        assert(await getGitToken(stale) === "gl_3" && tokenCalls.at(-1).includes("grant_type=refresh_token"), "expired token not refreshed");
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "o.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" },
    });
    expect(new TextDecoder().decode(r.stderr).trim()).toBe("");
    expect(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
