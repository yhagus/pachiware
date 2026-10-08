import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pure resolver logic imports @pachiware/db, which opens a database, so it runs in a throwaway SQLite process.
test("git scope: default none, server on, channel narrows, thread uses parent, wildcard, account argument", () => {
  const dir = mkdtempSync(join(tmpdir(), "git-scope-"));
  try {
    const r = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const { computeAccess, repoAllowed, pickAccess } = await import(${JSON.stringify(join(process.cwd(), "packages/skills/src/gitScope.ts"))});
        const A = { id: "a", name: "Work", provider: "github", baseUrl: null, authType: "token" }, B = { id: "b", name: "Home", provider: "gitlab", baseUrl: null, authType: "token" };
        const rule = (gitAccountId, channelId, ...repoPatterns) => ({ gitAccountId, channelId, repoPatterns });
        const names = (l) => l.map((x) => x.account.name).sort().join(",");
        const none = computeAccess([A, B], [], "c1");
        const server = [rule("a", "", "acme/*"), rule("b", "", "*")];
        const onServer = computeAccess([A, B], server, "c1");
        const narrowed = computeAccess([A, B], [...server, rule("a", "c1", "acme/api")], "c1");
        const thread = computeAccess([A, B], [...server, rule("a", "c1", "acme/api")], "t9", "c1");
        const otherChan = computeAccess([A, B], [...server, rule("a", "c1", "acme/api")], "c2");
        const unattached = computeAccess([A], [rule("b", "", "*")], "c1");
        const work = onServer.find((x) => x.account.name === "Work"), nar = narrowed.find((x) => x.account.name === "Work");
        let noneMsg = "", ambiguous = "", unknown = "";
        try { pickAccess(none); } catch (e) { noneMsg = e.message; }
        try { pickAccess(onServer); } catch (e) { ambiguous = e.message; }
        try { pickAccess(onServer, "nope"); } catch (e) { unknown = e.message; }
        console.log(JSON.stringify({
          none: none.length, onServer: names(onServer), narrowed: names(narrowed), thread: names(thread), otherChan: names(otherChan), unattached: unattached.length,
          allowed: [repoAllowed(work, "ACME/web"), repoAllowed(work, "evil/web"), repoAllowed(nar, "acme/api"), repoAllowed(nar, "acme/web")],
          single: pickAccess([onServer[0]]).account.name, byName: pickAccess(onServer, " home ").account.name,
          noneMsg: noneMsg.includes("No git account"), ambiguous: ambiguous.includes("Work, Home") || ambiguous.includes("Home, Work"), unknown: unknown.includes("Unknown"),
        }));
      `],
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, NODE_ENV: "test", PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") },
    });
    expect(new TextDecoder().decode(r.stderr)).toBe("");
    expect(JSON.parse(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)!)).toEqual({
      none: 0, onServer: "Home,Work", narrowed: "Work", thread: "Work", otherChan: "Home,Work", unattached: 0,
      allowed: [true, false, true, false], single: "Work", byName: "Home", noneMsg: true, ambiguous: true, unknown: true,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
