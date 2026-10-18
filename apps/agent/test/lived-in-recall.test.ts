import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

/**
 * The lived-in exam's retrieval benchmark (#252), with no model: the shared corpus (370 files of three and a half months, a git history)
 * is seeded as every session seeds it, and the `recall` tool runs once for every session turn whose facts give a `search`, with exactly
 * those arguments, through the real bot. Each result is scored against the turn's gold sources (`apps/agent/eval/retrieval.ts`):
 * recall@5, the share of gold sources among the first 5 of their part, and MRR, the mean reciprocal rank of the first one within 10.
 *
 * The pinned numbers are a regression floor, set to what the search scored when the benchmark was written: a change may raise them,
 * never lower them; raise the literals with it. The scenario prints every question with its scores, its gold sources' ranks, and what
 * each part showed first; the table shows in the failure output, or when the scenario runs alone the way `runInSubprocess` runs it.
 */
const RECALL_AT_5 = 0.9;
const MRR = 0.97;
const QUESTIONS = 32;

discordScenario("lived-in recall benchmark: recall@5 and MRR of every session question's recall call", async (s) => {
  const EVAL = process.cwd() + "/apps/agent/eval";
  const { LIVED_IN_DIR, loadAssistantFixtures } = await import(`${EVAL}/assistantFixtures.ts`);
  const { seedAssistantFixture } = await import(`${EVAL}/assistantRun.ts`);
  const { retrievedOf, scoreTurn } = await import(`${EVAL}/retrieval.ts`);
  const { resetGuardrailState } = await import(process.cwd() + "/packages/skills/src/guardrails.ts");
  const sessions: any[] = loadAssistantFixtures(LIVED_IN_DIR);
  // Every session starts from the same corpus and seeds nothing a search reads on top of it, so one seeding serves them all.
  const seeds = new Set(sessions.map((f) => JSON.stringify({ files: f.facts.seed.files, git: f.facts.seed.git })));
  expect(seeds.size).toBe(1);
  await seedAssistantFixture(s, sessions[0].facts);

  const questions = sessions.flatMap((f) => f.facts.turns.flatMap((t: any, i: number) => (t.search ? [{ id: `${f.name}/${i + 1}`, search: t.search, gold: t.gold }] : [])));
  // A person may make 30 tool calls a minute and each recall makes a few, so the calls go in steps of 6 with the counters cleared between.
  const calls = questions.map((q) => ({ tool: "recall", args: q.search }));
  const chunks = Array.from({ length: Math.ceil(calls.length / 6) }, (_, i) => calls.slice(i * 6, i * 6 + 6));
  let results: any[] = [];
  s.model.script(...chunks.map((chunk) => () => {
    resetGuardrailState();
    return chunk;
  }), (turn) => {
    results = turn.toolResults;
    return "Done.";
  }, "The benchmark ran."); // the turn's tool results move the history window, so the rolling summary asks the model once

  await s.discord.send(`${s.discord.mention} benchmark`);

  expect(results).toHaveLength(questions.length);
  const rows = questions.map((q, i) => {
    const shown = retrievedOf("recall", results[i], "general")!;
    // No Plane account is open here, so recall says Plane is unavailable; every other part must have been searched.
    const { plane: _, ...unavailable } = results[i]?.unavailable ?? {};
    return { ...q, shown, unavailable: Object.keys(unavailable).length ? unavailable : undefined, score: scoreTurn(i + 1, q.gold, [shown]) };
  });
  const recallAt5 = Math.round((rows.reduce((sum, r) => sum + r.score.recall, 0) / rows.length) * 100) / 100;
  const mrr = Math.round((rows.reduce((sum, r) => sum + r.score.rr, 0) / rows.length) * 100) / 100;
  console.log(rows.map((r) => [
    `${r.score.found === r.score.gold ? "ALL " : r.score.found ? "SOME" : "NONE"} ${r.id}: recall@5 ${r.score.recall.toFixed(2)}, rr ${r.score.rr.toFixed(2)}`,
    ...r.gold.map((g: string | string[], j: number) => `     gold rank ${r.score.ranks[j] || "-"}: ${[g].flat().join(" | ")}`),
    `     kept: ${r.shown.kept.slice(0, 5).join(", ") || "(none)"}`,
    `     tasks: ${r.shown.tasks.slice(0, 5).join(", ") || "(none)"}`,
    `     work: ${r.shown.work.slice(0, 5).join(", ") || "(none)"}`,
  ].join("\n")).join("\n"));
  console.log(`Recall@5: ${recallAt5.toFixed(2)}  MRR@10: ${mrr.toFixed(2)}  (${rows.length} questions, ${sessions[0].facts.seed.files.length} files)`);

  // Kept material, Tasks and git were searched: a part recall could not reach would score nothing for reasons that are not retrieval.
  expect(rows.filter((r) => r.unavailable).map((r) => `${r.id}: ${JSON.stringify(r.unavailable)}`)).toEqual([]);
  expect(rows.length).toBeGreaterThanOrEqual(QUESTIONS);
  expect(recallAt5).toBeGreaterThanOrEqual(RECALL_AT_5);
  expect(mrr).toBeGreaterThanOrEqual(MRR);
}, 120_000);

