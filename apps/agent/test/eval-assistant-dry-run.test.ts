/**
 * One scripted dry run per daily-behaviour brief: the model script makes the tool calls the persona asks for, the
 * run goes through the real bot against the fake clock, and the output passes every code check. With EVAL_RECORD=1
 * each run is written to apps/agent/eval/recorded/assistant/, where eval-assistant-checks.test.ts re-checks it.
 */
import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const EVAL = () => process.cwd() + "/apps/agent/eval";
const contextLines = (turn: { messages: { role: string; content: unknown }[] }, pattern: RegExp) => String(turn.messages.findLast((m) => m.role === "user")?.content).match(pattern) ?? [];

async function dryRun(s: Scenario, name: string) {
  const { runAssistantFixture, gradeAssistantRun } = await import(`${EVAL()}/assistantRun.ts`);
  const { loadAssistantFixtures } = await import(`${EVAL()}/assistantFixtures.ts`);
  const fixture = loadAssistantFixtures().find((f: any) => f.name === name)!;
  const output = await runAssistantFixture(s, fixture);
  if (process.env.EVAL_RECORD === "1") {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(`${EVAL()}/recorded/assistant`, { recursive: true });
    writeFileSync(`${EVAL()}/recorded/assistant/${name}.json`, `${JSON.stringify({ profile: { provider: "scripted", model: "dry run" }, ...output }, null, 2)}\n`);
  }
  const graded = gradeAssistantRun(output, fixture);
  expect(graded.failures).toEqual([]);
  expect(graded.passed).toBe(true);
  return output;
}

discordScenario("dry run: task-casual-indonesian files one task due Friday and lists it in the fixed format", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Kirim invoice ke Pak Budi", dueAt: "2026-10-16" } },
    "Dicatat: kirim invoice ke Pak Budi, jatuh tempo Jumat 16 Oktober 2026.",
    (turn) => `Jatuh tempo minggu ini:\n${contextLines(turn, /^pending \| .*$/gm).join("\n")}`,
  );
  const output = await dryRun(s, "task-casual-indonesian");
  expect(output.turns[0].state.tasks).toEqual([{ title: "Kirim invoice ke Pak Budi", status: "pending", dueAt: "2026-10-16", assignedTo: null, createdByName: "Alice" }]);
  expect(output.turns[1].replies[0]).toMatch(/^Jatuh tempo minggu ini:\npending \| due 2026-10-16 \| unassigned \| [0-9a-f]{8} \| Kirim invoice ke Pak Budi$/);
});

discordScenario("dry run: task-casual-english files Bob's task due tomorrow, then asks on \"the other one\"", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Book the venue", assignedTo: "Bob", dueAt: "2026-10-15" } },
    "Added: Book the venue, Bob, due Thursday 15 October.",
    "Which task do you mean? The only one here is Book the venue, and it is already Bob's.",
  );
  const output = await dryRun(s, "task-casual-english");
  expect(output.turns[1].state).toEqual(output.turns[0].state);
  expect(output.turns.map((t: any) => t.confirm)).toEqual([false, false]);
});

discordScenario("dry run: due-dates-relative reads Friday, in two hours and tomorrow against the fixed clock", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Send the deck to the client", dueAt: "2026-10-16" } }, "Added: Send the deck to the client, due Friday 16 October.",
    { tool: "createTask", args: { title: "Call the venue", dueAt: "2026-10-14T11:00" } }, "Added: Call the venue, due today at 11:00.",
    { tool: "createTask", args: { title: "Renew the domain", dueAt: "2026-10-15" } }, "Added: Renew the domain, due tomorrow, Thursday 15 October.",
  );
  const output = await dryRun(s, "due-dates-relative");
  expect(output.turns[2].state.tasks.map((t: any) => t.dueAt)).toEqual(["2026-10-14T11:00:00+07:00", "2026-10-15", "2026-10-16"]);
});

