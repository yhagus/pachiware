import { expect, test } from "bun:test";
import { browseCommits, browseTree, compareRefs, fileDiff } from "../src/git.js";

const github = { provider: "github" as const, baseUrl: null, token: "t" };
const gitlab = { provider: "gitlab" as const, baseUrl: null, token: "t" };

/** Answers each request with the first route whose key the URL contains; a route may be a function of the URL. */
async function withFetch(routes: Record<string, unknown>, run: (urls: string[]) => Promise<void>) {
  const real = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    const body = hit === undefined ? undefined : typeof routes[hit] === "function" ? (routes[hit] as (u: string) => unknown)(String(url)) : routes[hit];
    return body === undefined ? new Response("x", { status: 500 }) : Response.json(body);
  }) as any;
  try { await run(urls); } finally { globalThis.fetch = real; }
}

test("repoCommits passes since and until to both providers unchanged", async () => {
  await withFetch({ "/repos/o/r/commits": [], "/projects/g%2Fp/repository/commits": [] }, async (urls) => {
    await browseCommits(github, "o/r", 1, "main", { since: "2026-10-01T00:00:00+07:00", until: "2026-10-22T23:59:59+07:00" });
    await browseCommits(gitlab, "g/p", 1, undefined, { until: "2026-10-22T23:59:59+07:00" });
    expect(urls).toEqual([
      "https://api.github.com/repos/o/r/commits?per_page=30&page=1&sha=main&since=2026-10-01T00%3A00%3A00%2B07%3A00&until=2026-10-22T23%3A59%3A59%2B07%3A00",
      "https://gitlab.com/api/v4/projects/g%2Fp/repository/commits?per_page=30&page=1&until=2026-10-22T23%3A59%3A59%2B07%3A00",
    ]);
  });
});

const paths = (n: number) => Array.from({ length: n }, (_, i) => `src/f${String(i).padStart(4, "0")}.ts`);

test("repoTree on GitHub lists every file at a ref, 200 a page, filtered by path, and says when GitHub cut the tree", async () => {
  const tree = [...paths(450).map((path) => ({ path, type: "blob" })), { path: "src", type: "tree" }, { path: "docs/a.md", type: "blob" }];
  await withFetch({ "/repos/o/r/git/trees/v1.2?recursive=1": { tree, truncated: false }, "/repos/o/r/git/trees/main?recursive=1": { tree: [{ path: "a", type: "blob" }], truncated: true } }, async () => {
    const first = await browseTree(github, "o/r", "v1.2", "src", 1);
    expect(first).toEqual({ ref: "v1.2", path: "src", files: paths(200), page: 1, nextPage: 2, totalFiles: 450 });
    expect(await browseTree(github, "o/r", "v1.2", "src", 3)).toEqual({ ref: "v1.2", path: "src", files: paths(450).slice(400), page: 3, totalFiles: 450 });
    // Without a path the tree's other files count too: docs/a.md sorts first, so the third page starts one file earlier.
    expect((await browseTree(github, "o/r", "v1.2", undefined, 3)).files).toEqual(paths(450).slice(399));
    expect(await browseTree(github, "o/r", "main", undefined, 1)).toEqual({ ref: "main", files: ["a"], page: 1, totalFiles: 1, truncated: "Only part of this tree was listed; list a folder with path to see all of it." });
  });
});

test("repoTree on GitLab asks for the folder and pages through the provider's tree, folders left out", async () => {
  const all = paths(450).map((path) => ({ path, type: "blob" }));
  await withFetch({
    "/projects/g%2Fp/repository/tree": (url: string) => {
      const query = new URL(url).searchParams, page = Number(query.get("page"));
      expect([query.get("ref"), query.get("recursive"), query.get("path")]).toEqual(["main", "true", "src"]);
      return [...all.slice((page - 1) * 100, page * 100), ...(page === 1 ? [{ path: "src/sub", type: "tree" }] : [])];
    },
  }, async (urls) => {
    expect(await browseTree(gitlab, "g/p", "main", "src", 1)).toEqual({ ref: "main", path: "src", files: paths(200), page: 1, nextPage: 2, totalFiles: 450 });
    expect(urls.map((u) => new URL(u).searchParams.get("page"))).toEqual(["1", "2", "3", "4", "5"]);
    expect(await browseTree(gitlab, "g/p", "main", "src", 3)).toEqual({ ref: "main", path: "src", files: paths(450).slice(400), page: 3, totalFiles: 450 });
  });
});

