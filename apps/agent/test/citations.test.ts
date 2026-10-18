import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";
import { renderCitations } from "../src/loop/citations";

// Citations rendered by the server, links in replies checked (#212, ADR 0014).

const AUDIO = "guilds/guild-1/channels/channel-2";
const MINUTES = `---\ntitle: "Loudness"\nguildId: "guild-1"\nchannelId: "channel-2"\npostedIn: "channel-2"\nmessageId: "5100"\n---\n# Loudness\n\n## Decided\n1. Audio normalization targets -14 LUFS.\n`;

async function setUp(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-2").name = "audio";
  await s.workspace.write(`${AUDIO}/minutes/2026-09-01-loudness.md`, MINUTES);
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api", owner: { login: "acme" }, private: true, default_branch: "main", updated_at: "2026-10-10T00:00:00Z", html_url: "https://github.com/acme/api" }]);
  s.http.on("GET api.github.com/search/issues", () => ({ total_count: 1, items: [
    { number: 88, title: "Normalize audio loudness", state: "closed", html_url: "https://github.com/acme/api/pull/88", updated_at: "2026-10-12T09:00:00Z", closed_at: "2026-10-12T09:00:00Z",
      pull_request: { merged_at: "2026-10-12T09:00:00Z", html_url: "https://github.com/acme/api/pull/88" } },
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/commits", () => []);
}
const RECALL = { tool: "recall", args: { queries: ["normalisasi audio", "audio normalization"] } };
const denied = async (s: Scenario) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type: "guardrail_denied" })).map((e: any) => e.metadata).filter((m: any) => m.kind === "citation");
};

discordScenario("a reply citing [K1] and [G1] after recall shows each source's label and link as the tool gave them", async (s) => {
  await setUp(s);
  s.model.script(RECALL, "Discussed in the Loudness Minutes [K1]; done in a merged pull request [G1].");
  await s.discord.send(`${s.discord.mention} is audio normalization done?`);
  expect(s.discord.botMessages.at(-1)!.content).toBe(
    "Discussed in the Loudness Minutes [#audio · Minutes 2026-09-01](<https://discord.com/channels/guild-1/channel-2/5100>); "
    + "done in a merged pull request [acme/api · pull request #88 \"Normalize audio loudness\" (merged)](<https://github.com/acme/api/pull/88>).",
  );
});

