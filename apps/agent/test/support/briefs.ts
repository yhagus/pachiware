/** A two-point brief, its round 1, and full drafts for it, shared by the brief scenarios. */
import type { Scenario } from "./discordScenario";

export const POINTS = ["login loops on Safari", "export CSV is slow"];
export const ROUND_1 = {
  points: POINTS,
  drafts: [
    { point: 1, title: "Stop the Safari login loop", summary: "Sessions survive the sign-in redirect on Safari." },
    { point: 2, title: "Stream CSV exports", summary: "Large exports start downloading at once.", blockedBy: [1] },
  ],
  questions: [
    { point: 1, question: "Should Safari 16 be supported?", recommendation: "No, Safari 17 and up." },
    { point: 2, question: "Should exports keep the table's filters?", recommendation: "Yes, export what the table shows." },
  ],
};

export const draft = (n: 1 | 2, extra: Record<string, unknown> = {}) => n === 1
  ? { n: 1, category: "bug", summary: "Signing in on Safari loops back to the sign-in page. Sessions must survive the redirect.", current: "Safari drops the session cookie on the sign-in redirect, so the user lands on sign-in again.", desired: "A user who signs in on Safari 17 or later lands on the page they asked for. An expired session still sends them to sign in once.", acceptance: ["Signing in on Safari 17 lands on the requested page", "An expired session redirects to sign-in exactly once *(added)*", "The fix is covered by a browser test on Safari *(added)*"], outOfScope: ["Safari 16 and older"], ...extra }
  : { n: 2, category: "feature", summary: "Exports stream rows so a large export starts at once.", desired: "An export streams the rows the table shows, filters included, and starts within a second.", acceptance: ["A 100k-row export starts downloading within a second", "The export holds exactly the filtered rows", "An empty table exports a header-only file *(added)*"], outOfScope: ["Scheduled exports"], ...extra };

/** Starts the brief with Draft issues and posts round 1; returns the brief message and its thread. */
export async function startBrief(s: Scenario, round = ROUND_1) {
  s.model.script({ tool: "postBriefRound", args: round }, "ok");
  const brief = await s.discord.send(round.points.map((p) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);
  return { brief, thread: brief.thread!, record: `guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md` };
}

export async function briefFields(s: Scenario, record: string) {
  const { parseFrontmatter } = await import(process.cwd() + "/packages/skills/src/playbooks.ts");
  return parseFrontmatter((await s.workspace.read(record))!)!.fields as Record<string, any>;
}

export const HEAD = "c0ffee1234567890abcdef1234567890abcdef12";
/**
 * Serves one GitHub repository at commit HEAD on its default branch "main". `files` maps a path to its text, or to
 * a directory's entry names; any other path is missing. `issues` are open issues found by every issue search.
 */
export function stubRepo(s: Scenario, o: { repo?: string; files?: Record<string, string | string[]>; labels?: string[]; issues?: { number: number; title: string }[]; code?: string[] } = {}) {
  const repo = o.repo ?? "acme/api", api = `GET api.github.com/repos/${repo}`;
  const issues = (o.issues ?? []).map((i) => ({ ...i, state: "open", html_url: `https://github.com/${repo}/issues/${i.number}` }));
  s.http.on(api, () => ({ full_name: repo, default_branch: "main" }));
  s.http.on(`${api}/contents/`, () => new Response("", { status: 404 }));
  for (const [path, value] of Object.entries(o.files ?? {}))
    s.http.on(`${api}/contents/${path}?ref=${HEAD}`, () => (Array.isArray(value) ? value.map((name) => ({ name, type: "file" })) : { content: Buffer.from(value).toString("base64") }));
  s.http.on(`${api}/commits/main`, () => ({ sha: HEAD, commit: { message: "head", author: { name: "a", date: "d" } }, html_url: `https://github.com/${repo}/commit/${HEAD}`, files: [] }));
  s.http.on(`${api}/labels`, () => (o.labels ?? []).map((name) => ({ name, color: "ffffff" })));
  s.http.on(`${api}/issues/`, (req) => {
    const found = issues.find((i) => req.url.endsWith(`/issues/${i.number}`));
    return found ? { ...found, body: "Same problem.", user: { login: "bob" }, labels: [], assignees: [] } : new Response("", { status: 404 });
  });
  s.http.on("GET api.github.com/search/issues", () => ({ items: issues }));
  s.http.on("GET api.github.com/search/code", () => ({ items: (o.code ?? []).map((path) => ({ path, html_url: `https://github.com/${repo}/blob/main/${path}` })) }));
}

export const embedsIn =(s: Scenario, threadId: string) => s.discord.botMessages.filter((m) => m.channelId === threadId && m.embeds.length);

/** Serves one gitlab.com project the way briefRead's "repository" step reads it: default branch, HEAD and labels, no docs. */
export function stubGitLabRepo(s: Scenario, o: { repo?: string; labels?: string[] } = {}) {
  const repo = o.repo ?? "acme/api", api = `GET gitlab.com/api/v4/projects/${encodeURIComponent(repo)}`;
  s.http.on(api, () => ({ path_with_namespace: repo, default_branch: "main" }));
  s.http.on(`${api}/repository/files/`, () => new Response("", { status: 404 }));
  s.http.on(`${api}/repository/tree`, () => []);
  s.http.on(`${api}/repository/commits/main`, () => ({ id: HEAD, message: "head", author_name: "a", created_at: "d", web_url: `https://gitlab.com/${repo}/-/commit/${HEAD}` }));
  s.http.on(`${api}/repository/commits/main/diff`, () => []);
  s.http.on(`${api}/labels`, () => (o.labels ?? []).map((name) => ({ name, color: "#ffffff" })));
}

/**
 * A brief grounded in acme/api with both drafts written and posted: draft 1 proposes "safari" (plus "bug", its
 * Category's label), draft 2 is blocked by draft 1. Alice is the author.
 */
export async function draftedBrief(s: Scenario, provider: "github" | "gitlab" = "github") {
  await s.git({ provider, repos: ["acme/api"] });
  if (provider === "github") stubRepo(s, { labels: ["bug", "enhancement", "safari"] });
  else stubGitLabRepo(s, { labels: ["bug", "enhancement", "safari"] });
  s.model.script([{ tool: "briefRepositories" }, { tool: "briefRead", args: { step: "repository", repo: "acme/api" } }], { tool: "postBriefRound", args: ROUND_1 }, "ok");
  const brief = await s.discord.send(POINTS.map((p) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread!;
  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(1, { labels: ["safari"] }) }, { tool: "writeIssueDraft", args: draft(2) }], "ok");
  await s.discord.send("yes", { channel: thread });
  return { brief, thread, record: `guilds/guild-1/channels/channel-1/threads/${thread.id}.md` };
}