test("repoFileDiff gives one file's patch with its old path, or says why there is none", async () => {
  const ghCompare = { files: [
    { filename: "src/users.ts", previous_filename: "src/user.ts", status: "renamed", patch: "@@ -1 +1 @@\n-a\n+b" },
    { filename: "logo.png", status: "modified" },
    { filename: "big.json", status: "modified", patch: "x".repeat(12_000) },
  ] };
  const glCompare = { diffs: [{ old_path: "app/user.rb", new_path: "app/users.rb", renamed_file: true, new_file: false, deleted_file: false, diff: "@@ -1 +1 @@\n-a\n+b" }] };
  await withFetch({ "/repos/o/r/compare/v1...main": ghCompare, "/projects/g%2Fp/repository/compare": glCompare }, async () => {
    expect(await fileDiff(github, "o/r", "v1", "main", "src/users.ts")).toEqual({ path: "src/users.ts", oldPath: "src/user.ts", status: "renamed", patch: "@@ -1 +1 @@\n-a\n+b" });
    expect(await fileDiff(github, "o/r", "v1", "main", "src/user.ts")).toEqual({ path: "src/users.ts", oldPath: "src/user.ts", status: "renamed", patch: "@@ -1 +1 @@\n-a\n+b" });
    expect(await fileDiff(github, "o/r", "v1", "main", "logo.png")).toEqual({ path: "logo.png", status: "modified", note: "The provider gives no patch for this file (binary, or too large). Read it at each ref with repoReadFile." });
    expect(await fileDiff(github, "o/r", "v1", "main", "big.json")).toEqual({ path: "big.json", status: "modified", patch: "x".repeat(10_000), note: "The patch is cut at 10,000 characters. Read the file at each ref with repoReadFile for the rest." });
    expect(await fileDiff(github, "o/r", "v1", "main", "README.md")).toEqual({ path: "README.md", note: "README.md did not change between v1 and main." });
    expect(await fileDiff(gitlab, "g/p", "v1", "main", "app/users.rb")).toEqual({ path: "app/users.rb", oldPath: "app/user.rb", status: "renamed", patch: "@@ -1 +1 @@\n-a\n+b" });
  });
});

test("repoCompare pages the changed files 50 at a time and says when GitHub stopped at 300", async () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ filename: `f${String(i).padStart(3, "0")}.ts`, status: "modified" }));
  await withFetch({ "/repos/o/r/compare/a...b": { ahead_by: 2, behind_by: 0, commits: [], files } }, async () => {
    const first = await compareRefs(github, "o/r", "a", "b");
    expect(first.files).toEqual(files.slice(0, 50).map((f) => ({ path: f.filename, status: "modified" })));
    expect(first).toMatchObject({ totalFiles: 300, nextPage: 2, filesCapped: "GitHub lists at most 300 changed files in a comparison; files past them are not listed." });
    const last = await compareRefs(github, "o/r", "a", "b", 6);
    expect(last.files.map((f: any) => f.path)).toEqual(files.slice(250).map((f) => f.filename));
    expect(last.nextPage).toBeUndefined();
  });
  await withFetch({ "/repos/o/r/compare/a...c": { ahead_by: 1, behind_by: 0, commits: [], files: files.slice(0, 3) } }, async () => {
    expect(await compareRefs(github, "o/r", "a", "c")).toEqual({ ahead: 1, behind: 0, commits: [], files: files.slice(0, 3).map((f) => ({ path: f.filename, status: "modified" })), totalFiles: 3 });
  });
});
