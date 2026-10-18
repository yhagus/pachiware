import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAssistantOutput } from "../eval/assistantChecks";
import { loadAssistantFixtures, type AssistantFixture } from "../eval/assistantFixtures";
import { gradeAssistantRun, type AssistantOutput, type AssistantState } from "../eval/assistantRun";
import { EVAL_DIR } from "../eval/repository";
import { loadExam } from "../eval/scorecard";

const empty: AssistantState = { tasks: [], memory: { channel: [], guild: [] }, files: [], reminders: [] };
const venue = { title: "Book the venue", status: "pending", dueAt: "2026-10-15", assignedTo: "Bob", createdByName: "Alice" };
const state = (tasks: AssistantState["tasks"]): AssistantState => ({ ...empty, tasks });

const fixture: AssistantFixture = {
  name: "x", messages: ["can you note that Bob has to book the venue by tomorrow?", "and give the other one to him too"],
  facts: {
    language: "en", area: "tasks", clock: "2026-10-14T02:00:00Z", mustCover: ["Booking the venue is Bob's task"],
    turns: [
      { tasks: [{ title: "venue", status: "pending", dueAt: "2026-10-15", assignedTo: "Bob", createdByName: "Alice" }] },
      { ambiguous: "There is no other task", tasks: [{ title: "venue" }] },
    ],
  },
};
const output: AssistantOutput = {
  kind: "assistant", fixture: "x", posts: [],
  turns: [
    { n: 1, message: fixture.messages[0]!, replies: ["Added: Book the venue, Bob, due Thursday 15 October."], confirm: false, pings: [], state: state([venue]) },
    { n: 2, message: fixture.messages[1]!, replies: ["Which task do you mean? The only one here is Book the venue, already Bob's."], confirm: false, pings: [], state: state([venue]) },
  ],
};
const checks = (o: AssistantOutput, f: AssistantFixture = fixture) => checkAssistantOutput(o, f).map((x) => `${x.turn} ${x.check}: ${x.message}`);
const withTurn = (n: number, patch: Partial<AssistantOutput["turns"][number]>): AssistantOutput => ({ ...output, turns: output.turns.map((t) => (t.n === n ? { ...t, ...patch } : t)) });

