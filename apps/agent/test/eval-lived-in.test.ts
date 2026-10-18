import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLate, parseTask } from "../../../packages/skills/src/builtin/taskFile";
import { parseFrontmatter } from "../../../packages/skills/src/playbooks";
import { checkAssistantOutput } from "../eval/assistantChecks";
import { AREAS, LIVED_IN_DIR, loadAssistantFixtures, type AssistantFixture } from "../eval/assistantFixtures";
import type { AssistantOutput, AssistantState } from "../eval/assistantRun";
import { buildLivedInCorpus, keptFiles, livedInCorpus } from "../eval/lived-in/corpus";
import { retrievalOf, retrievedOf, scoreTurn } from "../eval/retrieval";

const corpus = livedInCorpus();
const CLOCK = Date.parse("2026-10-14T02:00:00Z");

describe("the lived-in corpus", () => {
  test("holds three and a half months of four channels: 300 kept files or more, and every kind of kept material", () => {
    const kept = keptFiles(corpus), kinds = (folder: string) => kept.filter((f) => f.path.startsWith(`${folder}/`)).length;
    expect(kept.length).toBeGreaterThanOrEqual(300);
    expect(new Set(corpus.files.map((f) => f.channel ?? "home"))).toEqual(new Set(["home", "audio-engine", "mobile", "marketing"]));
    expect(corpus.home).toBe("general");
    // story.ts writes 24 Minutes (7 in #general, 7 in #audio-engine, 5 in #mobile, 5 in #marketing), 10 Decisions, 11 Notes and 10 Documents.
    expect([kinds("minutes"), kinds("decisions"), kinds("notes"), kinds("files")]).toEqual([24, 10, 11, 10]);
  });

  test("keeps one Daily log per channel and working day, in its month's folder, and #general talks every working day", () => {
    const logs = corpus.files.filter((f) => f.path.startsWith("daily-logs/"));
    for (const f of logs) {
      const [, month, day] = /^daily-logs\/(\d{4}-\d{2})\/(\d{4}-\d{2}-\d{2})\.md$/.exec(f.path)!;
      expect(day!.startsWith(month!)).toBe(true);
      expect(day! >= "2026-07-01" && day! <= "2026-10-13").toBe(true);
      expect([0, 6]).not.toContain(new Date(`${day}T00:00:00Z`).getUTCDay());
      expect(day).not.toBe("2026-08-17");
    }
    expect(new Set(logs.map((f) => `${f.channel} ${f.path}`)).size).toBe(logs.length);
    // Working days from 1 July to 13 October 2026 without 17 August: July 23, August 20, September 22, October 9.
    expect(logs.filter((f) => !f.channel)).toHaveLength(74);
  });

  test("a story day reads in its Daily log as the bot keeps it: the channel's labels, the item and its message links", () => {
    const log = corpus.files.find((f) => !f.channel && f.path === "daily-logs/2026-08/2026-08-20.md")!;
    const fields = parseFrontmatter(log.content)!.fields as any;
    expect(fields).toMatchObject({ kind: "daily-log", guildId: "guild-1", channelId: "channel-1", channel: "general", day: "2026-08-20", timezone: "Asia/Jakarta" });
    expect(log.content).toContain("# Daily log #general, 2026-08-20\n");
    expect(log.content).toMatch(/\n## Masih terbuka\n\d+\. Tomi lempar ide coba Supabase setelah beta kalau biaya Firestore terus naik; belum dibahas serius, belum ada keputusan( \[↗\]\(https:\/\/discord\.com\/channels\/guild-1\/channel-1\/\d+\))+\n/);
  });

  test("every Task is a task file, with every status, and seven open ones late on the clock", () => {
    const tasks = corpus.files.filter((f) => f.path.startsWith("tasks/")).map((f) => parseTask(f.content));
    expect(tasks.every((t) => t !== null)).toBe(true);
    expect(new Set(tasks.map((t) => t!.status))).toEqual(new Set(["pending", "in_progress", "completed", "cancelled"]));
    // Due before 14 October and still open: the on-call runbook, the limiter, the Bluetooth fix, the onboarding review, the 0.9 regression
    // pass, the landing page price and the creators' brief.
    expect(tasks.filter((t) => isLate(t!, "Asia/Jakarta", CLOCK)).map((t) => t!.title).sort()).toEqual([
      "Fix Bluetooth mic latency on Android", "Fix clipping in the limiter on loud intros", "Kirim brief ke kreator podcast", "Regression pass on the 0.9 beta build",
      "Review onboarding v2", "Update harga di landing page", "Update runbook on-call",
    ]);
  });

  test("is built the same every time", () => {
    expect(JSON.stringify(buildLivedInCorpus())).toBe(JSON.stringify(buildLivedInCorpus()));
  });

  test("serves a git history with pull requests of every state, issues and commits", () => {
    const { pullRequests = [], issues = [], commits = [] } = corpus.git;
    expect(corpus.git.repos).toEqual(["gema/*"]);
    expect(pullRequests.some((p) => p.mergedAt) && pullRequests.some((p) => p.closedAt) && pullRequests.some((p) => !p.mergedAt && !p.closedAt)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    expect(commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha))).toBe(true);
  });
});

