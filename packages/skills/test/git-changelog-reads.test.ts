import { expect, test } from "bun:test";
import { browseCommits, browseTree, changedFileList, compareRefs, definitionsIn, fileDiff, findDefinition, readFilePage } from "../src/git.js";

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

test("past GitHub's 300 files, a file the comparison does not list is not said to be unchanged", async () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ filename: `f${String(i).padStart(3, "0")}.ts`, status: "modified", patch: "@@" }));
  await withFetch({ "/repos/o/r/compare/a...b": { files } }, async () => {
    expect(await fileDiff(github, "o/r", "a", "b", "src/routes.ts")).toEqual({ path: "src/routes.ts", note: "src/routes.ts is not among the 300 changed files GitHub lists for this comparison, so whether it changed is unknown. Read it at each ref with repoReadFile." });
    expect(await fileDiff(github, "o/r", "a", "b", "f007.ts")).toEqual({ path: "f007.ts", status: "modified", patch: "@@" });
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

test("repoCompare with a patch budget gives source files their patches first, each whole or not at all, in the provider's order", async () => {
  const files = [
    { filename: "src/a.ts", status: "modified", patch: "a".repeat(3000) },
    { filename: "src/a.spec.ts", status: "modified", patch: "s".repeat(1000) },
    { filename: "src/c.ts", status: "modified", patch: "c".repeat(5000) },
    { filename: "logo.png", status: "modified" },
  ];
  await withFetch({ "/repos/o/r/compare/a...b": { ahead_by: 1, behind_by: 0, commits: [], files } }, async () => {
    // src/a.ts (3,000) fits the 7,000; src/c.ts (5,000) does not fit the 4,000 left; the spec (1,000) does.
    expect((await compareRefs(github, "o/r", "a", "b", 1, 7000)).files).toEqual([
      { path: "src/a.ts", status: "modified", patch: "a".repeat(3000) },
      { path: "src/a.spec.ts", status: "modified", patch: "s".repeat(1000) },
      { path: "src/c.ts", status: "modified" },
      { path: "logo.png", status: "modified" },
    ]);
  });
});

test("the changed file list keeps each patch's length, never the patch, on both providers; a file given no patch has none (#370)", async () => {
  await withFetch({ "/repos/o/r/compare/a...b": { files: [
    { filename: "src/a.ts", status: "modified", patch: "a".repeat(3000) }, { filename: "logo.png", status: "modified" }, { filename: "src/b.ts", previous_filename: "src/old-b.ts", status: "renamed" },
  ] } }, async () => {
    expect(await changedFileList(github, "o/r", "a", "b")).toEqual([
      { path: "src/a.ts", status: "modified", patchChars: 3000 }, { path: "logo.png", status: "modified" }, { path: "src/b.ts", oldPath: "src/old-b.ts", status: "renamed" },
    ]);
  });
  await withFetch({ "/projects/g%2Fp/repository/compare": { commits: [], diffs: [
    { new_path: "src/a.ts", old_path: "src/a.ts", diff: "a".repeat(1200) }, { new_path: "src/big.ts", old_path: "src/big.ts", diff: "", too_large: true },
  ] } }, async () => {
    expect(await changedFileList(gitlab, "g/p", "a", "b")).toEqual([{ path: "src/a.ts", status: "modified", patchChars: 1200 }, { path: "src/big.ts", status: "modified" }]);
  });
});

/** A GitLab file entry, as /repository/files answers it. */
const glFile = (text: string) => ({ content: Buffer.from(text).toString("base64") });

test("repoReadFile reads about 9,000 characters of lines at a time, from any line, and says where the next part starts", async () => {
  // 1,000 lines of 29 characters: each takes 30 with its newline, so a page holds exactly 300.
  const text = Array.from({ length: 1000 }, (_, i) => `// line ${String(i + 1).padStart(4, "0")} ${"x".repeat(16)}`).join("\n");
  expect(text.split("\n")[0]!.length).toBe(29);
  await withFetch({ "/projects/g%2Fp/repository/files/src%2Fbig.ts": glFile(text) }, async () => {
    const first = await readFilePage(gitlab, "g/p", "src/big.ts", "abc1234");
    expect(first).toMatchObject({ type: "file", ref: "abc1234", path: "src/big.ts", fromLine: 1, toLine: 300, totalLines: 1000, nextFromLine: 301 });
    expect((first as any).content.split("\n").at(-1)).toBe(`// line 0300 ${"x".repeat(16)}`);
    expect(await readFilePage(gitlab, "g/p", "src/big.ts", "abc1234", 990)).toMatchObject({ fromLine: 990, toLine: 1000, totalLines: 1000 });
    expect(await readFilePage(gitlab, "g/p", "src/big.ts", "abc1234", 990)).not.toHaveProperty("nextFromLine");
    const part = await readFilePage(gitlab, "g/p", "src/big.ts", "abc1234", 468, 470);
    expect(part).toMatchObject({ fromLine: 468, toLine: 470, content: [468, 469, 470].map((n) => `// line 0${n} ${"x".repeat(16)}`).join("\n") });
    expect(part).not.toHaveProperty("nextFromLine");
  });
});

const CONTROLLER = `import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';

@Controller('http-client')
export class HttpClientController {
  constructor(private readonly service: HttpClientService) {}

  /** Edits one request of a collection. */
  @Patch('collections/:id/requests/:requestId')
  @UseGuards(AtGuard)
  async updateRequest(
    @Param('id') id: string,
    @Body() dto: UpdateHttpClientRequestDTO,
  ): Promise<HttpClientRequest> {
    const saved = await this.service.updateRequest(id, dto);
    return { ...saved, path: \`/x/\${id}\` };
  }

  retry() {
    updateRequest(this.last);
  }
}
`;

test("a definition is found with its decorators and comment, to the brace that closes it; a call is not a definition", () => {
  expect(definitionsIn(CONTROLLER, "updateRequest")).toEqual([{ line: 7, endLine: 16, content: CONTROLLER.split("\n").slice(6, 16).join("\n") }]);
  expect(definitionsIn(CONTROLLER, "HttpClientController").map((d) => [d.line, d.endLine])).toEqual([[3, 21]]);
  const consts = "export const GRPC_UNAVAILABLE_CODES = new Set([\n  14,\n  4,\n]);\nexport const LIMITS = { page: { max: 500 } };\nconst other = 1;";
  expect(definitionsIn(consts, "GRPC_UNAVAILABLE_CODES").map((d) => [d.line, d.endLine])).toEqual([[1, 4]]);
  expect(definitionsIn(consts, "LIMITS").map((d) => [d.line, d.endLine])).toEqual([[5, 5]]);
  expect(definitionsIn("def normalize(item):\n    if item:\n        return item\n\n    return None\nx = 1", "normalize").map((d) => [d.line, d.endLine])).toEqual([[1, 5]]);
  expect(definitionsIn("func (s *Server) Handle(w http.ResponseWriter) {\n\tw.Write(nil)\n}\n", "Handle").map((d) => [d.line, d.endLine])).toEqual([[1, 3]]);
  expect(definitionsIn(CONTROLLER, "retryLater")).toEqual([]);
});

test("repoFindDefinition searches GitLab on a branch's ref but on the default branch for a commit, reads source before tests at the ref, and with a path searches nothing", async () => {
  const hits = [{ path: "src/app/controller/http-client.controller.spec.ts" }, { path: "docs/api.md" }, { path: "src/app/controller/http-client.controller.ts" }];
  await withFetch({
    "/projects/g%2Fp/search": hits,
    "/projects/g%2Fp/repository/files/src%2Fapp%2Fcontroller%2Fhttp-client.controller.ts": glFile(CONTROLLER),
  }, async (urls) => {
    const found = await findDefinition(gitlab, "g/p", "cdf75598bb9b6066f9146ce2044dfe0650cdb0d6", "updateRequest");
    expect(found).toEqual({ ref: "cdf75598bb9b6066f9146ce2044dfe0650cdb0d6", name: "updateRequest", definitions: [{ path: "src/app/controller/http-client.controller.ts", line: 7, endLine: 16, content: CONTROLLER.split("\n").slice(6, 16).join("\n") }] });
    const search = new URL(urls[0]!).searchParams;
    expect([search.get("scope"), search.get("search"), search.get("ref")]).toEqual(["blobs", "updateRequest", null]);
    // The source file is read first, at the commit asked for, and once it holds a definition the spec is not needed.
    expect(urls.slice(1).map((u) => decodeURIComponent(new URL(u).pathname.split("/files/")[1] ?? "") + " @ " + new URL(u).searchParams.get("ref"))).toEqual(["src/app/controller/http-client.controller.ts @ cdf75598bb9b6066f9146ce2044dfe0650cdb0d6"]);

    urls.length = 0;
    await findDefinition(gitlab, "g/p", "release/2.1", "updateRequest");
    expect(new URL(urls[0]!).searchParams.get("ref")).toBe("release/2.1");

    urls.length = 0;
    expect((await findDefinition(gitlab, "g/p", "main", "updateRequest", "src/app/controller/http-client.controller.ts")).definitions).toHaveLength(1);
    expect(urls.some((u) => u.includes("/search"))).toBe(false);
    expect(await findDefinition(gitlab, "g/p", "main", "missingThing", "src/app/controller/http-client.controller.ts")).toEqual({ ref: "main", name: "missingThing", definitions: [], note: "missingThing is not defined in src/app/controller/http-client.controller.ts at main." });
  });
});
