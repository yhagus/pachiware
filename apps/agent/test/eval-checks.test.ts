import { describe, expect, test } from "bun:test";
import { checkDraftOutput, checkOutput, languageOf, type DraftOutput } from "../eval/checks";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixtures } from "../eval/fixtures";
import { EVAL_DIR, pinnedRepo, pinnedTree } from "../eval/repository";
import { gradeRun } from "../eval/run";

const pin = pinnedRepo();
const paths = pinnedTree(pin.commit);
const blob = (path: string, sha = pin.commit) => `https://github.com/yhagus/pachiware/blob/${sha}/${path}`;
const footer = (links: string[], sha7 = pin.commit.slice(0, 7)) =>
  `---\n[Drafted by Pachiware from a brief by Alice](https://discord.com/channels/guild-1/channel-1/1001).\n\n**Context used** (yhagus/pachiware at \`${sha7}\`):\n${links.join("\n")}`;

const english: DraftOutput = {
  n: 1, title: "Reply to each message in an existing thread", repo: "yhagus/pachiware", labels: ["bug"],
  body: [
    "## Summary\nMessages in a thread the bot already answers are merged into one turn, but the documented behaviour is one reply per message.",
    "## Current behaviour\nThe burst window joins thread messages that arrive close together and answers them once.",
    "## Desired behaviour\nEvery message in an existing thread gets its own reply, as it does in a direct message.",
    "## Acceptance criteria\n- [ ] Two quick messages in an existing thread get two replies\n- [ ] Channel messages are still joined within the burst window",
    "## Out of scope\n- Changing the burst window length",
    footer(["- [README.md](" + blob("README.md") + ")", "- [#29 Thread messages are debounced, contrary to Phase 15.2](https://github.com/yhagus/pachiware/issues/29)", "- [apps/agent/src/discord/client.ts](" + blob("apps/agent/src/discord/client.ts") + ")"]),
  ].join("\n\n"),
};
const indonesian: DraftOutput = {
  n: 1, title: "Bot menjawab dalam bahasa pesan yang ditanyakan", repo: "yhagus/pachiware", labels: ["enhancement"],
  body: [
    "## Summary\nBot kadang menjawab dalam bahasa Inggris walaupun pertanyaan ditulis dalam bahasa Indonesia.",
    "## Desired behaviour\nBot selalu menjawab dalam bahasa yang sama dengan pesan yang dijawab. Kalau pesan mencampur dua bahasa, bot memakai bahasa yang paling banyak dipakai.",
    "## Acceptance criteria\n- [ ] Pertanyaan dalam bahasa Indonesia dijawab dalam bahasa Indonesia\n- [ ] Pesan campuran dijawab dalam bahasa yang dominan",
    "## Out of scope\n- Terjemahan otomatis untuk pesan lama",
    footer(["- [README.md](" + blob("README.md") + ")"]),
  ].join("\n\n"),
};
const ctx = (language: "en" | "id") => ({ pin, paths, language });
const failures = (d: DraftOutput, language: "en" | "id" = "en") => checkDraftOutput(d, ctx(language)).map((f) => f.check);

describe("code checks on one draft", () => {
  test("a draft in the anatomy, with existing labels and links that resolve at the pinned commit, passes", () => {
    expect(checkDraftOutput(english, ctx("en"))).toEqual([]);
    expect(checkDraftOutput(indonesian, ctx("id"))).toEqual([]);
  });

  test("the draft checker's anatomy rules apply", () => {
    expect(checkDraftOutput({ ...english, title: "x".repeat(71) }, ctx("en"))).toEqual([{ check: "anatomy", message: "title: The title is 71 characters; at most 70." }]);
  });

  test("a proposed label the pinned repository does not have fails", () => {
    expect(checkDraftOutput({ ...english, labels: ["bug", "performance"] }, ctx("en"))).toEqual([{ check: "labels", message: "performance is not a label of yhagus/pachiware." }]);
  });

  test("a Context used link must resolve at the pinned commit", () => {
    const later = english.body.replace(blob("README.md"), blob("apps/agent/src/discord/replyStyle.ts"));
    expect(checkDraftOutput({ ...english, body: later }, ctx("en"))).toEqual([{ check: "context", message: "apps/agent/src/discord/replyStyle.ts does not exist at 74a06a0." }]);
    const elsewhere = english.body.replace(blob("README.md"), blob("README.md", "0123456789abcdef0123456789abcdef01234567"));
    expect(checkDraftOutput({ ...english, body: elsewhere }, ctx("en"))).toEqual([{ check: "context", message: "README.md is linked at 0123456, not at the pinned commit 74a06a0." }]);
    const issue = english.body.replace("issues/29", "issues/30");
    expect(checkDraftOutput({ ...english, body: issue }, ctx("en"))).toEqual([{ check: "context", message: "Issue #30 is not an open issue of yhagus/pachiware." }]);
  });

  test("a draft without the pinned repository fails, since that repository is open to every brief", () => {
    expect(failures({ ...english, repo: null })).toEqual(["context"]);
  });

  test("filler from the reply-style list fails anywhere in the draft", () => {
    const padded = english.body.replace("as it does in a direct message.", "as it does in a direct message. Hope this helps!");
    expect(checkDraftOutput({ ...english, body: padded }, ctx("en"))).toEqual([{ check: "filler", message: "Filler: \"Every message in an existing thread gets its own reply, as it does in a direct message. Hope this helps!\"" }]);
  });

  test("a draft in another language than the brief's fails", () => {
    expect(failures(english, "id")).toEqual(["language"]);
    expect(failures(indonesian, "en")).toEqual(["language"]);
  });
});

