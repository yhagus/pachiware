import { expect, test } from "bun:test";
import { writeFile, readFile } from "../src/git.js";

const github = { provider: "github" as const, baseUrl: null, token: "t" };

test("write refuses the default branch and path traversal; read decodes content", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith("/repos/o/r")) return Response.json({ default_branch: "main" });
    if (String(url).includes("/contents/a.txt")) return Response.json({ content: Buffer.from("hi").toString("base64") });
    return new Response("x", { status: 500 });
  }) as any;
  try {
    await expect(writeFile(github, "o/r", "a.txt", "x", "m", "main")).rejects.toThrow("default branch");
    await expect(writeFile(github, "o/r", "../a", "x", "m", "feat")).rejects.toThrow("Invalid path");
    await expect(readFile(github, "bad repo", "a.txt")).rejects.toThrow("Invalid repo");
    expect(await readFile(github, "o/r", "a.txt")).toMatchObject({ type: "file", content: "hi" });
  } finally { globalThis.fetch = real; }
});

test("commits and one merge request normalize across GitHub and GitLab", async () => {
  const { browseCommits, getMergeRequest } = await import("../src/git.js");
  const real = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url); urls.push(u);
    if (u.includes("api.github.com/repos/o/r/commits")) return Response.json([{ sha: "abcdef1234567", commit: { message: "fix: x\n\nbody", author: { name: "Ann", date: "d" } }, html_url: "h" }]);
    if (u.includes("api.github.com/repos/o/r/pulls/3/files")) return Response.json([{ filename: "a.ts", status: "modified", additions: 2, deletions: 1 }]);
    if (u.includes("api.github.com/repos/o/r/pulls/3")) return Response.json({ title: "T", state: "open", user: { login: "ann" }, head: { ref: "f" }, base: { ref: "main" }, body: "desc", labels: [], html_url: "h" });
    if (u.includes("gitlab.com/api/v4/projects/g%2Fp/repository/commits")) return Response.json([{ id: "1234567890abc", title: "feat: y", author_name: "Bo", created_at: "d", web_url: "w" }]);
    if (u.includes("gitlab.com/api/v4/projects/g%2Fp/merge_requests/4/changes")) return Response.json({ changes: [{ new_path: "b.ts", new_file: true }] });
    if (u.includes("gitlab.com/api/v4/projects/g%2Fp/merge_requests/4")) return Response.json({ title: "M", state: "opened", author: { username: "bo" }, source_branch: "s", target_branch: "main", description: "d", labels: ["x"], web_url: "w" });
    return new Response("x", { status: 404 });
  }) as any;
  try {
    const gitlab = { provider: "gitlab" as const, baseUrl: null, token: "t" };
    expect((await browseCommits(github, "o/r", 1, "dev")).items[0]).toMatchObject({ sha: "abcdef1234", message: "fix: x", author: "Ann" });
    expect(urls.some((u) => u.includes("sha=dev"))).toBe(true);
    expect((await browseCommits(gitlab, "g/p", 1)).items[0]).toMatchObject({ sha: "1234567890", message: "feat: y", author: "Bo" });
    expect(await getMergeRequest(github, "o/r", 3)).toMatchObject({ number: 3, state: "open", source: "f", target: "main", files: [{ path: "a.ts", additions: 2 }] });
    expect(await getMergeRequest(gitlab, "g/p", 4)).toMatchObject({ state: "open", source: "s", files: [{ path: "b.ts", status: "added" }] });
    await expect(getMergeRequest(github, "o/r", 99)).rejects.toThrow("not found");
    await expect(getMergeRequest(github, "o/r", 0)).rejects.toThrow("positive integer");
  } finally { globalThis.fetch = real; }
});

