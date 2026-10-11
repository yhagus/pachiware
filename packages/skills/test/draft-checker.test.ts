import { expect, test } from "bun:test";
import { checkDraft } from "../src/draftChecker.js";

const body = (parts: Partial<Record<"summary" | "current" | "desired" | "acceptance" | "out" | "open" | "blocked" | "footer", string | null>> = {}) => {
  const p = {
    summary: "## Summary\nExports keep the table's filters so people get what they see.",
    current: null,
    desired: "## Desired behaviour\nAn export holds exactly the rows the table shows, filters included.",
    acceptance: "## Acceptance criteria\n- [ ] Exporting a filtered table yields only the filtered rows\n- [ ] An empty table exports a header-only file *(added)*",
    out: "## Out of scope\n- Scheduled exports",
    open: null,
    blocked: null,
    footer: "---\n[Drafted by Pachiware from a brief by Alice](https://discord.com/channels/1/2/3)",
    ...parts,
  };
  return [p.summary, p.current, p.desired, p.acceptance, p.out, p.open, p.blocked, p.footer].filter((s) => s !== null).join("\n\n");
};
const rules = (draft: { title: string; body: string }) => checkDraft(draft).map((v) => v.rule);

test("a draft in the anatomy and within budget has no violations", () => {
  expect(checkDraft({ title: "Keep table filters in CSV exports", body: body() })).toEqual([]);
  const open = "## Open questions\n**Established so far:**\n- Exports are CSV only\n\n**Still need from @Alice:**\n- Should hidden columns be exported? ➡️ No, only visible ones.";
  expect(checkDraft({ title: "Keep table filters in CSV exports", body: body({ current: "## Current behaviour\nExports ignore filters.", open, blocked: "## Blocked by\n- Draft 1: Stream CSV exports" }) })).toEqual([]);
});

test("the title is imperative-length and carries no category prefix", () => {
  expect(rules({ title: "x".repeat(71), body: body() })).toEqual(["title"]);
  expect(rules({ title: "[Feature] Keep filters", body: body() })).toEqual(["title"]);
  expect(rules({ title: "  ", body: body() })).toEqual(["title"]);
  expect(rules({ title: "x".repeat(70), body: body() })).toEqual([]);
});

test("the body fits one Discord embed", () => {
  const long = body({ desired: `## Desired behaviour\n${"word ".repeat(820)}` });
  expect(long.length).toBeGreaterThan(4096);
  const found = checkDraft({ title: "Keep filters", body: long });
  expect(found.map((v) => v.rule)).toEqual(["body"]);
  expect(found[0]!.message).toContain("4096");
});

test("at most 7 acceptance criteria, each a task-list item", () => {
  const items = (n: number) => `## Acceptance criteria\n${Array.from({ length: n }, (_, i) => `- [ ] criterion ${i + 1}`).join("\n")}`;
  expect(rules({ title: "Keep filters", body: body({ acceptance: items(7) }) })).toEqual([]);
  const over = checkDraft({ title: "Keep filters", body: body({ acceptance: items(8) }) });
  expect(over.map((v) => v.rule)).toEqual(["acceptanceCriteria"]);
  expect(over[0]!.message).toMatch(/8 acceptance criteria.*at most 7/);
  expect(rules({ title: "Keep filters", body: body({ acceptance: "## Acceptance criteria\n- exports work" }) })).toEqual(["acceptanceCriteria"]);
});

test("at most 5 open questions, in the needs-info shape, each with a recommendation", () => {
  const open = (n: number, rec = " ➡️ yes") => `## Open questions\n**Still need from @Alice:**\n${Array.from({ length: n }, (_, i) => `- question ${i + 1}?${rec}`).join("\n")}`;
  expect(rules({ title: "Keep filters", body: body({ open: open(5) }) })).toEqual([]);
  expect(rules({ title: "Keep filters", body: body({ open: open(6) }) })).toEqual(["openQuestions"]);
  expect(rules({ title: "Keep filters", body: body({ open: open(1, "") }) })).toEqual(["openQuestions"]);
  expect(rules({ title: "Keep filters", body: body({ open: "## Open questions\n- what about hidden columns?" }) })).toEqual(["openQuestions"]);
});

test("required sections, the anatomy's order, no unknown or empty sections, and the footer", () => {
  expect(rules({ title: "Keep filters", body: body({ out: null }) })).toEqual(["section"]);
  expect(rules({ title: "Keep filters", body: body({ summary: null }) })).toEqual(["section"]);
  expect(rules({ title: "Keep filters", body: body({ footer: null }) })).toEqual(["footer"]);
  expect(rules({ title: "Keep filters", body: body({ current: "## Current behaviour\nN/A" }) })).toEqual(["empty"]);
  expect(rules({ title: "Keep filters", body: body({ blocked: "## User stories\n- as a user…" }) })).toEqual(["section"]);
  const swapped = body().replace(/## Out of scope\n- Scheduled exports\n\n/, "").replace("## Summary", "## Out of scope\n- Scheduled exports\n\n## Summary");
  expect(rules({ title: "Keep filters", body: swapped })).toEqual(["order"]);
});

test("the body names concepts, not file paths or line numbers; links and the Context used footer may hold paths", () => {
  const desired = (text: string) => body({ desired: `## Desired behaviour\n${text}` });
  expect(rules({ title: "Keep filters", body: desired("The `SessionStore` keeps the session across the redirect.") })).toEqual([]);
  expect(rules({ title: "Keep filters", body: desired("See [the guide](https://example.com/docs/guide.md) and and/or TCP/IP.") })).toEqual([]);
  expect(checkDraft({ title: "Keep filters", body: desired("Change `apps/agent/src/session.ts` so the session survives.") })).toEqual([{ rule: "paths", message: "The body names the file path apps/agent/src/session.ts; name the concept (type, function, glossary term) instead." }]);
  expect(rules({ title: "Keep filters", body: desired("The bug is at session.ts:42.") })).toEqual(["paths"]);
  const footer = "---\n[Drafted by Pachiware from a brief by Alice](https://discord.com/channels/1/2/3).\n\n**Context used** (o/r at `abc1234`):\n- [src/session.ts](https://github.com/o/r/blob/abc/src/session.ts)";
  expect(rules({ title: "Keep filters", body: body({ footer }) })).toEqual([]);
});

test("every violation is reported at once", () => {
  expect(rules({ title: "x".repeat(80), body: body({ out: null, footer: null }) })).toEqual(["title", "section", "footer"]);
});