discordScenario("dry run: status-by-title changes two seeded tasks without Confirm and lists what is open", async (s) => {
  s.model.script(
    { tool: "updateTaskStatus", args: { taskId: "00000001-0000-4000-8000-000000000000", status: "completed" } }, "Book the venue is completed.",
    { tool: "updateTaskStatus", args: { taskId: "00000002-0000-4000-8000-000000000000", status: "in_progress" } }, "Send the invoice is in progress.",
    (turn) => `Still open:\n${contextLines(turn, /^in_progress \| .*$/gm).join("\n")}`,
  );
  const output = await dryRun(s, "status-by-title");
  expect(output.turns[2].replies).toEqual(["Still open:\nin_progress | due 2026-10-16 | Alice | 00000002 | Send the invoice"]);
});

discordScenario("dry run: remember-forget keeps a channel line, a server line with Manage Server, and forgets the first", async (s) => {
  s.model.script(
    { tool: "remember", args: { level: "channel", text: "Bob prefers to be pinged in the morning" } }, "Kept.",
    { tool: "remember", args: { level: "guild", text: "Releases go out on Thursdays" } }, "Kept for the whole server.",
    { tool: "forget", args: { level: "channel", match: "Bob" } }, (turn) => `Removed ${turn.toolResults[0].removed} line about Bob.`,
  );
  const output = await dryRun(s, "remember-forget");
  expect(output.turns[2].state.memory).toEqual({ channel: [], guild: ["- 2026-10-14 (Alice): Releases go out on Thursdays"] });
});

discordScenario("dry run: file-search files the PDF with its text and finds the budget line", async (s) => {
  s.model.script(
    "Filed as q3-report.pdf under files/, with its text beside it.",
    { tool: "searchFiles", args: { query: "budget", path: "channel/files" } }, (turn) => `q3-report.md: ${turn.toolResults[0].matches[0].lines[0].text}`,
  );
  const output = await dryRun(s, "file-search");
  expect(output.turns[1].replies).toEqual(["q3-report.md: The Q3 budget is 12 million."]);
});

discordScenario("dry run: reminder-weekly sets Monday and Thursday 09:00 and the tick posts the first one with a ping", async (s) => {
  s.model.script(
    { tool: "createReminder", args: { text: "post the standup", recurrence: "weekly", weekdays: ["monday", "thursday"], time: "09:00" } },
    "Set: every Monday and Thursday at 09:00, first on Thursday 15 October at 09:00.",
  );
  const output = await dryRun(s, "reminder-weekly");
  expect(output.posts).toEqual([{ text: `<@${s.discord.alice.id}> Reminder: post the standup`, pings: [s.discord.alice.id] }]);
});

discordScenario("dry run: assign-ambiguous-name asks which Dewi, files nothing, then files the task for the one named", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Send the brand guide to the printer", assignedTo: "Dewi", dueAt: "2026-10-16" } },
    (turn) => (turn.toolResults[0].ambiguous ? "Which Dewi do you mean: Dewi (dewi.lestari) or Dewi Anggraini (dewi)?" : `not ambiguous: ${JSON.stringify(turn.toolResults[0])}`),
    { tool: "createTask", args: { title: "Send the brand guide to the printer", assignedTo: "Dewi Anggraini", dueAt: "2026-10-16" } },
    "Added: Send the brand guide to the printer, Dewi Anggraini, due Friday 16 October.",
  );
  const output = await dryRun(s, "assign-ambiguous-name");
  expect(output.turns[0].replies).toEqual(["Which Dewi do you mean: Dewi (dewi.lestari) or Dewi Anggraini (dewi)?"]);
  expect(output.turns[0].state.tasks).toEqual([]);
});

discordScenario("dry run: assign-unknown-name records Pak Hendra by name only and says so", async (s) => {
  s.model.script(
    { tool: "assignTask", args: { taskId: "00000001", assignedTo: "Pak Hendra" } },
    (turn) => (/recorded by name only/.test(turn.toolResults[0].message) ? "Get the catering quote is now Pak Hendra's. He is recorded by name only: no member here matches, so I cannot reach him." : `no name-only note: ${turn.toolResults[0].message}`),
  );
  const output = await dryRun(s, "assign-unknown-name");
  expect(output.turns[0].replies[0]).toContain("name only");
});