describe("code checks on one run", () => {
  test("a run whose state and replies match the facts passes", () => {
    expect(checkAssistantOutput(output, fixture)).toEqual([]);
  });

  test("a task is matched by a phrase of its title, and every given field must agree", () => {
    const plain: AssistantFixture = { ...fixture, facts: { ...fixture.facts, turns: [fixture.facts.turns[0]!, {}] } };
    expect(checks(withTurn(1, { state: state([{ ...venue, title: "Call the caterer" }]) }), plain)).toEqual(['1 tasks: No task whose title contains "venue"; found: Call the caterer.']);
    expect(checks(withTurn(1, { state: state([{ ...venue, dueAt: "2026-10-16", assignedTo: null }]) }), plain)).toEqual([
      '1 tasks: Task "Book the venue": dueAt is 2026-10-16, expected 2026-10-15.',
      '1 tasks: Task "Book the venue": assignedTo is unassigned, expected Bob.',
    ]);
    expect(checks(withTurn(1, { state: state([venue, { ...venue, title: "Book the venue again" }]) }), plain)).toEqual(["1 tasks: 2 tasks exist, expected 1."]);
  });

  test("a task's Progress notes and its channel are compared when the facts give them", () => {
    const f: AssistantFixture = { ...fixture, facts: { ...fixture.facts, turns: [{ tasks: [{ title: "venue", notes: ["deposit"] }, { title: "poster", channel: "#launch", notes: [] }] }, {}] } };
    const poster = { ...venue, title: "Print the poster", channel: "#launch" };
    expect(checks(withTurn(1, { state: state([{ ...venue, notes: ["- 2026-10-14 Alice: paid the deposit"] }, poster]) }), f)).toEqual([]);
    expect(checks(withTurn(1, { state: state([{ ...venue, notes: ["- 2026-10-14 Alice: called them"] }, { ...poster, channel: undefined, notes: ["- 2026-10-14 Alice: printed"] }]) }), f)).toEqual([
      '1 tasks: Task "Book the venue": no Progress note contains "deposit"; notes: - 2026-10-14 Alice: called them.',
      '1 tasks: Task "Print the poster": channel is this channel, expected #launch.',
      '1 tasks: Task "Print the poster": has 1 Progress note, expected none.',
    ]);
  });

  test("an ambiguous turn must leave the Workspace as it was", () => {
    expect(checks(withTurn(2, { state: state([venue, { ...venue, title: "Other" }]) }))).toEqual([
      "2 acted: The request was ambiguous, but the Workspace changed.",
      "2 tasks: 2 tasks exist, expected 1.",
    ]);
  });

  test("no reply, a Confirm button, or a ping fails the turn", () => {
    expect(checks(withTurn(1, { replies: [] }))).toEqual(["1 reply: The bot did not reply."]);
    expect(checks(withTurn(1, { confirm: true }))).toEqual(["1 confirm: A Confirm button was offered; nothing here needs one."]);
    expect(checks(withTurn(1, { pings: ["user-bob"] }))).toEqual(["1 pings: The reply pinged user-bob; only a Reminder post pings."]);
  });

  test("filler and the other language fail", () => {
    expect(checks(withTurn(1, { replies: ["Added: Book the venue, Bob, due Thursday. Hope this helps!"] }))).toEqual(['1 filler: Filler: "Added: Book the venue, Bob, due Thursday. Hope this helps!"']);
    expect(checks(withTurn(1, { replies: ["Sudah saya catat: Book the venue untuk Bob, jatuh tempo besok, dan ini tidak perlu konfirmasi dari kamu."] }))).toEqual(["1 language: The reply reads as Indonesian; the brief is in English."]);
    expect(checks(withTurn(1, { replies: ["Done."] }))).toEqual([]);
  });

  test("replyContains, replyLacks and the fixed task-list format are checked on the turn's replies", () => {
    const f: AssistantFixture = { ...fixture, facts: { ...fixture.facts, turns: [{ replyContains: ["venue"], replyLacks: ["invoice"], taskList: true }, {}] } };
    expect(checks(withTurn(1, { replies: ["Open:\npending | due 2026-10-15 | Bob | 0a1b2c3d | Book the venue"] }), f)).toEqual([]);
    expect(checks(withTurn(1, { replies: ["Open: the venue booking and the invoice"] }), f)).toEqual([
      '1 format: The reply mentions "invoice".',
      "1 format: No line in the fixed task format (status | due | assignee | id | title).",
    ]);
    expect(checks(withTurn(1, { replies: ["pending | due 2026-10-15 | Bob | 0a1b2c3d | Book it"] }), f)).toEqual(['1 format: The reply does not mention "venue".']);
  });

  test("Memory lines, files and Reminder rows are compared with the facts", () => {
    const f: AssistantFixture = { ...fixture, facts: { ...fixture.facts, turns: [{
      memory: { channel: { has: ["Bob prefers mornings"], lacks: ["password"] }, guild: { has: ["Releases on Thursdays"] } },
      files: ["files/report.md", "files/report.pdf"],
      reminders: [{ text: "standup", recurrence: "weekly", weekdays: [1, 4], timeOfDay: "09:00", nextAt: "2026-10-15T02:00:00.000Z", mentions: [] }],
    }, {}] } };
    const good: AssistantState = {
      tasks: [], memory: { channel: ["- 2026-10-14 (Alice): Bob prefers mornings"], guild: ["- 2026-10-14 (Alice): Releases on Thursdays"] }, files: ["files/report.md", "files/report.pdf"],
      reminders: [{ text: "post the standup", recurrence: "weekly", weekdays: [1, 4], timeOfDay: "09:00", timezone: "Asia/Jakarta", nextAt: "2026-10-15T02:00:00.000Z", status: "active", mentions: [] }],
    };
    expect(checks(withTurn(1, { state: good }), f)).toEqual([]);
    const bad: AssistantState = { ...good, memory: { channel: ["- 2026-10-14 (Alice): the password is hunter2"], guild: [] }, files: ["files/report.pdf"], reminders: [{ ...good.reminders[0]!, weekdays: [1], nextAt: "2026-10-19T02:00:00.000Z" }] };
    expect(checks(withTurn(1, { state: bad }), f)).toEqual([
      '1 memory: channel Memory has no line containing "Bob prefers mornings".',
      '1 memory: channel Memory has a line containing "password".',
      '1 memory: guild Memory has no line containing "Releases on Thursdays".',
      "1 files: files/ holds files/report.pdf, expected files/report.md, files/report.pdf.",
      '1 reminders: Reminder "post the standup": weekdays is 1, expected 1, 4.',
      '1 reminders: Reminder "post the standup": nextAt is 2026-10-19T02:00:00.000Z, expected 2026-10-15T02:00:00.000Z.',
    ]);
  });

  test("Reminder posts after the scheduler tick are checked on the last turn", () => {
    const f: AssistantFixture = { ...fixture, facts: { ...fixture.facts, then: { clock: "2026-10-15T09:00:10+07:00", posts: [{ contains: "standup", pings: ["user-alice"] }] } } };
    expect(checks({ ...output, posts: [{ text: "<@user-alice> Reminder: post the standup", pings: ["user-alice"] }] }, f)).toEqual([]);
    expect(checks(output, f)).toEqual(["2 posts: 0 Reminder posts after the tick, expected 1."]);
    expect(checks({ ...output, posts: [{ text: "<@user-alice> Reminder: lunch", pings: [] }] }, f)).toEqual([
      '2 posts: Post 1 does not say "standup": <@user-alice> Reminder: lunch',
      "2 posts: Post 1 pings nobody, expected user-alice.",
    ]);
  });

  test("a run with fewer turns than the facts fails every missing turn", () => {
    expect(checks({ ...output, turns: output.turns.slice(0, 1) })).toEqual(["2 reply: The bot did not reply."]);
  });
});

