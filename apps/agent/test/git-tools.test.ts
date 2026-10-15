import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const w = process.cwd();

test("LLM lists repos then merge requests of the first one; scope hides other repos and closes git without a rule", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-gittools-"));
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
        const { agentReActLoop } = await imp("apps/agent/src/loop/react.ts");
        const { llmRouter } = await imp("apps/agent/src/llm/router.ts");
        const t = await repositories().tenants.create({ name: "T", slug: "t" });
        await repositories().skills.setEnabled(t.id, "git_repositories", true);
        const acc = await repositories().git.createAccount({ tenantId: t.id, name: "work", provider: "github", username: "octo", tokenEncrypted: encryptSecret("tok") });
        const bot = await repositories().bots.create({ tenantId: t.id, token: "x", isEnabled: false });
        await repositories().git.setBotAccounts(t.id, bot.id, [acc.id]);

        const urls = [];
        globalThis.fetch = async (url) => {
          urls.push(String(url));
          if (String(url).includes("/user/repos")) return Response.json([
            { full_name: "acme/api", owner: { login: "acme" }, private: true, default_branch: "main", updated_at: "x", html_url: "u" },
            { full_name: "secret/vault", owner: { login: "secret" }, private: true, default_branch: "main", updated_at: "x", html_url: "u" }]);
          if (String(url).includes("/repos/acme/api/pulls")) return Response.json([{ number: 7, title: "Fix login", state: "open", user: { login: "bob" }, head: { ref: "fix" }, base: { ref: "main" }, labels: [], html_url: "u", created_at: "x" }]);
          return new Response("unexpected " + url, { status: 500 });
        };

        // Scripted model: step 1 lists repos, step 2 reads the first repo it saw, step 3 answers.
        const seen = [];
        llmRouter.complete = async (messages) => {
          const unwrap = (c) => c.replace(/<[^>]*untrusted_data[^>]*>/g, "").trim();
          const tools = messages.filter((m) => m.role === "tool").map((m) => ({ ...m, content: unwrap(m.content) }));
          seen.push(tools.length);
          if (tools.length === 0) return { content: null, finishReason: "tool_calls", toolCalls: [{ id: "1", name: "repoList", arguments: {} }] };
          if (tools.length === 1 && !JSON.parse(tools[0].content).error) {
            const first = JSON.parse(tools[0].content).items[0].repo;
            return { content: null, finishReason: "tool_calls", toolCalls: [{ id: "2", name: "repoMergeRequests", arguments: { repo: first } }] };
          }
          return { content: "done:" + tools.map((m) => m.content).join("|"), finishReason: "stop", toolCalls: [] };
        };
        const ask = (guildId, channelId) => agentReActLoop.run({ tenantId: t.id, botId: bot.id, message: "list my projects, then the merge requests of the first", context: { tenantId: t.id, platform: "discord", guildId, channelId, userId: "u1", skillContext: { parentChannelId: channelId } } });

        // No rule yet: git is closed.
        let out = await ask("g1", "c1");
        assert(out.reply.includes("No git account is enabled"), "git open without a rule: " + out.reply);
        assert(urls.length === 0, "provider called without a rule");

        await repositories().git.replaceScopes(t.id, bot.id, "g1", "", [{ gitAccountId: acc.id, repoPatterns: ["acme/*"] }]);
        out = await ask("g1", "c1");
        assert(out.toolCallsExecuted.map((x) => x.call.name).join() === "repoList,repoMergeRequests", "wrong tool chain: " + JSON.stringify(out.toolCallsExecuted.map((x) => x.call.name)));
        assert(out.toolCallsExecuted.every((x) => x.result.success), "a call failed: " + out.reply);
        assert(out.reply.includes("Fix login") && !out.reply.includes("secret/vault"), "scope leak or missing MR: " + out.reply);
        assert(urls.some((u) => u.includes("/repos/acme/api/pulls")), "MR endpoint not hit");

        // Direct call outside the pattern is refused before reaching the provider.
        urls.length = 0;
        const { skillRegistry } = await imp("packages/skills/src/registry.ts");
        const refused = await skillRegistry.executeTool({ id: "x", name: "repoMergeRequests", arguments: { repo: "secret/vault" } }, { tenantId: t.id, botId: bot.id, guildId: "g1", channelId: "c1" });
        assert(!refused.success && refused.error.includes("not enabled") && urls.length === 0, "out-of-scope repo allowed");
        // Another server has no rule.
        const other = await skillRegistry.executeTool({ id: "y", name: "repoList", arguments: {} }, { tenantId: t.id, botId: bot.id, guildId: "g2", channelId: "c9" });
        assert(!other.success && other.error.includes("No git account"), "other server not closed");
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "g.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" },
    });
    expect(new TextDecoder().decode(r.stderr).trim()).toBe("");
    expect(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
