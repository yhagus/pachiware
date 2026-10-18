import { expect, test } from "bun:test";
import { docPatternError, matchesDocPaths, pickDocs } from "../src/docsMirror.js";

// Which files of a repository's tree the documentation mirror (#248) copies into a channel's files/docs/ folder.

test("a path pattern: * stays inside one folder, ** reaches any depth, a plain path names one file", () => {
  const cases: [string[], string, boolean][] = [
    [["README.md"], "README.md", true],
    [["README.md"], "docs/README.md", false],
    [["docs/**"], "docs/setup.md", true],
    [["docs/**"], "docs/guides/linux/install.md", true],
    [["docs/**"], "documentation/setup.md", false],
    [["adr/*.md"], "adr/0001-record.md", true],
    [["adr/*.md"], "adr/old/0001-record.md", false],
    [["**/README.md"], "README.md", true],
    [["**/README.md"], "packages/cli/README.md", true],
    [["docs/**", "adr/*.md"], "adr/0002.md", true],
    [["DOCS/**"], "docs/setup.md", false],
  ];
  for (const [patterns, path, expected] of cases) expect([patterns, path, matchesDocPaths(patterns, path)]).toEqual([patterns, path, expected]);
});

test("an admin's path pattern is plain folder and file names with * and **, never leaving the repository", () => {
  for (const ok of ["README.md", "docs/**", "adr/*.md", "**/*.md", "docs/user guide/*.md", "CHANGELOG"]) expect([ok, docPatternError(ok)]).toEqual([ok, null]);
  for (const bad of ["", "  ", "/docs/**", "../secrets.md", "docs/../x.md", "docs/./x.md", "docs//x.md", "docs/{a,b}.md", "docs/[ab].md", "!docs/**", "docs/?.md", "docs\\x.md", `docs/${"a".repeat(200)}`]) {
    expect([bad, typeof docPatternError(bad)]).toEqual([bad, "string"]);
  }
});

test("matching text files are taken in the order of the patterns, then by path; a file too large or with no Workspace name is listed as skipped", () => {
  const tree = [
    { path: "README.md", sha: "a1", size: 10 },
    { path: "docs/guide.md", sha: "a2", size: 10 },
    { path: "docs/img/logo.png", sha: "a3", size: 10 },
    { path: "docs/api/endpoints.mdx", sha: "a4", size: 10 },
    { path: "docs/big.md", sha: "a5", size: 300 * 1024 },
    { path: "docs/a/b/c/d/deep.md", sha: "a6", size: 1 },
    { path: "docs/notes (old).txt", sha: "a7" },
    { path: "adr/0001-x.rst", sha: "a8" },
    { path: "adr/sub/0002.md", sha: "a9" },
    { path: "src/index.ts", sha: "b1" },
    { path: "docs/Setup.ADOC", sha: "b2" },
  ];
  expect(pickDocs(tree, ["README.md", "docs/**", "adr/*"], "acme/api")).toEqual({
    wanted: [
      { path: "README.md", sha: "a1", size: 10 },
      { path: "docs/Setup.ADOC", sha: "b2" },
      { path: "docs/api/endpoints.mdx", sha: "a4", size: 10 },
      { path: "docs/guide.md", sha: "a2", size: 10 },
      { path: "adr/0001-x.rst", sha: "a8" },
    ],
    skipped: [{ path: "docs/a/b/c/d/deep.md", reason: "path" }, { path: "docs/big.md", reason: "tooLarge" }, { path: "docs/notes (old).txt", reason: "path" }],
    leftOut: 0,
  });
});

test("a source mirrors at most 200 files; the rest are counted, not copied", () => {
  const tree = Array.from({ length: 205 }, (_, i) => ({ path: `docs/f${String(i).padStart(3, "0")}.md`, sha: `c${i}` }));
  const picked = pickDocs(tree, ["docs/**"], "acme/api");
  expect(picked.wanted.length).toBe(200);
  expect(picked.wanted.at(-1)!.path).toBe("docs/f199.md");
  expect(picked.leftOut).toBe(5);
});