test("PR and issue write/read helpers use provider endpoints", async () => {
  const { updateMergeRequest, reopenItem, reviewMergeRequest, mergeRequestDiff, repoChecks, updateIssue, assignItem, setLabels, editComment, deleteComment } = await import("../src/git.js");
  const real = globalThis.fetch, calls: { url: string; method: string; body?: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method ?? "GET", body });
    const u = String(url);
    if (u.includes("/pulls/7/files")) return Response.json([{ filename: "a.ts", status: "modified", patch: "+x" }]);
    if (u.includes("/commits/main/check-runs")) return Response.json({ check_runs: [{ name: "ci", status: "completed", conclusion: "success" }] });
    if (u.includes("/commits/main/status")) return Response.json({ statuses: [{ context: "lint", state: "success" }] });
    if (u.includes("/labels")) return Response.json([{ name: "bug" }]);
    if (u.includes("/comments/") || u.includes("/notes/")) return Response.json({ body: body?.body ?? "ok" });
    return Response.json({ title: body?.title ?? "T", state: "open", html_url: "url", assignees: [{ login: "a" }] });
  }) as any;
  try {
    expect(await updateMergeRequest(github, "o/r", 7, { title: "New" })).toMatchObject({ number: 7, title: "New" });
    expect(await reopenItem(github, "o/r", 7, "issue")).toMatchObject({ state: "open" });
    expect(await reviewMergeRequest(github, "o/r", 7, "approve")).toMatchObject({ event: "approve" });
    expect((await mergeRequestDiff(github, "o/r", 7)).files[0]).toMatchObject({ path: "a.ts", patch: "+x" });
    expect((await repoChecks(github, "o/r", "main")).checks[0]).toMatchObject({ name: "ci" });
    expect(await updateIssue(github, "o/r", 2, { body: "b" })).toMatchObject({ number: 2 });
    expect(await assignItem(github, "o/r", 2, "issue", ["a"])).toMatchObject({ assignees: ["a"] });
    expect(await setLabels(github, "o/r", 2, "issue", ["bug"])).toMatchObject({ labels: ["bug"] });
    expect(await editComment(github, "o/r", 9, "issue", "edited")).toMatchObject({ id: 9, body: "edited" });
    expect(await deleteComment(github, "o/r", 9, "issue")).toMatchObject({ deleted: true });
    expect(calls.some((x) => x.method === "DELETE" && x.url.includes("issues/comments/9"))).toBe(true);
  } finally { globalThis.fetch = real; }
});

test("issue search finds open issues only, and permalinks pin a commit, on GitHub and GitLab", async () => {
  const { searchIssues, blobUrl } = await import("../src/git.js");
  const real = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url); urls.push(u);
    if (u.includes("api.github.com/search/issues")) return Response.json({ items: [{ number: 12, title: "Login loops on Safari", state: "open", html_url: "https://github.com/o/r/issues/12" }] });
    if (u.includes("gitlab.com/api/v4/projects/g%2Fp/issues")) return Response.json([{ iid: 4, title: "Slow export", state: "opened", web_url: "https://gitlab.com/g/p/-/issues/4" }]);
    return new Response("x", { status: 404 });
  }) as any;
  try {
    const gitlab = { provider: "gitlab" as const, baseUrl: null, token: "t" };
    expect(await searchIssues(github, "o/r", "safari login", 1)).toEqual({ items: [{ number: 12, title: "Login loops on Safari", state: "open", url: "https://github.com/o/r/issues/12" }], hasMore: false });
    expect(decodeURIComponent(urls[0]!)).toContain("q=safari login repo:o/r is:issue is:open");
    expect((await searchIssues(gitlab, "g/p", "export", 1)).items).toEqual([{ number: 4, title: "Slow export", state: "open", url: "https://gitlab.com/g/p/-/issues/4" }]);
    expect(urls[1]).toContain("state=opened");
    expect(urls[1]).toContain("search=export");
    expect(blobUrl(github, "o/r", "abc123", "src/a b.ts")).toBe("https://github.com/o/r/blob/abc123/src/a%20b.ts");
    expect(blobUrl({ ...gitlab, baseUrl: "https://git.example.com/" }, "g/p", "abc123", "README.md")).toBe("https://git.example.com/g/p/-/blob/abc123/README.md");
  } finally { globalThis.fetch = real; }
});