discordScenario("dry run: progress-note keeps Alice's report as a Progress note and shows it when asked", async (s) => {
  s.model.script(
    { tool: "addProgressNote", args: { taskId: "00000001", text: "Half done, waiting on screenshots from design" } },
    "Noted on Draft the launch post: half done, waiting on screenshots from design.",
    { tool: "showTask", args: { taskId: "00000001" } },
    (turn) => `${turn.toolResults[0].task}\n${turn.toolResults[0].notes.join("\n")}`,
  );
  const output = await dryRun(s, "progress-note");
  expect(output.turns[0].state.tasks[0].notes).toEqual(["- 2026-10-14 Alice: Half done, waiting on screenshots from design"]);
  expect(output.turns[1].replies).toEqual(["pending | due 2026-10-16 | Alice | 00000001 | Draft the launch post\n- 2026-10-14 Alice: Half done, waiting on screenshots from design"]);
});

discordScenario("dry run: cancel-with-reason cancels the venue with its reason as a note, and the open list leaves it out", async (s) => {
  s.model.script(
    { tool: "updateTaskStatus", args: { taskId: "00000001", status: "cancelled", reason: "acaranya jadi online" } },
    "Dibatalkan: Booking venue untuk gathering. Alasannya dicatat: acaranya jadi online.",
    (turn) => `Yang masih jalan:\n${contextLines(turn, /^pending \| .*$/gm).join("\n")}`,
  );
  const output = await dryRun(s, "cancel-with-reason");
  expect(output.turns[0].state.tasks.find((t: any) => t.status === "cancelled").notes).toEqual(["- 2026-10-14 Alice: Cancelled: acaranya jadi online"]);
  expect(output.turns[1].replies).toEqual(["Yang masih jalan:\npending | due 2026-10-19 | unassigned | 00000002 | Pesan katering"]);
});

discordScenario("dry run: bulk-cancel is refused whole, listed for a yes, then the yes cancels all four of Bob's tasks", async (s) => {
  const cancels = [1, 2, 3, 4].map((n) => ({ tool: "updateTaskStatus", args: { taskId: `0000000${n}`, status: "cancelled" } }));
  s.model.script(
    cancels,
    (turn) => `${turn.toolResults.every((r: any) => r.error?.startsWith("confirmation_required:")) ? "" : "RAN "}These four tasks of Bob's would be cancelled:\n${contextLines(turn, /^.*\| Bob \| .*$/gm).join("\n")}\nCancel all four?`,
    cancels,
    (turn) => `Cancelled ${turn.toolResults.filter((r: any) => r.message).length} of Bob's tasks: sponsor email, photographer, badges, banners.`,
  );
  const output = await dryRun(s, "bulk-cancel");
  expect(output.turns[0].replies[0]).toStartWith("These four tasks of Bob's would be cancelled:\n");
  expect(output.turns[0].replies[0].split("\n")).toHaveLength(6);
  expect(output.turns[1].replies).toEqual(["Cancelled 4 of Bob's tasks: sponsor email, photographer, badges, banners."]);
});

discordScenario("dry run: task-reference-ambiguous lists both invoice tasks and asks once, then completes the Acme one", async (s) => {
  s.model.script(
    (turn) => `Two tasks are about an invoice:\n${contextLines(turn, /^.*\| Send the invoice to .*$/gm).join("\n")}\nWhich one is done?`,
    { tool: "updateTaskStatus", args: { taskId: "00000001", status: "completed" } },
    "Send the invoice to Acme is completed.",
  );
  const output = await dryRun(s, "task-reference-ambiguous");
  expect(output.turns[0].replies).toEqual(["Two tasks are about an invoice:\npending | due 2026-10-16 | unassigned | 00000001 | Send the invoice to Acme\npending | due 2026-10-20 | unassigned | 00000002 | Send the invoice to Globex\nWhich one is done?"]);
});

discordScenario("dry run: plate-across-channels lists Alice's tasks in this channel and #launch, then what she handed to Bob", async (s) => {
  const grouped = (r: any) => r.groups.map((g: any) => `${g.group}\n${g.tasks.map((t: any) => t.line).join("\n")}`).join("\n\n");
  s.model.script(
    { tool: "listTasks", args: { scope: "mine" } }, (turn) => grouped(turn.toolResults[0]),
    { tool: "listTasks", args: { scope: "delegated" } }, (turn) => grouped(turn.toolResults[0]),
  );
  const output = await dryRun(s, "plate-across-channels");
  expect(output.turns[0].replies).toEqual(["#channel-1\npending | due 2026-10-15 | Alice | 00000001 | Review the pricing page\n\n#launch\npending | due 2026-10-16 | Alice | 00000002 | Write the release notes"]);
  expect(output.turns[1].replies).toEqual(["#launch\npending | due 2026-10-15 | Bob | 00000003 | Record the demo video"]);
});

