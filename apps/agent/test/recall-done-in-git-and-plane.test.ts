import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

// "Is it done?" reaches git and Plane only through the existing scopes. Git and Plane are faked at fetch.

async function ask(s: Scenario, tool: string, args: Record<string, unknown>, options: { channel?: string } = {}) {
  let result: any;
  s.model.script({ tool, args }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} is audio normalization done?`, options);
  return result;
}

/** acme/api is open here (acme/*); secret/vault is one of the account's repositories but outside the Git scope. */
function github(s: Scenario) {
  s.http.on("GET api.github.com/user/repos", () => [
    { full_name: "acme/api", owner: { login: "acme" }, private: true, default_branch: "main", updated_at: "2026-10-10T00:00:00Z", html_url: "https://github.com/acme/api" },
    { full_name: "secret/vault", owner: { login: "secret" }, private: true, default_branch: "main", updated_at: "2026-10-10T00:00:00Z", html_url: "https://github.com/secret/vault" },
  ]);
  s.http.on("GET api.github.com/search/issues", (req) => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    if (q !== "audio normalization repo:acme/api") return { total_count: 0, items: [] };
    return { total_count: 2, items: [
      { number: 88, title: "Normalize audio loudness to -14 LUFS", state: "closed", html_url: "https://github.com/acme/api/pull/88", updated_at: "2026-10-12T09:00:00Z", closed_at: "2026-10-12T09:00:00Z",
        pull_request: { merged_at: "2026-10-12T09:00:00Z", html_url: "https://github.com/acme/api/pull/88" } },
      { number: 80, title: "Audio normalization for podcast exports", state: "open", html_url: "https://github.com/acme/api/issues/80", updated_at: "2026-10-01T09:00:00Z", closed_at: null },
    ] };
  });
  s.http.on("GET api.github.com/repos/acme/api/commits", () => [
    { sha: "abc1234567890", commit: { message: "Add audio normalization step\n\nRuns ffmpeg loudnorm.", author: { name: "Bob", date: "2026-10-11T08:00:00Z" } }, html_url: "https://github.com/acme/api/commit/abc1234567890" },
    { sha: "def1234567890", commit: { message: "Fix typo in README", author: { name: "Bob", date: "2026-10-11T07:00:00Z" } }, html_url: "https://github.com/acme/api/commit/def1234567890" },
  ]);
}

discordScenario("a merged pull request in a repository the Git scope opens is reported as merged with its link; a repository outside the scope is never searched or named", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  github(s);
  const result = await ask(s, "repoSearchWork", { queries: ["audio normalization"] });
  expect(result).toEqual({
    searched: ["acme/api"],
    items: [
      { repo: "acme/api", kind: "pull_request", number: 88, title: "Normalize audio loudness to -14 LUFS", state: "merged", date: "2026-10-12T09:00:00Z", url: "https://github.com/acme/api/pull/88" },
      { repo: "acme/api", kind: "commit", sha: "abc1234567", title: "Add audio normalization step", state: "committed", date: "2026-10-11T08:00:00Z", url: "https://github.com/acme/api/commit/abc1234567890" },
      { repo: "acme/api", kind: "issue", number: 80, title: "Audio normalization for podcast exports", state: "open", date: "2026-10-01T09:00:00Z", url: "https://github.com/acme/api/issues/80" },
    ],
  });
  expect(s.http.requests.some((r) => r.url.includes("secret") || r.url.includes("vault"))).toBe(false);
  expect(JSON.stringify(s.model.calls)).not.toMatch(/secret|vault/);
});

discordScenario("on GitLab a merged merge request in a named repository is reported as merged; a named repository outside the scope is refused before GitLab is asked", async (s) => {
  await s.git({ provider: "gitlab", repos: ["acme/*"] });
  s.http.on("GET gitlab.com/api/v4/projects/acme%2Fapi/merge_requests", (req) => new URL(req.url).searchParams.get("search") === "normalisasi audio"
    ? [{ iid: 14, title: "Normalisasi audio podcast", state: "merged", merged_at: "2026-10-09T10:00:00Z", closed_at: null, updated_at: "2026-10-09T10:00:00Z", web_url: "https://gitlab.com/acme/api/-/merge_requests/14" }]
    : []);
  s.http.on("GET gitlab.com/api/v4/projects/acme%2Fapi/issues", () => []);
  s.http.on("GET gitlab.com/api/v4/projects/acme%2Fapi/repository/commits", () => []);
  const result = await ask(s, "repoSearchWork", { repo: "acme/api", queries: ["normalisasi audio", "audio normalization"] });
  expect(result).toEqual({
    searched: ["acme/api"],
    items: [{ repo: "acme/api", kind: "pull_request", number: 14, title: "Normalisasi audio podcast", state: "merged", date: "2026-10-09T10:00:00Z", url: "https://gitlab.com/acme/api/-/merge_requests/14" }],
  });

  const before = s.http.requests.length;
  const refused = await ask(s, "repoSearchWork", { repo: "secret/vault", queries: ["audio normalization"] });
  expect(JSON.stringify(refused)).toContain(`Repository secret/vault is not enabled for account \\"gitlab\\" in this channel`);
  expect(s.http.requests.length).toBe(before);
});

discordScenario("without a Git scope for this place, the search says git is not enabled here and asks the provider nothing", async (s) => {
  const { repositories } = await import("@pachiware/db");
  await s.git({ provider: "github", repos: ["acme/*"] });
  await repositories().git.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "", []);
  github(s);
  const result = await ask(s, "repoSearchWork", { queries: ["audio normalization"] });
  expect(JSON.stringify(result)).toContain("No git account is enabled for this channel");
  expect(s.http.requests).toEqual([]);
});

const ENG = "11111111-1111-4111-8111-111111111111", SEC = "33333333-3333-4333-8333-333333333333";

discordScenario("a Work item in a Plane project the Plane scope opens is reported with its state, found by any of several wordings; a Plane project outside the scope is never read or named", async (s) => {
  await s.plane({ projects: [ENG] });
  const plane = fakePlane(s);
  plane.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  plane.project({ id: ENG, name: "Engineering", identifier: "ENG" }, ["u-bot"]);
  plane.project({ id: SEC, name: "Secret", identifier: "SEC" });
  const doing = plane.state({ project: ENG, name: "In Progress", group: "started" });
  const done = plane.state({ project: ENG, name: "Done", group: "completed" });
  plane.item({ project: ENG, sequence_id: 3, name: "Normalize audio loudness", state: done.id, updated_at: "2026-10-12T08:00:00.000000Z" });
  plane.item({ project: ENG, sequence_id: 5, name: "Normalisasi audio podcast", state: doing.id, updated_at: "2026-10-14T08:00:00.000000Z" });
  plane.item({ project: ENG, sequence_id: 6, name: "Order new chairs", state: doing.id, updated_at: "2026-10-15T08:00:00.000000Z" });
  plane.item({ project: SEC, sequence_id: 1, name: "Audio normalization contract", updated_at: "2026-10-16T08:00:00.000000Z" });

  const result = await ask(s, "workItemList", { queries: ["normalisasi audio", "audio loudness", "audio normalization"] });
  expect(result.items.map((i: any) => [i.key, i.name, i.state])).toEqual([
    ["ENG-5", "Normalisasi audio podcast", "In Progress"],
    ["ENG-3", "Normalize audio loudness", "Done"],
  ]);
  expect(JSON.stringify(result)).not.toMatch(/SEC|Secret|contract/);
  expect(s.http.requests.some((r) => r.url.includes(`/projects/${SEC}/`))).toBe(false);
});

discordScenario("without a Plane scope for this place, the Work item search says Plane is not enabled here and asks Plane nothing", async (s) => {
  await s.plane({ projects: null });
  const result = await ask(s, "workItemList", { queries: ["audio normalization"] });
  expect(JSON.stringify(result)).toContain("Plane is not enabled here");
  expect(s.http.requests).toEqual([]);
});
