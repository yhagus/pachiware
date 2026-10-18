import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

// The documentation mirror (#248): an admin picks a repository and paths per channel; the bot copies the matching text files of its default
// branch into the channel's files/docs/ as Documents, refreshes them each night with the Daily logs, and recall finds them like any kept file.

const MIRROR = "guilds/guild-1/channels/channel-1/files/docs/acme/api";
const config = (botId: string) => `/api/admin/bots/${botId}/guilds/guild-1/config`;
const SOURCE = { channelId: "channel-1", repo: "acme/api", paths: ["README.md", "docs/**"] };
type Repo = { commit: string; files: Record<string, { sha: string; text?: string; size?: number }> };

/** acme/api on GitHub, default branch "main", whose head and files the test changes between refreshes. */
function stubRepo(s: Scenario, repo: Repo) {
  const api = "api.github.com/repos/acme/api";
  s.http.on(`GET ${api}`, () => ({ full_name: "acme/api", default_branch: "main" }));
  s.http.on(`GET ${api}/branches/main`, () => ({ name: "main", commit: { sha: repo.commit } }));
  s.http.on(`GET ${api}/git/trees/`, () => ({ sha: `tree-${repo.commit}`, truncated: false, tree: [
    { path: "docs", type: "tree", sha: "d0" },
    ...Object.entries(repo.files).map(([path, f]) => ({ path, type: "blob", sha: f.sha, size: f.size ?? Buffer.byteLength(f.text ?? "") })),
  ] }));
  s.http.on(`GET ${api}/git/blobs/`, (req) => {
    const sha = req.url.split("/git/blobs/")[1], file = Object.values(repo.files).find((f) => f.sha === sha);
    return file ? { sha, encoding: "base64", content: Buffer.from(file.text ?? "").toString("base64") } : new Response("", { status: 404 });
  });
}
const requested = (s: Scenario, part: string) => s.http.requests.filter((r) => r.url.includes(part)).map((r) => r.url.split(part)[1]);
const manifest = async (s: Scenario, folder = MIRROR) => JSON.parse((await s.workspace.read(`${folder}/.mirror.json`))!);
const audits = async (s: Scenario, type: string) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type })).map((e: any) => e.metadata);
};

