import { expect, test } from "bun:test";
import { mappingGroups } from "../src/openapi/mapping.js";

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