describe("languageOf", () => {
  test("tells English from Indonesian, ignoring the fixed English headings and links", () => {
    expect(languageOf(english.body)).toBe("en");
    expect(languageOf(indonesian.body)).toBe("id");
    expect(languageOf("## Summary\n`BURST_MS`")).toBe("unknown");
  });
});

test("an output with no drafts fails", () => {
  expect(checkOutput({ fixture: "x", drafts: [] }, ctx("en"))).toEqual([{ draft: null, check: "drafts", message: "No draft was posted." }]);
  expect(checkOutput({ fixture: "x", drafts: [english, { ...english, n: 2, labels: ["nope"] }] }, ctx("en"))).toEqual([{ draft: 2, check: "labels", message: "nope is not a label of yhagus/pachiware." }]);
});

describe("fixtures and recorded drafts", () => {
  const fixtures = loadFixtures();
  const recorded = readdirSync(join(EVAL_DIR, "recorded")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(EVAL_DIR, "recorded", f), "utf8")));

  test("every fixture holds a brief, the author's answers, and facts with a language and must-cover points", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    for (const f of fixtures) {
      expect(["en", "id"]).toContain(f.facts.language);
      expect(f.facts.mustCover.length).toBeGreaterThan(0);
      expect(f.brief && f.answers).toBeTruthy();
    }
  });

  test("about 20 briefs cover every agreed edge case", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(18);
    const cases = new Set<string>(fixtures.flatMap((f) => f.facts.cases));
    for (const c of ["one-line", "vague", "duplicate", "ambiguous-repository", "mixed-language", "screenshot"]) expect(cases).toContain(c);
  });

  test("a screenshot brief carries its image, and an ambiguous-repository brief opens a second repository", () => {
    for (const f of fixtures.filter((f) => f.facts.cases.includes("screenshot"))) {
      expect(f.images.length).toBeGreaterThan(0);
      for (const image of f.images) expect(image.bytes.length).toBeGreaterThan(0);
    }
    for (const f of fixtures.filter((f) => f.facts.cases.includes("ambiguous-repository"))) expect(f.facts.alsoOpen.length).toBeGreaterThan(0);
  });

  test("a fixture with an unknown edge case is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-fixtures-"));
    mkdirSync(join(dir, "x"));
    writeFileSync(join(dir, "x", "brief.md"), "b");
    writeFileSync(join(dir, "x", "answers.md"), "a");
    writeFileSync(join(dir, "x", "facts.yaml"), "language: en\ncases: [long]\nmustCover: [m]\n");
    expect(() => loadFixtures(dir)).toThrow("Fixture x: cases are one-line, vague, duplicate, ambiguous-repository, mixed-language, screenshot");
    writeFileSync(join(dir, "x", "facts.yaml"), "language: en\ncases: [screenshot]\nmustCover: [m]\n");
    expect(() => loadFixtures(dir)).toThrow("Fixture x is a screenshot brief without an image");
  });

  test("at least one recorded run exists", () => expect(recorded.length).toBeGreaterThan(0));

  test.each(recorded.map((r) => [r.fixture, r]))("the recorded drafts of %s pass every code check at the pinned commit", (name, output) => {
    expect(output.commit).toBe(pin.commit);
    expect(gradeRun(output, fixtures.find((f) => f.name === name)!, pin).failures).toEqual([]);
  });
});
