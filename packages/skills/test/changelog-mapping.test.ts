import { expect, test } from "bun:test";
import { mappingGroups } from "../src/openapi/mapping.js";
import { routeFilesAt } from "../src/openapi/changelog.js";

/** A changed file as the draft keeps it: its path, its status, and its patch's length when the comparison gave a patch. */
const file = (path: string, patchChars?: number, status = "modified") => ({ path, status, ...(patchChars !== undefined ? { patchChars } : {}) });
const paths = (groups: { path: string }[][]) => groups.map((group) => group.map((f) => f.path));

test("mapping groups take the changed files in path order, each group at most 40,000 patch characters, never splitting a file (#370)", () => {
  expect(paths(mappingGroups([
    file("src/users/users.service.ts", 9_000), file("src/users/dto/create-user.dto.ts", 12_000), file("src/auth/auth.guard.ts", 20_000),
    file("src/users/dto/update-user.dto.ts", 8_000), file("src/users/users.controller.ts", 11_001),
  ]))).toEqual([
    // 20,000 + 12,000 + 8,000 is the bound itself, which still fits; the controller's 11,001 would pass it.
    ["src/auth/auth.guard.ts", "src/users/dto/create-user.dto.ts", "src/users/dto/update-user.dto.ts"],
    ["src/users/users.controller.ts", "src/users/users.service.ts"],
  ]);
});

test("a file over the bound, or one the comparison gave no patch for, is a group of its own; a file only moved has no patch and joins its neighbours (#370)", () => {
  expect(paths(mappingGroups([
    file("src/a.ts", 1_000), file("src/b.ts", 40_001), file("src/c.ts", 2_000), file("assets/logo.png"), file("src/d.ts", 3_000), file("src/e.ts", undefined, "renamed"),
  ]))).toEqual([["assets/logo.png"], ["src/a.ts"], ["src/b.ts"], ["src/c.ts", "src/d.ts", "src/e.ts"]]);
});

test("a mapping group holds at most 20 files, however small their patches (#370)", () => {
  const groups = mappingGroups(Array.from({ length: 21 }, (_, i) => file(`src/f${String(i + 1).padStart(2, "0")}.ts`, 100)));
  expect(groups.map((group) => group.length)).toEqual([20, 1]);
  expect(paths(groups)[1]).toEqual(["src/f21.ts"]);
});

test("the whole history's route files are the files of head named by path or pattern, each added and weighed by its size at head, which GitHub's tree gives (#373)", () => {
  const tree = [
    { path: "package.json", sha: "1", size: 700 }, { path: "src/main.ts", sha: "2", size: 400 }, { path: "src/app.controller.ts", sha: "3", size: 2_000 },
    { path: "src/users/users.controller.ts", sha: "4", size: 30_000 }, { path: "src/users/dto/create-user.dto.ts", sha: "5", size: 300 }, { path: "src/orders/orders.controller.ts", sha: "6", size: 15_000 },
  ];
  const listed = routeFilesAt(tree, ["src/**/*.controller.ts", "src/app.controller.ts"]);
  expect(listed).toEqual({ files: [
    { path: "src/app.controller.ts", status: "added", patchChars: 2_000 }, { path: "src/orders/orders.controller.ts", status: "added", patchChars: 15_000 }, { path: "src/users/users.controller.ts", status: "added", patchChars: 30_000 },
  ], unmatched: [] });
  // 2,000 and 15,000 fit together; 30,000 more would pass 40,000.
  expect(paths(mappingGroups(listed.files))).toEqual([["src/app.controller.ts", "src/orders/orders.controller.ts"], ["src/users/users.controller.ts"]]);
  expect(routeFilesAt(tree, ["routes/*.php", "src/users/users.controller.ts"]).unmatched).toEqual(["routes/*.php"]);
});

test("a route file whose size the tree does not give, as on GitLab, weighs one page of repoReadFile, 9,000 characters, so four go to a group (#373)", () => {
  const tree = ["a", "b", "c", "d", "e"].map((n, i) => ({ path: `app/Http/Controllers/${n.toUpperCase()}Controller.php`, sha: String(i) }));
  const listed = routeFilesAt(tree, ["app/Http/Controllers/*Controller.php"]);
  expect(listed.files.map((f) => f.patchChars)).toEqual([9_000, 9_000, 9_000, 9_000, 9_000]);
  expect(mappingGroups(listed.files).map((group) => group.length)).toEqual([4, 1]);
});