discordScenario("dry run: decision-other-channel finds the pricing Decision kept in #marketing and names its channel and date", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { query: "pricing tiers" } },
    (turn) => {
      const { groups } = turn.toolResults[0], [match] = groups[0].matches;
      return `${groups[0].channel}, Decision of ${match.path.split("/").pop().slice(0, 10)}: ${match.lines.map((l: any) => l.text).find((t: string) => t.startsWith("Settled"))}`;
    },
  );
  const output = await dryRun(s, "decision-other-channel");
  expect(output.turns[0].replies).toEqual(["#marketing, Decision of 2026-10-08: Settled: three pricing tiers, Starter at 9 dollars, Team at 29 and Business at 79 a month."]);
});

discordScenario("dry run: action-items-across-meetings lists Bob's items from Minutes in two channels, each with channel, date and link", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { query: "Bob" } },
    (turn) => turn.toolResults[0].groups.flatMap((g: any) => g.matches.map((m: any) => ({ tool: "readFile", args: { path: m.path } }))),
    (turn) => {
      const [search, ...reads] = turn.toolResults;
      const matches = search.groups.flatMap((g: any) => g.matches.map((m: any) => ({ channel: g.channel, path: m.path })));
      return ["Bob's action items:", ...matches.map((m: any, i: number) => {
        const text: string = reads[i].content, field = (key: string) => JSON.parse(text.match(new RegExp(`^${key}: (.*)$`, "m"))![1]!);
        const items = text.split("\n").filter((l) => l.includes("**Bob**:")).map((l) => l.replace(/^\d+\. \*\*Bob\*\*: /, "").replace(/ \[↗\].*$/, ""));
        return `- ${m.channel}, ${m.path.split("/").pop().slice(0, 10)}: ${items.join("; ")} (https://discord.com/channels/${field("guildId")}/${field("postedIn")}/${field("messageId")})`;
      })].join("\n");
    },
  );
  const output = await dryRun(s, "action-items-across-meetings");
  expect(output.turns[0].replies).toEqual([[
    "Bob's action items:",
    "- #channel-1, 2026-10-12: Update the onboarding checklist (due 16 October) (https://discord.com/channels/guild-1/channel-1/4200)",
    "- #launch, 2026-10-07: Send the press kit to the agency (due Friday) (https://discord.com/channels/guild-1/launch/4100)",
  ].join("\n")]);
});

discordScenario("dry run: nothing-found searches twice, finds nothing anywhere, and says so", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { query: "office move" } },
    { tool: "searchFiles", args: { query: "office" } },
    (turn) => (turn.toolResults.every((r: any) => r.total === 0 && !r.notShownHere) ? "I found nothing kept about the office move: no Minutes, Decision, Note or Document mentions it." : `found: ${JSON.stringify(turn.toolResults)}`),
  );
  const output = await dryRun(s, "nothing-found");
  expect(output.turns[0].replies).toEqual(["I found nothing kept about the office move: no Minutes, Decision, Note or Document mentions it."]);
});

discordScenario("dry run: private-channel-dm counts the hidden channel's Minutes, shows nothing of them, and suggests a DM", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { query: "bonus budget" } },
    (turn) => {
      const result = turn.toolResults[0];
      return result.notShownHere && !result.groups.length ? "Something you can read may answer that, but I cannot show it in this channel. Ask me in a DM and I will look there." : `shown here: ${JSON.stringify(result)}`;
    },
  );
  const output = await dryRun(s, "private-channel-dm");
  expect(output.turns[0].replies).toEqual(["Something you can read may answer that, but I cannot show it in this channel. Ask me in a DM and I will look there."]);
});

