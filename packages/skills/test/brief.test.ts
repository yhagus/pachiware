import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { applyRound, renderRound, briefState } from "../src/brief.js";

const empty = briefState({} as any);
const points = Array.from({ length: 30 }, (_, i) => `${"p".repeat(190)} ${i + 1}`);

test("a round at every field's limit packs into messages under 2000 characters without splitting a question", () => {
  const state = applyRound(empty, {
    points,
    drafts: points.map((_, i) => ({ point: i + 1, title: "t".repeat(70), summary: "s".repeat(200), blockedBy: i ? [i] : [] })),
    questions: Array.from({ length: 40 }, (_, i) => ({ point: (i % 30) + 1, question: `${i} ${"q".repeat(490)}`, recommendation: "r".repeat(300), options: Array(5).fill("o".repeat(150)) })),
  });
  const messages = renderRound(state, "author", true);
  for (const m of messages) expect(m.length).toBeLessThan(2000);
  const blocks = messages.flatMap((m) => m.split("\n\n")).filter((b) => b.includes("❓"));
  expect(blocks).toHaveLength(40);
  for (const b of blocks) expect(b).toMatch(/^(\*\*Round 1\*\*\n)?\*\*Point \d+\*\* · p+ \d+\n❓ \*\*Q\d+\*\* \d+ q+\n(?:[a-e]\) o+\n){5}➡️ r+$/);
  expect(messages.at(-1)).toContain("Only <@author> decides here.");
});

test("a round is refused with every problem named, and blocking cycles are caught", () => {
  expect(() => applyRound(empty, { points: ["a"], drafts: [{ point: 2, title: "x".repeat(71), summary: "" }], questions: [{ point: 1, question: "q" }] }))
    .toThrow(/point must be a number from 1 to 1[\s\S]*needs a title and a one-line summary[\s\S]*keep it to 70[\s\S]*needs the question and a recommended answer/);
  expect(() => applyRound(empty, { points: ["a"], drafts: [{ point: 1, title: "A", summary: "a", blockedBy: [2] }, { point: 1, title: "B", summary: "b", blockedBy: [1] }], questions: [] }))
    .toThrow(/cycle/);
});

test("a round with no questions asks the author to accept the breakdown", () => {
  const state = applyRound(empty, { points: ["a"], drafts: [{ point: 1, title: "A", summary: "a" }], questions: [] });
  expect(renderRound(state, "author", true)).toEqual(["**Breakdown** · 1 draft\n**1. A** · point 1\na\n\n**Round 1**\nNo questions this round. Only <@author> decides here: reply \"yes\" to accept the breakdown, or say what to change."]);
});

test("every issue-draft reference file with text borrowed from mattpocock/skills carries its MIT notice", () => {
  const dir = new URL("../playbooks/issue-draft/", import.meta.url);
  const borrowed = readdirSync(dir).filter((f) => f !== "PLAYBOOK.md" && readFileSync(new URL(f, dir), "utf8").includes("mattpocock/skills"));
  expect(borrowed.length).toBeGreaterThan(0);
  for (const f of borrowed) {
    const text = readFileSync(new URL(f, dir), "utf8").replace(/\s+/g, " ");
    expect(text).toContain("Copyright (c) 2026 Matt Pocock");
    expect(text).toContain("The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.");
  }
});