describe("the lived-in sessions", () => {
  const sessions = loadAssistantFixtures(LIVED_IN_DIR);

  test("are 15 to 20 multi-turn sessions in both languages, in every area of the Rapor, none named like a brief under assistant/", () => {
    expect(sessions.length).toBeGreaterThanOrEqual(15);
    expect(sessions.length).toBeLessThanOrEqual(20);
    for (const f of sessions) {
      expect([f.name, f.facts.corpus]).toEqual([f.name, "lived-in"]);
      expect([f.name, f.messages.length >= 2 && f.messages.length <= 5]).toEqual([f.name, true]);
    }
    expect(new Set(sessions.map((f) => f.facts.language))).toEqual(new Set(["id", "en"]));
    expect(new Set(sessions.map((f) => f.facts.area))).toEqual(new Set(AREAS));
    const briefs = new Set(loadAssistantFixtures().map((f) => f.name));
    expect(sessions.filter((f) => briefs.has(f.name)).map((f) => f.name)).toEqual([]);
  });

  test("are seeded with the corpus: its members, files, talk, git history and the channel's name", () => {
    const [f] = sessions;
    expect(f!.facts.members?.map((m) => m.name)).toEqual(["Rani", "Bayu", "Sekar", "Joko", "Mira", "Tomi"]);
    expect(f!.facts.seed?.files).toHaveLength(corpus.files.length);
    expect(f!.facts.seed?.messages?.[0]).toEqual({ author: "Sekar", text: "pagii, slide buat weekly jumat siapa yg pegang ya?", at: "2026-10-14T08:05:00+07:00" });
    expect(f!.facts.seed?.home).toBe("general");
    expect(f!.facts.seed?.git?.pullRequests).toHaveLength(corpus.git.pullRequests!.length);
  });

  test("name gold sources that the corpus holds: a kept file by its channel and path, a Task by its title, git work by its URL", () => {
    const files = new Set(corpus.files.map((f) => `#${f.channel ?? corpus.home}/${f.path}`));
    const titles = corpus.files.filter((f) => f.path.startsWith("tasks/")).map((f) => parseTask(f.content)!.title.toLowerCase());
    const urls = new Set([...corpus.git.pullRequests!.map((p) => `https://github.com/${p.repo}/pull/${p.number}`), ...corpus.git.issues!.map((i) => `https://github.com/${i.repo}/issues/${i.number}`)]);
    const missing = sessions.flatMap((f) => f.facts.turns.flatMap((t, i) => (t.gold ?? []).flat().filter((g) => !(g.startsWith("task:") ? titles.some((x) => x.includes(g.slice(5).toLowerCase())) : g.startsWith("https://") ? urls.has(g) : files.has(g))).map((g) => `${f.name} turn ${i + 1}: ${g}`)));
    expect(missing).toEqual([]);
    expect(sessions.filter((f) => f.facts.turns.some((t) => t.search)).length).toBeGreaterThanOrEqual(15);
  });

  test("a corpus nobody wrote, or a search without gold to score it, is refused", () => {
    const tmp = mkdtempSync(join(tmpdir(), "eval-lived-in-"));
    mkdirSync(join(tmp, "x"));
    writeFileSync(join(tmp, "x", "brief.md"), "udh beres blm?");
    const facts = (extra: string) => writeFileSync(join(tmp, "x", "facts.yaml"), `language: id\narea: recall\nclock: 2026-10-14T02:00:00Z\nmustCover: [m]\n${extra}\n`);
    facts("corpus: nope\nturns: [{}]");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: corpus is lived-in, not nope");
    facts("turns: [{ search: { queries: [loudness] } }]");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: turn 1 has a search but no gold to score it against");
    facts("turns: [{ gold: [[]] }]");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: turn 1 gold is a list of sources, each a string or a list of strings that stand in for each other");
    facts("turns: [{ gold: ['#audio/notes/a.md'], search: { queries: [] } }]");
    expect(() => loadAssistantFixtures(tmp)).toThrow("Fixture x: turn 1 search needs queries, the wordings a model would pass to recall");
  });
});