discordScenario("dry run: minutes-as-document finds the vendor call's minutes kept as a Document under files/", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { query: "brochures deliver" } },
    (turn) => {
      const { groups } = turn.toolResults[0], [match] = groups[0].matches;
      return `${groups[0].channel}, ${match.path.split("/").pop()} (the Sinar Printing call of 6 October 2026): ${match.lines[0].text.replace(/^- /, "")}`;
    },
  );
  const output = await dryRun(s, "minutes-as-document");
  expect(output.turns[0].replies).toEqual(["#channel-1, sinar-printing-call-minutes.md (the Sinar Printing call of 6 October 2026): Sinar Printing delivers the 2,000 brochures on 23 October, to the Jakarta office."]);
});

/** One line per match of a search result: its channel, the date its file name starts with, and its first matching line. */
const matchLines = (result: any) => result.groups.flatMap((g: any) => g.matches.map((m: any) => `${g.channel}, ${m.path.split("/").pop().slice(0, 10)}: ${m.lines[0].text.replace(/^\d+\. /, "").replace(/ \[↗\].*$/, "")}`));

discordScenario("dry run: recall-asked-in-indonesian finds the English Minutes and the #audio Note in one search with Indonesian and English variants", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { queries: ["normalisasi audio", "audio normalization"] } },
    (turn) => {
      const [found] = turn.toolResults;
      const where = (folder: string) => {
        const g = found.groups.find((x: any) => x.matches.some((m: any) => m.path.includes(`/${folder}/`)));
        return `${g.channel}, ${g.matches[0].path.split("/").pop().slice(0, 10)}`;
      };
      return `Pernah. Diputuskan di notulen Podcast sync (${where("minutes")}): setiap episode dinormalisasi ke -16 LUFS sebelum diunggah. Catatan di ${where("notes")} bilang preset normalisasi audio sudah ada di template ekspor dan episode 41 dan 42 sudah diekspor ulang.`;
    },
  );
  const output = await dryRun(s, "recall-asked-in-indonesian");
  expect(output.turns[0].replies).toEqual(["Pernah. Diputuskan di notulen Podcast sync (#channel-1, 2026-10-06): setiap episode dinormalisasi ke -16 LUFS sebelum diunggah. Catatan di #audio, 2026-10-09 bilang preset normalisasi audio sudah ada di template ekspor dan episode 41 dan 42 sudah diekspor ulang."]);
});

discordScenario("dry run: recall-asked-in-english finds the Indonesian Decision and the #finance Minutes in one search with English and Indonesian variants", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { queries: ["invoice reminders", "pengingat tagihan"] } },
    (turn) => ["Yes, it was settled that reminders go out automatically three days before the due date. Kept so far:", ...matchLines(turn.toolResults[0]).map((l: string) => `- ${l}`)].join("\n"),
  );
  const output = await dryRun(s, "recall-asked-in-english");
  expect(output.turns[0].replies).toEqual([[
    "Yes, it was settled that reminders go out automatically three days before the due date. Kept so far:",
    "- #finance, 2026-10-12: Pengingat tagihan otomatis sudah jalan untuk klien Jakarta",
    "- #channel-1, 2026-10-05: # Pengingat tagihan otomatis",
  ].join("\n")]);
});

discordScenario("dry run: recall-decision-replaced finds both support-hours Decisions and gives the newer one, naming the older as replaced", async (s) => {
  s.model.script(
    { tool: "searchFiles", args: { query: "support hours" } },
    (turn) => {
      const found = turn.toolResults[0].groups.flatMap((g: any) => g.matches.map((m: any) => ({ channel: g.channel, date: m.path.split("/").pop().slice(0, 10) })));
      const [older, newer] = found.sort((a: any, b: any) => a.date.localeCompare(b.date));
      return `Support runs 08:00 to 20:00 on weekdays, decided in ${newer.channel} on ${newer.date}. It replaced the 09:00 to 17:00 hours decided in ${older.channel} on ${older.date}.`;
    },
  );
  const output = await dryRun(s, "recall-decision-replaced");
  expect(output.turns[0].replies).toEqual(["Support runs 08:00 to 20:00 on weekdays, decided in #support on 2026-10-09. It replaced the 09:00 to 17:00 hours decided in #channel-1 on 2026-09-21."]);
});

