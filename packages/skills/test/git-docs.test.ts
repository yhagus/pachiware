import { expect, test } from "bun:test";
import { headCommit, repoTree, readBlob } from "../src/git.js";

// What the documentation mirror (#248) reads from a provider: the default branch's head commit, its tree, and a file's bytes by blob sha.

const github = { provider: "github" as const, baseUrl: null, token: "t" };
const gitlab = { provider: "gitlab" as const, baseUrl: "https://git.example.com", token: "t" };

async function withFetch(routes: Record<string, (url: URL) => unknown>, run: (urls: string[]) => Promise<void>) {
  const real = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(String(input));
    urls.push(`${url.pathname}${url.search}`);
    const hit = Object.keys(routes).filter((k) => url.pathname.endsWith(k)).sort((a, b) => b.length - a.length)[0];
    return hit ? Response.json(routes[hit]!(url)) : new Response("missing", { status: 404 });
  }) as any;
  try { await run(urls); } finally { globalThis.fetch = real; }
}

test("github: the head of the default branch, its files from one recursive tree, and a blob's bytes", async () => {
  await withFetch({
    "/repos/acme/api": () => ({ default_branch: "trunk" }),
    "/repos/acme/api/branches/trunk": () => ({ name: "trunk", commit: { sha: "c0ffee1" } }),
    "/repos/acme/api/git/trees/c0ffee1": () => ({ sha: "tree1", truncated: false, tree: [
      { path: "README.md", type: "blob", sha: "b1", size: 120 },
      { path: "docs", type: "tree", sha: "t2" },
      { path: "docs/setup.md", type: "blob", sha: "b2", size: 64 },
      { path: "vendor/lib", type: "commit", sha: "s1" },
    ] }),
    "/repos/acme/api/git/blobs/b2": () => ({ sha: "b2", encoding: "base64", content: "IyBTZXR1cAo=\n", size: 8 }),
  }, async (urls) => {
    expect(await headCommit(github, "acme/api")).toEqual({ branch: "trunk", commit: "c0ffee1" });
    expect(await repoTree(github, "acme/api", "c0ffee1")).toEqual({ files: [{ path: "README.md", sha: "b1", size: 120 }, { path: "docs/setup.md", sha: "b2", size: 64 }], truncated: false });
    expect(urls.at(-1)).toBe("/repos/acme/api/git/trees/c0ffee1?recursive=1");
    expect(new TextDecoder().decode(await readBlob(github, "acme/api", "b2"))).toBe("# Setup\n");
  });
});

test("github: a tree the provider cut says so", async () => {
  await withFetch({ "/repos/acme/api/git/trees/c1": () => ({ truncated: true, tree: [{ path: "a.md", type: "blob", sha: "b1", size: 1 }] }) }, async () => {
    expect(await repoTree(github, "acme/api", "c1")).toEqual({ files: [{ path: "a.md", sha: "b1", size: 1 }], truncated: true });
  });
});

test("gitlab: the head of the default branch, its tree read page by page until a short page, and a blob's bytes", async () => {
  const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: `b${from + i}`, name: `f${from + i}.md`, type: "blob", path: `docs/f${from + i}.md`, mode: "100644" }));
  await withFetch({
    "/api/v4/projects/group%2Fsub%2Fdocs": () => ({ default_branch: "main" }),
    "/api/v4/projects/group%2Fsub%2Fdocs/repository/branches/main": () => ({ name: "main", commit: { id: "abc123" } }),
    "/api/v4/projects/group%2Fsub%2Fdocs/repository/tree": (url) => (url.searchParams.get("page") === "1" ? [{ id: "t1", name: "docs", type: "tree", path: "docs", mode: "040000" }, ...page(99, 0)] : page(2, 99)),
    "/api/v4/projects/group%2Fsub%2Fdocs/repository/blobs/b100": () => ({ sha: "b100", size: 6, encoding: "base64", content: "SGFsbG8K" }),
  }, async (urls) => {
    expect(await headCommit(gitlab, "group/sub/docs")).toEqual({ branch: "main", commit: "abc123" });
    const tree = await repoTree(gitlab, "group/sub/docs", "abc123");
    expect(tree.truncated).toBe(false);
    expect(tree.files.length).toBe(101);
    expect(tree.files[0]).toEqual({ path: "docs/f0.md", sha: "b0" });
    expect(tree.files.at(-1)).toEqual({ path: "docs/f100.md", sha: "b100" });
    expect(urls.filter((u) => u.includes("/repository/tree"))).toEqual([
      "/api/v4/projects/group%2Fsub%2Fdocs/repository/tree?ref=abc123&recursive=true&per_page=100&page=1",
      "/api/v4/projects/group%2Fsub%2Fdocs/repository/tree?ref=abc123&recursive=true&per_page=100&page=2",
    ]);
    expect(new TextDecoder().decode(await readBlob(gitlab, "group/sub/docs", "b100"))).toBe("Hallo\n");
  });
});

test("a repository the account cannot see is refused by name", async () => {
  await withFetch({}, async () => {
    await expect(headCommit(github, "acme/gone")).rejects.toThrow("Repository acme/gone not found or not accessible");
    await expect(readBlob(gitlab, "g/p", "b9")).rejects.toThrow("blob b9 not found");
  });
});
