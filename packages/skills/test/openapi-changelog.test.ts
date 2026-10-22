import { expect, test } from "bun:test";
import { changelogRevisions, changelogScope } from "../src/openapi/changelog.js";

const github = { provider: "github" as const, baseUrl: null, token: "t" };
const gitlab = { provider: "gitlab" as const, baseUrl: null, token: "t" };
const JAKARTA = "Asia/Jakarta";

/** Commits on main with fixed commit times, around midnight in Jakarta (UTC+7). */
const COMMITS = [
  { sha: "c5".padEnd(40, "5"), at: "2026-10-22T17:00:00Z" }, // 23 Oct 00:00 WIB
  { sha: "c4".padEnd(40, "4"), at: "2026-10-22T16:59:59Z" }, // 22 Oct 23:59:59 WIB
  { sha: "c3".padEnd(40, "3"), at: "2026-09-30T17:00:00Z" }, // 1 Oct 00:00 WIB
  { sha: "c2".padEnd(40, "2"), at: "2026-09-30T16:59:59Z" }, // 30 Sep 23:59:59 WIB
  { sha: "c1".padEnd(40, "1"), at: "2026-09-20T03:00:00Z" },
];

/** A provider that lists main's commits newest first, keeping those made at or before `until`. */
async function withCommits(run: (asked: string[]) => Promise<void>) {
  const real = globalThis.fetch, asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const q = new URL(String(url)).searchParams, until = Date.parse(q.get("until")!);
    asked.push(q.get("until")!);
    expect(q.get("sha") ?? q.get("ref_name")).toBe("main");
    const kept = COMMITS.filter((c) => Date.parse(c.at) <= until).slice(0, Number(q.get("per_page")));
    return Response.json(String(url).includes("api.github.com")
      ? kept.map((c) => ({ sha: c.sha, commit: { committer: { date: c.at } } }))
      : kept.map((c) => ({ id: c.sha, committed_date: c.at })));
  }) as any;
  try { await run(asked); } finally { globalThis.fetch = real; }
}

test("a range's head is the last commit through 23:59:59 of `to`, its base the last before 00:00 of `from`, in the place's zone", async () => {
  await withCommits(async (asked) => {
    for (const conn of [github, gitlab]) {
      const { base, head } = await changelogRevisions(conn, "o/r", "main", { scope: "range", from: "2026-10-01", to: "2026-10-22" }, JAKARTA);
      expect(base).toEqual({ ref: "main before 2026-10-01", commit: COMMITS[3]!.sha });
      expect(head).toEqual({ ref: "main through 2026-10-22", commit: COMMITS[1]!.sha, date: "2026-10-22T16:59:59Z" });
    }
    expect(asked.slice(0, 2)).toEqual(["2026-10-22T23:59:59+07:00", "2026-09-30T23:59:59+07:00"]);
  });
});

test("a range that starts before the first commit, and the whole history, compare with the empty tree", async () => {
  await withCommits(async () => {
    const empty = { ref: "(empty)", commit: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" };
    expect((await changelogRevisions(github, "o/r", "main", { scope: "range", from: "2026-09-01", to: "2026-09-30" }, JAKARTA)).base).toEqual(empty);
    const all = await changelogRevisions(github, "o/r", "main", { scope: "all", to: "2026-10-22" }, JAKARTA);
    expect(all.base).toEqual(empty);
    expect(all.head).toMatchObject({ ref: "main", commit: COMMITS[1]!.sha });
  });
});

test("a range with no commit in it, or no commit at all by its end, is refused", async () => {
  await withCommits(async () => {
    await expect(changelogRevisions(github, "o/r", "main", { scope: "range", from: "2026-09-25", to: "2026-09-29" }, JAKARTA)).rejects.toThrow("No commit on main from 2026-09-25 to 2026-09-29: nothing changed, so there is no changelog to write.");
    await expect(changelogRevisions(github, "o/r", "main", { scope: "range", from: "2026-09-01", to: "2026-09-10" }, JAKARTA)).rejects.toThrow("main has no commit on or before 2026-09-10.");
  });
});

test("the guard: what a changelog covers is never chosen for the person", () => {
  const today = "2026-10-22";
  expect(() => changelogScope({}, today)).toThrow("Ask the person first whether the changelog covers the whole history (scope all) or part of it (scope range, from one date to another), and wait for the answer. Never choose for them.");
  expect(() => changelogScope({ scope: "range" }, today)).toThrow("A range needs from, the first day it covers (YYYY-MM-DD). Ask the person for it.");
  expect(() => changelogScope({ scope: "range", from: "2026-10-23" }, today)).toThrow("from (2026-10-23) is after to (2026-10-22).");
  expect(() => changelogScope({ scope: "range", from: "2026-10-01", to: "2026-10-23" }, today)).toThrow("to is after today (2026-10-22).");
  expect(() => changelogScope({ scope: "range", from: "2026-02-30" }, today)).toThrow("from must be a date written YYYY-MM-DD.");
  expect(() => changelogScope({ scope: "all", from: "2026-10-01" }, today)).toThrow("scope all covers the whole history; from is only for a range.");
  expect(changelogScope({ scope: "range", from: "2026-10-01" }, today)).toEqual({ scope: "range", from: "2026-10-01", to: "2026-10-22" });
  expect(changelogScope({ scope: "all" }, today)).toEqual({ scope: "all", to: "2026-10-22" });
});