describe("fixtures and recorded runs", () => {
  const fixtures = loadAssistantFixtures();
  const dir = join(EVAL_DIR, "recorded", "assistant");
  const recorded: AssistantOutput[] = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

  test("the briefs cover every daily behaviour named in the spec, in both languages", () => {
    const names = fixtures.map((f) => f.name);
    for (const name of ["task-casual-indonesian", "task-casual-english", "due-dates-relative", "status-by-title", "remember-forget", "file-search", "reminder-weekly",
      "assign-ambiguous-name", "assign-unknown-name", "progress-note", "cancel-with-reason", "task-reference-ambiguous", "plate-across-channels", "bulk-cancel",
      "decision-other-channel", "action-items-across-meetings", "nothing-found", "private-channel-dm", "minutes-as-document",
      "recall-asked-in-indonesian", "recall-asked-in-english", "recall-decision-replaced", "recall-done-other-channel", "recall-done-pull-request"]) expect(names).toContain(name);
    expect(new Set(fixtures.map((f) => f.facts.language))).toEqual(new Set(["en", "id"]));
    for (const f of fixtures) {
      expect(f.facts.mustCover.length).toBeGreaterThan(0);
      expect(f.facts.turns).toHaveLength(f.messages.length);
      expect(Number.isNaN(Date.parse(f.facts.clock))).toBe(false);
    }
  });

  test("a fixture whose turns do not match its messages, or with a bad clock, is refused", () => {
    const tmp = mkdtempSync(join(tmpdir(), "eval-assistant-"));
    mkdirSync(join(tmp, "x"));
    writeFileSync(join(tmp, "x", "brief.md"), "note this");
    writeFileSync(join(tmp, "x", "follow-ups.md"), "and that\n---\nand this");
    writeFileSync(join(tmp, "x", "facts.yaml"), "language: en\narea: tasks\nclock: 2026-10-14T02:00:00Z\nmustCover: [m]\nturns: [{}]\n");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x has 3 messages but 1 turns");
    writeFileSync(join(tmp, "x", "facts.yaml"), "language: en\narea: tasks\nclock: soon\nmustCover: [m]\nturns: [{}, {}, {}]\n");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: clock is not a time");
    writeFileSync(join(tmp, "x", "facts.yaml"), "language: en\narea: tasks\nclock: 2026-10-14T02:00:00Z\nmustCover: [m]\nturns: [{}, {}, {}]\n");
    expect(loadAssistantFixtures(tmp)[0]!.messages).toEqual(["note this", "and that", "and this"]);
  });

  test("a fixture without an area of the Rapor is refused", () => {
    const tmp = mkdtempSync(join(tmpdir(), "eval-assistant-"));
    mkdirSync(join(tmp, "x"));
    writeFileSync(join(tmp, "x", "brief.md"), "note this");
    writeFileSync(join(tmp, "x", "facts.yaml"), "language: en\nclock: 2026-10-14T02:00:00Z\nmustCover: [m]\nturns: [{}]\n");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: facts.yaml area is capture, recall, tasks, group or loop");
    writeFileSync(join(tmp, "x", "facts.yaml"), "language: en\narea: chat\nclock: 2026-10-14T02:00:00Z\nmustCover: [m]\nturns: [{}]\n");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: facts.yaml area is capture, recall, tasks, group or loop");
  });

  test("a scorecard naming a brief that does not exist, holding out one outside its briefs, or missing a weight is refused", () => {
    const file = join(mkdtempSync(join(tmpdir(), "eval-scorecard-")), "scorecard.yaml");
    const card = (briefs: string, holdout = "[]", weights = "{ capture: 20, recall: 25, tasks: 20, group: 10, loop: 15 }") => { writeFileSync(file, `version: 1\nweights: ${weights}\nbriefs: ${briefs}\nholdout: ${holdout}\n`); return () => loadExam(fixtures, file); };
    expect(card("[file-search, no-such-brief]")).toThrow("scorecard.yaml names no-such-brief, which is no brief under assistant/");
    expect(card("[file-search]", "[remember-forget]")).toThrow("scorecard.yaml holds out remember-forget, which is not among its briefs");
    expect(card("[file-search]", "[]", "{ capture: 20, recall: 25, tasks: 20, loop: 15 }")).toThrow("scorecard.yaml weights every area with a positive number; group has none");
    expect(card("[file-search, file-search]")).toThrow("scorecard.yaml names file-search twice");
    expect(card("[file-search, remember-forget]", "[remember-forget]")()).toEqual({
      version: "1", weights: { capture: 20, recall: 25, tasks: 20, group: 10, loop: 15 }, briefs: ["file-search", "remember-forget"], holdout: ["remember-forget"],
      areas: Object.fromEntries(fixtures.map((f) => [f.name, f.facts.area])),
    });
  });

  test("every brief has an area and sits in the committed scorecard, whose weights are the Rapor's", () => {
    const exam = loadExam(fixtures);
    expect(exam.weights).toEqual({ capture: 20, recall: 25, tasks: 20, group: 10, loop: 15 });
    expect([...exam.briefs].sort()).toEqual(fixtures.map((f) => f.name).sort());
    expect(exam.areas["remember-forget"]).toBe("loop");
    expect(exam.areas["file-search"]).toBe("capture");
    expect(exam.areas["recall-among-distractors"]).toBe("recall");
    expect(exam.areas["reminder-weekly"]).toBe("tasks");
  });

  test("a seed file must sit below its channel's folder, and hidden channels are a list of names", () => {
    const tmp = mkdtempSync(join(tmpdir(), "eval-assistant-"));
    mkdirSync(join(tmp, "x"));
    writeFileSync(join(tmp, "x", "brief.md"), "what did we decide?");
    const facts = (seed: string) => writeFileSync(join(tmp, "x", "facts.yaml"), `language: en\narea: recall\nclock: 2026-10-14T02:00:00Z\nmustCover: [m]\nturns: [{}]\nseed: ${seed}\n`);
    facts("{ files: [{ channel: ops, path: ../../shared/MEMORY.md, content: x }] }");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: each seed file needs a path below its channel's folder and a content");
    facts("{ files: [{ path: notes/a.md }] }");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: each seed file needs a path below its channel's folder and a content");
    facts("{ hidden: direksi }");
    expect(() => loadAssistantFixtures(tmp)).toThrow("x seed.hidden must be a list of strings");
    facts("{ hidden: [direksi], files: [{ channel: direksi, path: minutes/2026-10-10-board.md, content: x }] }");
    expect(loadAssistantFixtures(tmp)[0]!.facts.seed).toEqual({ hidden: ["direksi"], files: [{ channel: "direksi", path: "minutes/2026-10-10-board.md", content: "x" }] });
  });

  test("every brief has a recorded dry run", () => {
    expect(recorded.map((r) => r.fixture).sort()).toEqual(fixtures.map((f) => f.name).sort());
  });

  test.each(recorded.map((r) => [r.fixture, r] as const))("the recorded run of %s passes every code check", (name, run) => {
    const graded = gradeAssistantRun(run, fixtures.find((f) => f.name === name)!);
    expect(graded.failures).toEqual([]);
    expect(graded.passed).toBe(true);
  });
});