discordScenario("the lived-in corpus is kept in the formats the bot writes: Daily logs re-render the same, Minutes and Tasks parse", async (s) => {
  const EVAL = process.cwd() + "/apps/agent/eval";
  const { livedInCorpus, dailyLogText } = await import(`${EVAL}/lived-in/corpus.ts`);
  const { forgetDeletedMessage } = await import(process.cwd() + "/apps/agent/src/discord/dailyLog.ts");
  const { parseRecord } = await import(process.cwd() + "/apps/agent/src/discord/minutes.ts");
  const { parseTask } = await import(process.cwd() + "/packages/skills/src/builtin/taskFile.ts");
  const { parseFrontmatter } = await import(process.cwd() + "/packages/skills/src/playbooks.ts");
  const corpus = livedInCorpus(), folder = (f: { channel?: string }) => `guilds/guild-1/channels/${f.channel ?? "channel-1"}`;

  // The real writer drops a deleted message's link and renders the file again from its fields: a log that loses a link no item rests on
  // alone comes back the way this corpus renders the same fields without that link.
  const log = corpus.files.find((f: any) => f.path === "daily-logs/2026-10/2026-10-06.md" && f.channel === "audio-engine")!;
  const fields = parseFrontmatter(log.content)!.fields as any;
  const items: { links: string[] }[] = [...fields.log.topics, ...fields.log.decided, ...fields.log.open, ...fields.log.next];
  const gone = items.flatMap((i) => i.links).find((l) => items.every((i) => !i.links.includes(l) || i.links.length > 1))!;
  expect(gone).toBeDefined();
  await s.workspace.write(`${folder(log)}/${log.path}`, log.content);
  await forgetDeletedMessage({ tenantId: s.tenant.id, guildId: "guild-1", channelId: "audio-engine", messageChannelId: "audio-engine", messageId: gone.split("/").at(-1)!, createdAt: Date.parse("2026-10-06T05:00:00Z") });
  const rewritten = (await s.workspace.read(`${folder(log)}/${log.path}`))!;
  expect(rewritten).not.toContain(gone);
  const strip = (list: { links: string[] }[]) => list.map((i) => ({ ...i, links: i.links.filter((l) => l !== gone) }));
  expect(rewritten).toBe(dailyLogText({ ...fields, log: { ...fields.log, topics: strip(fields.log.topics), decided: strip(fields.log.decided), open: strip(fields.log.open), next: strip(fields.log.next) } }));

  const minutes = corpus.files.filter((f: any) => f.path.startsWith("minutes/"));
  expect(minutes.filter((f: any) => !parseRecord(f.content)).map((f: any) => f.path)).toEqual([]);
  const tasks = corpus.files.filter((f: any) => f.path.startsWith("tasks/"));
  expect(tasks.filter((f: any) => !parseTask(f.content)).map((f: any) => f.path)).toEqual([]);
});
