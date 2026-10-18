import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

/**
 * Retrieval benchmark (#208, v2 #222): hand-labelled questions asked from #general across four Public channels, scored on the files
 * `searchFiles` shows: top-1 hits, top-3 hits, and mean reciprocal rank of the first expected file among the first 10 shown (0 when
 * none is). A change may raise these numbers, never lower them; raise the pinned literals with it. The 26 questions of v1 must all
 * still hit in the top 3. The scenario prints every question with its rank, expected files and top 3; the table shows in the failure
 * output, or when the scenario runs alone the way `runInSubprocess` runs it (PACHIWARE_SCENARIO set to its name, with a scratch
 * DATABASE_URL and WORKSPACE_DIR).
 */
const TOP1 = 26;
const TOP3 = 42;
const MRR = 0.68;

discordScenario("retrieval benchmark: top-1, top-3 and MRR", async (s) => {
  const { BENCHMARK_CHANNELS, BENCHMARK_FILES, BENCHMARK_QUESTIONS, V1_QUESTION_COUNT, shownPaths } = await import(process.cwd() + "/apps/agent/test/support/recallBenchmark.ts");
  await s.guildSettings({ language: "en", useThreads: false });
  for (const c of BENCHMARK_CHANNELS) s.discord.channel(c.id).name = c.name;
  for (const f of BENCHMARK_FILES) await s.workspace.write(f.path, f.content);

  // One person may make 30 tool calls a minute, so the questions go in steps of 24 with the per-minute counters cleared between them.
  const { resetGuardrailState } = await import(process.cwd() + "/packages/skills/src/guardrails.ts");
  const calls = BENCHMARK_QUESTIONS.map((q: any) => ({ tool: "searchFiles", args: { queries: q.queries } }));
  const chunks = Array.from({ length: Math.ceil(calls.length / 24) }, (_, i) => calls.slice(i * 24, i * 24 + 24));
  let shown: string[][] = [];
  s.model.script(chunks[0]!, ...chunks.slice(1).map((chunk) => () => {
    resetGuardrailState();
    return chunk;
  }), (turn) => {
    shown = turn.toolResults.map((r) => shownPaths(r).slice(0, 10)); // every tool result of the turn, in order
    return "Done.";
  }, "The benchmark ran."); // the turn's tool results move the history window, so the rolling summary asks the model once

  await s.discord.send(`${s.discord.mention} benchmark`);

  const rows = BENCHMARK_QUESTIONS.map((q: any, i: number) => {
    const rank = shown[i]!.findIndex((p) => q.expected.includes(p)) + 1;
    return { id: q.id, group: q.group ?? "v1", rank, expected: q.expected, top3: shown[i]!.slice(0, 3) };
  });
  const inTop3 = (r: { rank: number }) => r.rank >= 1 && r.rank <= 3;
  const top1 = rows.filter((r: any) => r.rank === 1).length;
  const top3 = rows.filter(inTop3).length;
  const mrr = Math.round((rows.reduce((sum: number, r: any) => sum + (r.rank ? 1 / r.rank : 0), 0) / rows.length) * 100) / 100;
  console.log(rows.map((r: any) => `${inTop3(r) ? "HIT " : "MISS"} ${r.group}/${r.id} (rank ${r.rank || "-"})\n     expected: ${r.expected.join(", ")}\n     top 3:    ${r.top3.join(", ") || "(none)"}`).join("\n"));
  console.log(`Top-1: ${top1}/${rows.length}  Top-3: ${top3}/${rows.length}  MRR@10: ${mrr.toFixed(2)}  (${BENCHMARK_FILES.length} files)`);

  expect(BENCHMARK_QUESTIONS.length).toBeGreaterThanOrEqual(46);
  expect(rows.slice(0, V1_QUESTION_COUNT).filter((r: any) => !inTop3(r)).map((r: any) => r.id)).toEqual([]);
  expect(top1).toBeGreaterThanOrEqual(TOP1);
  expect(top3).toBeGreaterThanOrEqual(TOP3);
  expect(mrr).toBeGreaterThanOrEqual(MRR);
}, 60000);