describe("retrieval", () => {
  const recallResult = {
    kept: [{ ref: "K1", label: "#audio · Minutes 2026-08-12", path: "#audio/minutes/2026-08-12-loudness.md" }, { ref: "K2", label: "channel · Note 2026-09-04", path: "channel/notes/2026-09-04-test.md" }],
    tasks: [{ ref: "T1", label: '#mobile · Task "Turn on loudness in the app" (in_progress)' }, { ref: "T2", label: 'channel · Tugas "Rapikan PRD" (cancelled)' }],
    work: [{ ref: "G1", label: 'acme/app · pull request #140 "Loudness toggle" (open)', url: "https://github.com/acme/app/pull/140" }],
    workItems: [],
  };

  test("reads what recall, searchFiles, listTasks and repoSearchWork showed, part by part, with this channel's files under its name", () => {
    expect(retrievedOf("recall", recallResult, "general")).toEqual({
      tool: "recall", kept: ["#audio/minutes/2026-08-12-loudness.md", "#general/notes/2026-09-04-test.md"],
      tasks: ["task:Turn on loudness in the app", "task:Rapikan PRD"], work: ["https://github.com/acme/app/pull/140"],
    });
    expect(retrievedOf("searchFiles", { groups: [{ channel: "#audio", matches: [{ path: "#audio/notes/a.md" }, { path: "channel/files/b.md" }] }] }, "general"))
      .toEqual({ tool: "searchFiles", kept: ["#audio/notes/a.md", "#general/files/b.md"], tasks: [], work: [] });
    expect(retrievedOf("listTasks", { groups: [{ group: "#mobile", tasks: [{ line: "pending | due 2026-10-09, late | Alice | c0000026 | Review onboarding v2" }] }] }, "general"))
      .toEqual({ tool: "listTasks", kept: [], tasks: ["task:Review onboarding v2"], work: [] });
    expect(retrievedOf("repoSearchWork", { items: [{ url: "https://github.com/acme/app/issues/9" }] }, "general")).toEqual({ tool: "repoSearchWork", kept: [], tasks: [], work: ["https://github.com/acme/app/issues/9"] });
    expect(retrievedOf("createTask", { task: "x" }, "general")).toBeNull();
  });

  test("a gold source counts at the best rank it reached in its own part; alternatives stand in for each other; rank 6 is not in the top 5", () => {
    const shown = { tool: "recall", kept: ["#a/1.md", "#a/2.md", "#a/3.md", "#a/4.md", "#a/5.md", "#a/y.md"], tasks: ["task:Fix it now"], work: [] };
    const later = { tool: "searchFiles", kept: ["#a/x.md"], tasks: [], work: [] };
    // #a/x.md or #a/y.md: rank 6 in the first result, rank 1 in the second; "Fix it" is in "Fix it now" at 1; the pull request is never shown.
    expect(scoreTurn(1, [["#a/x.md", "#a/y.md"], "task:fix it", "https://github.com/o/r/pull/1"], [shown, later])).toEqual({ n: 1, gold: 3, found: 2, recall: 2 / 3, rr: 1, ranks: [1, 1, 0] });
    expect(scoreTurn(1, [["#a/x.md", "#a/y.md"], "https://github.com/o/r/pull/1"], [shown])).toEqual({ n: 1, gold: 2, found: 0, recall: 0, rr: 1 / 6, ranks: [6, 0] });
  });

  test("a trial averages the turns that name gold; a turn with gold and no search scores nothing", () => {
    const turns = [{ n: 1, retrieved: [{ tool: "recall", kept: ["#a/1.md"], tasks: [], work: [] }] }, { n: 2 }, { n: 3 }];
    // Turn 1 finds its one source at rank 1; turn 2 names none; turn 3 names one and searched nothing.
    expect(retrievalOf(turns, [["#a/1.md"], undefined, ["#a/2.md"]])).toEqual({
      turns: [{ n: 1, gold: 1, found: 1, recall: 1, rr: 1, ranks: [1] }, { n: 3, gold: 1, found: 0, recall: 0, rr: 0, ranks: [0] }], recallAt5: 0.5, mrr: 0.5,
    });
    expect(retrievalOf(turns, [undefined, undefined, undefined])).toBeUndefined();
  });
});