discordScenario("saving a doc source mirrors the matching text files as Documents with keyword heads, and recall finds one by a word only its keywords hold", async (s) => {
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.channel("channel-1").name = "general";
  await s.git({ provider: "github", repos: ["acme/*"] });
  stubRepo(s, { commit: "c1", files: {
    "README.md": { sha: "aa01", text: "# Acme API\nThe public API of Acme.\n" },
    "docs/deploy.md": { sha: "aa02", text: "# Deploying\nTag the commit, build the image, roll it out.\n" },
    "docs/huge.md": { sha: "aa03", size: 300 * 1024 },
    "docs/logo.png": { sha: "aa04", text: "png" },
    "src/index.ts": { sha: "aa05", text: "export {}" },
  } });
  s.model.keywords(
    JSON.stringify({ topics: ["Acme API"], keywords: ["api", "acme"] }),
    JSON.stringify({ topics: ["Deploying"], keywords: ["rilis", "release", "deploy", "penerapan"] }),
  );

  const saved = await s.admin("PUT", config(s.bot.id), { docSources: [{ channelId: "channel-1", repo: "Acme/API", paths: ["README.md", "docs/**"], account: "" }] });
  expect(saved.status).toBe(200);
  expect(saved.body.config.docSources).toEqual([SOURCE]);

  expect(await s.workspace.files("guilds/guild-1/channels/channel-1/files")).toEqual([`${MIRROR}/README.md`, `${MIRROR}/docs/deploy.md`]);
  expect(await s.workspace.read(`${MIRROR}/docs/deploy.md`)).toBe(`---\ntopics: ["Deploying"]\nkeywords: ["rilis","release","deploy","penerapan"]\n---\n# Deploying\nTag the commit, build the image, roll it out.\n`);
  expect(requested(s, "/git/blobs/")).toEqual(["aa01", "aa02"]);
  expect(await manifest(s)).toMatchObject({ repo: "acme/api", branch: "main", commit: "c1", paths: ["README.md", "docs/**"], files: { "README.md": "aa01", "docs/deploy.md": "aa02" }, skipped: [{ path: "docs/huge.md", reason: "tooLarge" }], leftOut: 0 });

  // recall also searches the repository's issues and commits, which hold nothing here.
  s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api", owner: { login: "acme" }, private: true, default_branch: "main", updated_at: "2026-03-01T00:00:00Z", html_url: "https://github.com/acme/api" }]);
  s.http.on("GET api.github.com/search/issues", () => ({ total_count: 0, items: [] }));
  s.http.on("GET api.github.com/repos/acme/api/commits", () => []);
  s.http.on("GET api.github.com/search/commits", () => ({ total_count: 0, items: [] }));
  let result: any;
  s.model.script({ tool: "recall", args: { queries: ["rilis", "jadwal rilis"] } }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} how do we do a rilis?`);
  expect(result.kept.map((k: any) => [k.ref, k.path])).toEqual([["K1", "channel/files/docs/acme/api/docs/deploy.md"]]);
  expect(result.kept[0].label).toStartWith("#general · Document, filed ");
});

discordScenario("a night's refresh reads only the blobs that changed, deletes a file that left upstream, and skips the tree when the head is unchanged", async (s) => {
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.git({ provider: "github", repos: ["acme/*"] });
  const repo: Repo = { commit: "c1", files: {
    "README.md": { sha: "aa01", text: "# Acme API\n" },
    "docs/deploy.md": { sha: "aa02", text: "# Deploying\nv1\n" },
    "docs/old.md": { sha: "aa03", text: "# Old\n" },
  } };
  stubRepo(s, repo);
  await s.admin("PUT", config(s.bot.id), { docSources: [SOURCE] });
  expect(s.model.keywordCalls).toHaveLength(3);

  repo.commit = "c2";
  repo.files["docs/deploy.md"] = { sha: "bb02", text: "# Deploying\nv2\n" };
  delete repo.files["docs/old.md"];
  repo.files["docs/guides/new.md"] = { sha: "bb04", text: "# Renamed old\n" };
  s.clock.set("2026-03-07T00:29:00+07:00");
  await s.scheduler.tick();
  expect(requested(s, "/branches/main")).toHaveLength(1);

  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(requested(s, "/git/blobs/")).toEqual(["aa01", "aa02", "aa03", "bb02", "bb04"]);
  expect(s.model.keywordCalls).toHaveLength(5);
  expect(await s.workspace.files(MIRROR)).toEqual([`${MIRROR}/README.md`, `${MIRROR}/docs/deploy.md`, `${MIRROR}/docs/guides/new.md`]);
  expect(await s.workspace.read(`${MIRROR}/docs/deploy.md`)).toBe("# Deploying\nv2\n");
  expect((await manifest(s)).files).toEqual({ "README.md": "aa01", "docs/deploy.md": "bb02", "docs/guides/new.md": "bb04" });

  s.clock.set("2026-03-08T00:30:00+07:00");
  await s.scheduler.tick();
  expect(requested(s, "/branches/main")).toHaveLength(3);
  expect(requested(s, "/git/trees/")).toEqual(["c1?recursive=1", "c2?recursive=1"]);

  expect((await s.admin("PUT", config(s.bot.id), { docSources: [] })).status).toBe(200);
  expect(await s.workspace.files("guilds/guild-1/channels/channel-1")).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual([]);
});

discordScenario("a doc source whose repository the channel's Git scope does not allow is refused with a 400 naming it, and nothing is saved", async (s) => {
  const account = await s.git({ provider: "github", repos: ["acme/*"] });
  await s.admin("PUT", `/api/admin/bots/${s.bot.id}/guilds/guild-1/channels/channel-2/git`, { rules: [{ gitAccountId: account.id, repoPatterns: ["acme/web"] }] });

  const outside = await s.admin("PUT", config(s.bot.id), { docSources: [{ channelId: "channel-1", repo: "secret/vault", paths: ["README.md"] }] });
  expect(outside).toEqual({ status: 400, body: { error: "The Git scope of channel channel-1 does not allow secret/vault for any git account of this bot. Open the repository to that channel first." } });
  const narrowed = await s.admin("PUT", config(s.bot.id), { docSources: [{ channelId: "channel-2", repo: "acme/api", paths: ["README.md"] }] });
  expect(narrowed.status).toBe(400);
  expect(narrowed.body.error).toContain("channel channel-2 does not allow acme/api");
  const otherAccount = await s.admin("PUT", config(s.bot.id), { docSources: [{ channelId: "channel-1", repo: "acme/api", account: "gitlab", paths: ["README.md"] }] });
  expect(otherAccount.body.error).toBe(`The Git scope of channel channel-1 does not allow acme/api for the git account "gitlab". Open the repository to that channel first.`);
  for (const bad of [[{ channelId: "channel-1", repo: "acme", paths: ["README.md"] }], [{ channelId: "channel-1", repo: "acme/api", paths: [] }], [{ channelId: "channel-1", repo: "acme/api", paths: ["../etc/passwd"] }],
    [SOURCE, { ...SOURCE, paths: ["adr/*.md"] }], [{ repo: "acme/api", paths: ["README.md"] }]]) {
    expect((await s.admin("PUT", config(s.bot.id), { docSources: bad })).status).toBe(400);
  }
  expect((await s.admin("GET", config(s.bot.id))).body.config.docSources).toEqual([]);
  expect(s.http.requests.filter((r) => r.url.includes("api.github.com"))).toEqual([]);
});

discordScenario("a source the Git scope stops allowing is skipped each night, audited once, and keeps its files", async (s) => {
  s.clock.set("2026-03-06T08:00:00+07:00");
  const account = await s.git({ provider: "github", repos: ["acme/*"] });
  stubRepo(s, { commit: "c1", files: { "README.md": { sha: "aa01", text: "# Acme API\n" } } });
  await s.admin("PUT", config(s.bot.id), { docSources: [SOURCE] });
  await s.admin("PUT", `/api/admin/bots/${s.bot.id}/guilds/guild-1/git`, { rules: [{ gitAccountId: account.id, repoPatterns: ["other/*"] }] });
  const before = s.http.requests.length;

  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  s.clock.set("2026-03-08T00:30:00+07:00");
  await s.scheduler.tick();
  expect(s.http.requests.length).toBe(before);
  expect(await audits(s, "docs_mirror_not_allowed")).toEqual([expect.objectContaining({ channelId: "channel-1", repo: "acme/api" })]);
  expect(await s.workspace.files(MIRROR)).toEqual([`${MIRROR}/README.md`]);
});

discordScenario("a refresh that fails is audited, and the Daily log of the same night is still written", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/repos/acme/api", () => new Response("down", { status: 502 }));
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }], docSources: [SOURCE] });
  s.discord.history([{ content: "Which day do we release?", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") }]);
  s.model.script(JSON.stringify({ topics: [{ name: "Release day", keywords: { id: ["hari rilis"], en: ["release day"] }, refs: [1] }], decided: [], open: [{ text: "Release day", refs: [1] }], next: [] }));

  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(await s.workspace.files("guilds/guild-1/channels/channel-1/daily-logs")).toEqual(["guilds/guild-1/channels/channel-1/daily-logs/2026-03/2026-03-06.md"]);
  expect(await audits(s, "docs_mirror_failed")).toEqual([expect.objectContaining({ channelId: "channel-1", repo: "acme/api", error: "Error", message: "github returned 502: down" })]);
});
