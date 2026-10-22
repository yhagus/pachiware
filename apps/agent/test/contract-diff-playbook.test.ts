import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";

const FIXTURE = JSON.parse(readFileSync(new URL("../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
const BASE = "9f8e7d6".padEnd(40, "0"), HEAD = "a1b2c3d".padEnd(40, "0");
const DRAFT = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json", WRITTEN = DRAFT.replace(".draft.json", ".json");
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** acme/api on GitHub, open in this server: main's last commit through 22 October is HEAD, its last before 1 October BASE. */
async function acmeApi(s: Scenario) {
  await s.guildSettings({ language: "en" });
  s.clock.set("2026-10-22T10:00:00+07:00");
  process.env.PUBLIC_URL = "https://pachi.example.com";
  await s.git({ repos: ["acme/*"] });
  // Like the other repository playbooks, contract-diff starts off until the tenant turns it on.
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "contract-diff", value: "on" });
  s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api", default_branch: "main" }]);
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
    ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: HEAD, commit: { committer: { date: "2026-10-21T08:00:00Z" } } }]));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [{ filename: "src/users/users.controller.ts", status: "modified" }] }));
}

discordScenario("changelog: opens a contract-diff thread whose turns carry the playbook, its guard, and its tools", async (s) => {
  await acmeApi(s);
  s.model.script("Should the changelog cover the whole history, or a range of days (from which day to which day)?");
  const started = await s.discord.send(`${s.discord.mention} changelog: repo backend acme/api, per tanggal hari ini`);

  const system = String(s.model.calls[0]![0]!.content);
  expect(system).toContain("### Playbook: contract-diff");
  expect(system).toContain("Never choose a scope, a first day or a last day for the person, and call no tool before you have their answer.");
  for (const tool of ["startChangelog", "putChangelogOperation", "putChangelogComponents", "putChangelogNotes", "finishChangelog", "repoFileDiff", "repoTree", "sendFiles", "publishOpenApi"]) expect([tool, s.model.tools[0]!.includes(tool)]).toEqual([tool, true]);
  expect(started.thread!.messages.filter((m) => m.author.bot).map((m) => m.content)).toEqual(["Should the changelog cover the whole history, or a range of days (from which day to which day)?"]);
});

discordScenario("a changelog asked for with a preview is written, validated, sent as a file and published, in one run of the thread", async (s) => {
  await acmeApi(s);
  const { "x-impact": _, ...operation } = FIXTURE.paths["/api/v2/users"].post;
  let link = "";
  s.model.script(
    { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", to: "2026-10-22" } },
    [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation } }],
    { tool: "finishChangelog", args: { draft: DRAFT } },
    [{ tool: "sendFiles", args: { paths: [WRITTEN] } }, { tool: "publishOpenApi", args: { path: WRITTEN } }],
    (turn) => { link = turn.toolResults.at(-1).url; return `3 breaking, 1 non-breaking. Preview: ${link}`; },
  );
  const started = await s.discord.send(`${s.discord.mention} changelog: acme/api from 2026-10-01 to today, and show me a preview`);

  const reply = started.thread!.messages.filter((m) => m.author.bot).at(-1)!;
  expect(link).toMatch(new RegExp(`^https://pachi\\.example\\.com/open-api/${UUID}$`));
  expect(reply.content).toBe(`3 breaking, 1 non-breaking. Preview: ${link}`);
  expect(reply.files.map((f) => f.name)).toEqual(["2026-10-22_9f8e7d6..a1b2c3d.json"]);
  const sent = JSON.parse(new TextDecoder().decode(new Uint8Array(reply.files[0].attachment)));
  expect(sent.info["x-changelog"]).toMatchObject({ date: "2026-10-22", base: { commit: "9f8e7d6" }, head: { commit: "a1b2c3d" }, summary: { breaking: 3, deprecated: 0, "non-breaking": 1 } });

  // The changelog is kept in the channel's folder, which a public thread shares, and the preview serves it as written.
  const kept = await s.workspace.read("guilds/guild-1/channels/channel-1/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.json");
  expect(JSON.parse(kept!)).toEqual(sent);
  const { createServer } = await import("../src/server.ts");
  expect(await (await createServer().request(`/open-api/${link.split("/").pop()}/openapi.json`)).text()).toBe(kept!);
});
