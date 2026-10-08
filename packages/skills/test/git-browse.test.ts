import { expect, test } from "bun:test";
import { browseRepos, browseMembers, browseIssues, browseMergeRequests, browseBranches } from "../src/git.js";

const github = { provider: "github" as const, baseUrl: null, token: "t" };
const gitlab = { provider: "gitlab" as const, baseUrl: null, token: "t" };

async function withFetch(routes: Record<string, unknown>, run: (urls: string[]) => Promise<void>) {
  const real = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    return hit ? (routes[hit] === 403 ? new Response("no", { status: 403 }) : typeof routes[hit] === "string" ? new Response(routes[hit] as string) : Response.json(routes[hit])) : new Response("x", { status: 500 });
  }) as any;
  try { await run(urls); } finally { globalThis.fetch = real; }
}

test("github: repos grouped by owner, issues exclude PRs, members fall back to contributors", async () => {
  await withFetch({
    "/user/repos": [{ full_name: "o/r", owner: { login: "o" }, private: true, archived: false, fork: false, description: null, updated_at: "2026-01-01", html_url: "u", default_branch: "main" }],
    "/repos/o/r/issues": [{ number: 1, title: "bug", state: "open", user: { login: "a" }, labels: [{ name: "x" }], html_url: "u", created_at: "d" }, { number: 2, title: "pr", pull_request: {}, state: "open" }],
    "/repos/o/r/collaborators": 403,
    "/repos/o/r/contributors": [{ login: "c", avatar_url: "a", html_url: "u" }],
    "/repos/o/r/pulls": [{ number: 3, title: "t", state: "closed", merged_at: "d", user: { login: "a" }, head: { ref: "f" }, base: { ref: "main" }, labels: [], html_url: "u", created_at: "d" }],
    "/repos/o/r/branches": [{ name: "main", protected: true }, { name: "f", protected: false }],
    "/repos/o": { default_branch: "main" },
  }, async () => {
    expect((await browseRepos(github, 1)).items[0]).toMatchObject({ repo: "o/r", owner: "o", private: true });
    expect((await browseIssues(github, "o/r", 1, "open")).items.map((i: any) => i.number)).toEqual([1]);
    expect((await browseMembers(github, "o/r", 1)).items[0]).toMatchObject({ username: "c", role: "contributor" });
    expect((await browseMembers(github, "o/r", 1)).contributorsOnly).toBe(true);
    expect((await browseMergeRequests(github, "o/r", 1, "all")).items[0]).toMatchObject({ merged: true, source: "f", target: "main" });
    expect((await browseBranches(github, "o/r", 1)).items.map((b: any) => b.default)).toEqual([true, false]);
  });
});

test("gitlab: opened/state mapping, role names, hasMore only on a full page", async () => {
  await withFetch({
    "/members/all": [{ username: "m", name: "M", access_level: 40, avatar_url: "a", web_url: "u" }],
    "/merge_requests": Array.from({ length: 30 }, (_, i) => ({ iid: i, title: "t", state: "merged", author: { username: "a" }, source_branch: "s", target_branch: "t", labels: ["l"], web_url: "u", created_at: "d" })),
  }, async (urls) => {
    expect((await browseMembers(gitlab, "g/p", 1)).items[0]).toMatchObject({ role: "maintainer" });
    const mr = await browseMergeRequests(gitlab, "g/p", 2, "open");
    expect(mr.hasMore).toBe(true);
    expect(mr.items[0]).toMatchObject({ merged: true, labels: ["l"] });
    expect(urls.at(-1)).toContain("state=opened");
    expect(urls.at(-1)).toContain("page=2");
    expect((await browseMembers(gitlab, "g/p", 1)).hasMore).toBe(false);
  });
});

test("pipelines: gitlab and github shapes, job log tail", async () => {
  const { browsePipelines, pipelineJobs, jobLog } = await import("../src/git.js");
  await withFetch({
    "/projects/g%2Fp/pipelines/9/jobs": [{ id: 5, name: "test", stage: "test", status: "failed", web_url: "u" }],
    "/projects/g%2Fp/jobs/5/trace": "x".repeat(9000) + "\u001b[31mBOOM",
    "/projects/g%2Fp/pipelines": [{ id: 9, status: "failed", ref: "main", sha: "abcdef123456", web_url: "u", created_at: "d" }],
    "/repos/o/r/actions/runs": { workflow_runs: [{ id: 1, name: "CI", status: "completed", conclusion: "success", head_branch: "main", head_sha: "abcdef123456", html_url: "u", created_at: "d" }] },
  }, async () => {
    expect((await browsePipelines(gitlab, "g/p", 1)).items[0]).toMatchObject({ id: 9, status: "failed", branch: "main" });
    expect((await browsePipelines(github, "o/r", 1)).items[0]).toMatchObject({ status: "success", name: "CI" });
    expect((await pipelineJobs(gitlab, "g/p", 9))[0]).toMatchObject({ id: 5, status: "failed" });
    const log = await jobLog(gitlab, "g/p", 5);
    expect(log.truncated).toBe(true);
    expect(log.log.endsWith("BOOM")).toBe(true);
    expect(log.log).not.toContain("\u001b");
  });
});
