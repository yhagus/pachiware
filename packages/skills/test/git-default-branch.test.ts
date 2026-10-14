import { expect, test } from "bun:test";
import { commitFiles, commitToDefaultBranch, deleteFile, moveFile } from "../src/git.js";

const github = { provider: "github" as const, baseUrl: null, token: "t" };

/** A repository whose default branch is main; records every request that is not a read. */
function stubRepo() {
  const writes: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = String(url), method = init.method ?? "GET";
    if (method !== "GET") { writes.push(`${method} ${u}`); return Response.json({ sha: "s", object: { sha: "s" } }); }
    if (u.endsWith("/repos/o/r")) return Response.json({ default_branch: "main" });
    if (u.includes("/git/ref/heads/")) return Response.json({ object: { sha: "s" } });
    return new Response("x", { status: 404 });
  }) as any;
  return { writes, restore: () => { globalThis.fetch = real; } };
}

test("committing files to the default branch is refused before anything is written", async () => {
  const repo = stubRepo();
  try {
    await expect(commitFiles(github, "o/r", [{ path: "a.txt", content: "x" }], "m", "main")).rejects.toThrow("repoWriteDefaultBranch");
    expect(repo.writes).toEqual([]);
  } finally { repo.restore(); }
});

test("a missing branch is an error, not the default branch", async () => {
  const repo = stubRepo();
  try {
    await expect(commitFiles(github, "o/r", [{ path: "a.txt", content: "x" }], "m", undefined as any)).rejects.toThrow("branch is required");
    expect(repo.writes).toEqual([]);
  } finally { repo.restore(); }
});

test("deleting or moving a file obeys the same rule", async () => {
  const repo = stubRepo();
  try {
    await expect(deleteFile(github, "o/r", "a.txt", "m", "main")).rejects.toThrow("repoWriteDefaultBranch");
    await expect(moveFile(github, "o/r", "a.txt", "b.txt", "m", "main")).rejects.toThrow("repoWriteDefaultBranch");
    await expect(deleteFile(github, "o/r", "a.txt", "m", undefined as any)).rejects.toThrow("branch is required");
    await expect(moveFile(github, "o/r", "a.txt", "b.txt", "m", undefined as any)).rejects.toThrow("branch is required");
    expect(repo.writes).toEqual([]);
  } finally { repo.restore(); }
});

test("the owner path still commits to the default branch", async () => {
  const repo = stubRepo();
  try {
    expect(await commitToDefaultBranch(github, "o/r", [{ path: "a.txt", content: "x" }], "m")).toMatchObject({ branch: "main", committed: true });
    expect(repo.writes).toContain("PATCH https://api.github.com/repos/o/r/git/refs/heads/main");
  } finally { repo.restore(); }
});

test("the default branch is recognised when spelled as a full ref", async () => {
  const repo = stubRepo();
  try {
    await expect(commitFiles(github, "o/r", [{ path: "a.txt", content: "x" }], "m", "refs/heads/main")).rejects.toThrow("repoWriteDefaultBranch");
    expect(repo.writes).toEqual([]);
  } finally { repo.restore(); }
});