describe("checks for briefs seeded with a corpus", () => {
  const empty: AssistantState = { tasks: [], memory: { channel: [], guild: [] }, files: [], reminders: [] };
  const bluetooth = { title: "Fix Bluetooth mic latency on Android", status: "in_progress", dueAt: "2026-10-16", assignedTo: "Bob", createdByName: "Alice", channel: "#mobile" };
  const other = { title: "Offline recording sync", status: "in_progress", dueAt: "2026-10-21", assignedTo: "Bayu", createdByName: "Alice", channel: "#mobile" };
  const fixture = (turn: AssistantFixture["facts"]["turns"][number], seed?: AssistantFixture["facts"]["seed"]): AssistantFixture => ({
    name: "x", messages: ["mundurin ke jumat"], facts: { language: "id", area: "tasks", clock: "2026-10-14T02:00:00Z", mustCover: ["m"], turns: [turn], ...(seed && { seed }) },
  });
  const run = (reply: string, tasks = [bluetooth, other]): AssistantOutput => ({ kind: "assistant", fixture: "x", posts: [], turns: [{ n: 1, message: "q", replies: [reply], confirm: false, pings: [], state: { ...empty, tasks } }] });
  const messages = (o: AssistantOutput, f: AssistantFixture) => checkAssistantOutput(o, f).map((x) => `${x.check}: ${x.message}`);

  test("tasksInclude finds each task among any others, without counting them", () => {
    const f = fixture({ tasksInclude: [{ title: "Bluetooth mic latency", dueAt: "2026-10-16", assignedTo: "Bob", channel: "#mobile" }] });
    expect(messages(run("Sudah, jatuh temponya Jumat 16 Oktober."), f)).toEqual([]);
    expect(messages(run("Sudah, jatuh temponya Jumat 16 Oktober.", [{ ...bluetooth, dueAt: "2026-10-07" }, other]), f)).toEqual(['tasks: Task "Fix Bluetooth mic latency on Android": dueAt is 2026-10-07, expected 2026-10-16.']);
    expect(messages(run("Sudah, jatuh temponya Jumat 16 Oktober.", [other]), f)).toEqual(['tasks: No task whose title contains "Bluetooth mic latency"; found: Offline recording sync.']);
  });

  test("a reply may link a seeded issue and commit as it may a pull request", () => {
    const f = fixture({}, { git: { repos: ["gema/*"], issues: [{ repo: "gema/app", number: 112, title: "Latency" }], commits: [{ repo: "gema/app", sha: "a".repeat(40), message: "Fix", date: "2026-10-01T00:00:00Z" }] } });
    expect(messages(run(`Ada issue https://github.com/gema/app/issues/112 dan commit https://github.com/gema/app/commit/${"a".repeat(40)}.`), f)).toEqual([]);
    expect(messages(run("Ada issue https://github.com/gema/app/issues/113."), f)).toEqual(["citations: The reply links https://github.com/gema/app/issues/113, which nothing seeded holds."]);
  });
});