test("the citations check fails an unrendered ref and a link nothing seeded holds, and passes the seeded Minutes' posted message and a seeded pull request", () => {
  const seeded: AssistantFixture = {
    name: "cited", messages: ["is audio normalization done?"],
    facts: {
      language: "en", area: "recall", clock: "2026-10-14T02:00:00Z", mustCover: [], turns: [{}],
      seed: {
        files: [{ path: "minutes/2026-10-06-sync.md", content: "---\ntitle: \"Sync\"\nguildId: \"guild-1\"\npostedIn: \"channel-1\"\nmessageId: \"5100\"\n---\n# Sync\nSee https://docs.acme.test/loudness\n" }],
        git: { repos: ["acme/*"], pullRequests: [{ repo: "acme/podcast", number: 42, title: "Normalize", mergedAt: "2026-10-12T00:00:00Z" }] },
      },
    },
  };
  const run = (reply: string): AssistantOutput => ({ turns: [{ n: 1, message: "q", replies: [reply], confirm: false, pings: [], state: empty }], posts: [] } as any);
  const cited = (reply: string) => checkAssistantOutput(run(reply), seeded).filter((f) => f.check === "citations").map((f) => f.message);
  expect(cited("Discussed [#channel-1 · Minutes 2026-10-06](<https://discord.com/channels/guild-1/channel-1/5100>), done in https://github.com/acme/podcast/pull/42. Spec: https://docs.acme.test/loudness.")).toEqual([]);
  expect(cited("Discussed [K1], see https://docs.acme.test/made-up.")).toEqual([
    "The reply leaves the ref [K1] unrendered.",
    "The reply links https://docs.acme.test/made-up, which nothing seeded holds.",
  ]);
});
