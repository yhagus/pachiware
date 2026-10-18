import { expect, test } from "bun:test";
import { rankWork, type WorkHit } from "../src/git.ts";
import { queriesTerms } from "../src/workspace/terms.ts";

// Git hits are ranked by how well their titles hold the question's words, not by date (#247).

const issue = (n: number, title: string, date: string): WorkHit => ({ repo: "acme/api", kind: "issue", number: n, title, state: "open", date, url: `https://github.com/acme/api/issues/${n}` });

test("one old merged pull request that answers the question comes first among 15 newer issues that only share a word", () => {
  const noise = Array.from({ length: 15 }, (_, i) => issue(200 + i, `Audio crackles on device ${i + 1}`, `2026-10-${String(i + 1).padStart(2, "0")}T09:00:00Z`));
  const merged: WorkHit = { repo: "acme/api", kind: "pull_request", number: 41, title: "Add audio normalization to -14 LUFS", state: "merged", date: "2026-06-02T09:00:00Z", url: "https://github.com/acme/api/pull/41" };
  const ranked = rankWork([...noise, merged], queriesTerms(["audio normalization", "normalisasi audio"]));
  expect(ranked[0]!.url).toBe("https://github.com/acme/api/pull/41");
  // Among titles that hold the same words, the newer comes first.
  expect(ranked.slice(1, 3).map((h) => h.number)).toEqual([214, 213]);
});

test("a title in the other language is matched through the work vocabulary and stems", () => {
  const ranked = rankWork([issue(1, "Release notes for 2.4", "2026-10-10T00:00:00Z"), issue(2, "Normalisasi audio di ekspor podcast", "2026-01-01T00:00:00Z")], queriesTerms(["audio normalization"]));
  expect(ranked.map((h) => h.number)).toEqual([2, 1]);
});