discordScenario("dry run: recall-done-other-channel finds the Minutes here and the completed Task in #audio, searched in one turn", async (s) => {
  s.model.script(
    [{ tool: "searchFiles", args: { queries: ["audio normalization", "normalisasi audio"] } }, { tool: "listTasks", args: { scope: "anywhere", queries: ["audio normalization", "normalize audio", "normalisasi audio"] } }],
    (turn) => {
      const [files, tasks] = turn.toolResults;
      const minutes = files.groups[0], task = tasks.groups[0];
      return [
        `Discussed: ${minutes.channel}, ${minutes.matches[0].path.split("/").pop().slice(0, 10)}, Podcast sync Minutes; decided every episode is normalized to -16 LUFS.`,
        `Done or not: ${task.group}: ${task.tasks[0].line}`,
      ].join("\n");
    },
  );
  const output = await dryRun(s, "recall-done-other-channel");
  expect(output.turns[0].replies).toEqual([[
    "Discussed: #channel-1, 2026-10-06, Podcast sync Minutes; decided every episode is normalized to -16 LUFS.",
    "Done or not: #audio: completed | no due date | Dewi | 00000001 | Normalize podcast audio to -16 LUFS",
  ].join("\n")]);
});

discordScenario("dry run: a judge over HTTP grades a daily-behaviour trial, and the report reads per turn", async (s) => {
  const { runAssistantTrial } = await import(`${EVAL()}/assistantRun.ts`);
  const { loadAssistantFixtures } = await import(`${EVAL()}/assistantFixtures.ts`);
  const { ASSISTANT_RUBRIC_VERSION } = await import(`${EVAL()}/assistantJudge.ts`);
  const { judgeOverHttp } = await import(`${EVAL()}/judge.ts`);
  const { writeReport } = await import(`${EVAL()}/report.ts`);
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const fixture = loadAssistantFixtures().find((f: any) => f.name === "task-casual-english")!;
  s.model.script(
    { tool: "createTask", args: { title: "Book the venue", assignedTo: "Bob", dueAt: "2026-10-15" } },
    "Added: Book the venue, Bob, due Thursday 15 October.",
    "Which task do you mean? The only one here is Book the venue, and it is already Bob's.",
  );
  const judged: any[] = [];
  s.http.on("POST judge.example.test/v1/chat/completions", (req) => {
    judged.push(req.body);
    const user: string = req.body.messages[1].content;
    const no = /after turn 2/.test(user) && /Is every statement/.test(user);
    return { choices: [{ message: { content: no ? 'It names a task that is not there.\n{"reasoning": "It names a task that is not there.", "verdict": "no"}' : 'Settled by the state.\n{"reasoning": "Settled by the state.", "verdict": "yes"}' } }] };
  });
  const trial = await runAssistantTrial(s, fixture, judgeOverHttp({ provider: "custom", model: "judge-model", baseUrl: "https://judge.example.test/v1", apiKey: "jk" }));
  expect(judged).toHaveLength(fixture.facts.mustCover.length + 2 * fixture.messages.length);
  expect(judged.every((b) => b.system === undefined && b.messages[0].content.includes(`Rubric ${ASSISTANT_RUBRIC_VERSION}`))).toBe(true);
  expect(trial.result.failures).toEqual([]);
  expect(trial.result).toMatchObject({ coverage: 1, questionRate: 1, passed: false, verdicts: [{ n: 1, label: "turn 1", passed: true, reasons: [] }, { n: 2, label: "turn 2", passed: false, reasons: ["unsupported: It names a task that is not there."] }] });
  expect(trial.usage).toMatchObject({ calls: 0, prompt: 0 });

  const dir = mkdtempSync(join(tmpdir(), "eval-assistant-report-"));
  writeReport(dir, { kind: "assistant", judge: { provider: "custom", model: "judge-model" }, rubricVersion: ASSISTANT_RUBRIC_VERSION, trials: 1, startedAt: "2026-10-14T00:00:00.000Z", profiles: [{ name: "a", provider: "openai", model: "m-a" }] }, [{ profile: "a", trial: 1, ...trial }]);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  expect(md).toContain("# Daily-behaviour eval, 2026-10-14T00:00:00.000Z");
  expect(md).toContain(`Judge: custom / judge-model. Rubric ${ASSISTANT_RUBRIC_VERSION}. 1 trial per brief.\n`);
  expect(md).toContain("| task-casual-english | 0.50 |");
  expect(md).toContain("- Trial 1, turn 2: fail. unsupported: It names a task that is not there.");
});