discordScenario("a reply citing [P1] after recall links the Work item to its page in Plane's web app", async (s) => {
  await setUp(s);
  await s.plane({ projects: ["*"] });
  const plane = fakePlane(s);
  plane.project({ id: "11111111-1111-4111-8111-111111111111", name: "Engineering", identifier: "ENG" });
  const done = plane.state({ project: "11111111-1111-4111-8111-111111111111", name: "Done", group: "completed" });
  plane.item({ project: "11111111-1111-4111-8111-111111111111", sequence_id: 3, name: "Audio normalization", state: done.id });
  s.model.script(RECALL, "Tracked in Plane [P1].");
  await s.discord.send(`${s.discord.mention} is audio normalization done?`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Tracked in Plane [ENG-3 \"Audio normalization\" (Done)](<https://app.plane.so/acme/browse/ENG-3/>).");
});

discordScenario("a ref no tool gave leaves no trace in the reply, and an audit row says so", async (s) => {
  await setUp(s);
  s.model.script(RECALL, "It was discussed [K1] and decided [K7].");
  await s.discord.send(`${s.discord.mention} was audio normalization decided?`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("It was discussed [#audio · Minutes 2026-09-01](<https://discord.com/channels/guild-1/channel-2/5100>) and decided.");
  expect(await denied(s)).toEqual([expect.objectContaining({ kind: "citation", reason: "unknown_ref", count: 1 })]);
});

discordScenario("a made-up link is removed; a link from the person's message and one from an earlier reply stay", async (s) => {
  await setUp(s);
  s.model.script(RECALL, "Done: https://github.com/acme/api/pull/88");
  await s.discord.send(`${s.discord.mention} is audio normalization done?`);
  s.model.script("Compare https://github.com/acme/api/pull/88 with https://docs.acme.test/brief and see [the spec](https://docs.acme.test/made-up) or https://github.com/acme/api/pull/99.");
  await s.discord.send(`${s.discord.mention} compare it with https://docs.acme.test/brief`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Compare https://github.com/acme/api/pull/88 with https://docs.acme.test/brief and see the spec or.");
  expect(await denied(s)).toEqual([expect.objectContaining({ kind: "citation", reason: "link_not_found", count: 2, observed: false })]);
});

discordScenario("in observe mode a made-up link stays and the audit row is still written", async (s) => {
  process.env.GUARDRAIL_MODE = "observe";
  await setUp(s);
  s.model.script("See https://docs.acme.test/made-up for it.");
  await s.discord.send(`${s.discord.mention} where is the loudness spec?`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("See https://docs.acme.test/made-up for it.");
  expect(await denied(s)).toEqual([expect.objectContaining({ kind: "citation", reason: "link_not_found", count: 1, observed: true })]);
});

discordScenario("the stored reply holds the rendered link, so a follow-up repeats it without a new search", async (s) => {
  await setUp(s);
  s.model.script(RECALL, "Discussed [K1].");
  await s.discord.send(`${s.discord.mention} was audio normalization discussed?`);
  s.model.script("Here it is again: https://discord.com/channels/guild-1/channel-2/5100");
  await s.discord.send(`${s.discord.mention} send me that link again`);
  expect(JSON.stringify(s.model.calls.at(-1))).toContain("Discussed [#audio · Minutes 2026-09-01](<https://discord.com/channels/guild-1/channel-2/5100>).");
  expect(s.discord.botMessages.at(-1)!.content).toBe("Here it is again: https://discord.com/channels/guild-1/channel-2/5100");
  expect(await denied(s)).toEqual([]);
});

// Brackets the first live Rapor (#240) showed reaching people (#242).
const SOURCES = new Map([
  ["K1", { label: "#sales · Minutes 2026-10-01", url: "https://discord.com/channels/g/c/1" }],
  ["K2", { label: "#sales · Decision 2026-10-03" }],
  ["G1", { label: "acme/web · pull request #5 \"Pricing page\" (merged 2026-10-04)", url: "https://github.com/acme/web/pull/5" }],
]);

test("a bracket of several refs renders each of them", () => {
  expect(renderCitations("Settled in the Decision [K2/K1].", SOURCES)).toEqual({ text: "Settled in the Decision #sales · Decision 2026-10-03 [#sales · Minutes 2026-10-01](<https://discord.com/channels/g/c/1>).", unknown: [] });
  expect(renderCitations("Shipped [K1, G1] and [K2 dan K9].", SOURCES)).toEqual({
    text: "Shipped [#sales · Minutes 2026-10-01](<https://discord.com/channels/g/c/1>) [acme/web · pull request #5 \"Pricing page\" (merged 2026-10-04)](<https://github.com/acme/web/pull/5>) and #sales · Decision 2026-10-03.",
    unknown: ["K9"],
  });
});

test("a bracket holding a ref and words of the model's own leaves the reply whole", () => {
  expect(renderCitations("Only pricing was decided [K1 was only a pricing decision, unrelated].", SOURCES).text).toBe("Only pricing was decided.");
  expect(renderCitations("Nothing about it [G1 search of kept material] in the notes.", SOURCES).text).toBe("Nothing about it in the notes.");
});

test("brackets without a ref, and a Markdown link's text, are left as written", () => {
  const reply = "- [x] Book the venue (T1 in the plan) and [plan T1](https://docs.acme.test/brief), [K 1] [sic]";
  expect(renderCitations(reply, SOURCES)).toEqual({ text: reply, unknown: [] });
});

test("web chat renders citations the same way: an unknown ref and a made-up link leave its reply", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-webchat-"));
  const w = process.cwd();
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
        globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "It is in the notes [K3], see https://made.up/notes" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "Content-Type": "application/json" } });
        const res = await app.request("/api/v1/chat", { method: "POST", headers, body: JSON.stringify({ message: "where are the loudness notes?" }) });
        const body = await res.json();
        assert(res.status === 200 && body.reply === "It is in the notes, see", "reply not cleaned: " + JSON.stringify(body));
        console.log("ok");
      `],
      cwd: w,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "w.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test", GUARDRAIL_MODE: "enforce" },
    });
    expect(new TextDecoder().decode(r.stderr).trim()).toBe("");
    expect(new TextDecoder().decode(r.stdout).trim().split("\n").at(-1)).toBe("ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
