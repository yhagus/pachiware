import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("bot holds many git accounts; cross-tenant rejected; legacy column backfilled; scopes cascade; patternCovers", () => {
  const dir = mkdtempSync(join(tmpdir(), "git-acc-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        import { runMigrations, queryClient, repositories, patternCovers } from ${JSON.stringify(join(process.cwd(), "packages/db/src/index.ts"))};
        const run = (s) => queryClient.exec(s);
        // Pre-existing install: bots.git_account_id set before the join table exists.
        await runMigrations();
        run("PRAGMA foreign_keys = ON");
        run("INSERT INTO tenants (id,name,slug) VALUES ('t1','a','a'),('t2','b','b')");
        run("INSERT INTO git_accounts (id,tenant_id,name,provider,username,token_encrypted) VALUES ('g1','t1','main','github','me','x'),('g2','t1','alt','gitlab','me','x'),('g3','t2','other','github','me','x')");
        run("INSERT INTO bots (id,tenant_id,token_encrypted,git_account_id) VALUES ('b1','t1','x','g1')");
        await runMigrations();
        const backfilled = (await repositories().git.listBotAccounts("b1")).map((a) => a.id);
        await repositories().git.setBotAccounts("t1", "b1", ["g1", "g2"]);
        const many = (await repositories().git.listBotAccounts("b1")).length;
        let crossTenant = false;
        try { await repositories().git.setBotAccounts("t1", "b1", ["g3"]); } catch { crossTenant = true; }
        let fkRejected = false;
        try { run("INSERT INTO bot_git_accounts (id,tenant_id,bot_id,git_account_id) VALUES ('x','t1','b1','g3')"); } catch { fkRejected = true; }
        await repositories().git.replaceScopes("t1", "b1", "guild", "", [{ gitAccountId: "g1", repoPatterns: ["Org/*"] }, { gitAccountId: "g2", repoPatterns: ["*"] }]);
        await repositories().git.replaceScopes("t1", "b1", "guild", "chan", [{ gitAccountId: "g1", repoPatterns: ["org/api"] }]);
        let wider = false;
        try { await repositories().git.replaceScopes("t1", "b1", "guild", "chan2", [{ gitAccountId: "g1", repoPatterns: ["*"] }]); } catch { wider = true; }
        await repositories().git.setBotAccounts("t1", "b1", ["g2"]);
        const left = (await repositories().git.listScopes("b1", "guild")).map((s) => s.gitAccountId);
        console.log(JSON.stringify({ backfilled, many, crossTenant, fkRejected, wider, left,
          covers: [patternCovers("*", "a/b"), patternCovers("org/*", "org/api"), patternCovers("org/*", "other/api"), patternCovers("org/api", "org/*"), patternCovers("org/*", "org/a*")] }));
      `],
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, NODE_ENV: "test", PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") },
    });
    expect(new TextDecoder().decode(r.stderr)).toBe("");
    expect(JSON.parse(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)!)).toEqual({
      backfilled: ["g1"], many: 2, crossTenant: true, fkRejected: true, wider: true, left: ["g2"], covers: [true, true, false, false, true],
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
