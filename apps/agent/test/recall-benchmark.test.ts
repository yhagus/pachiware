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
const TOP1 = 41;
const TOP3 = 48;
const MRR = 0.93;

discordScenario("retrieval benchmark: top-1, top-3 and MRR", async (s) => {
  const { BENCHMARK_FILES, BENCHMARK_QUESTIONS, V1_QUESTION_COUNT, askAll, inTop3, rowOf, scored, shownPaths } = await import(process.cwd() + "/apps/agent/test/support/recallBenchmark.ts");
  const results = await askAll(s, BENCHMARK_FILES, "searchFiles", BENCHMARK_QUESTIONS, 24);
  const rows = BENCHMARK_QUESTIONS.map((q: any, i: number) => rowOf(q, shownPaths(results[i]).slice(0, 10), (p: string) => q.expected.includes(p)));
  const { top1, top3, mrr } = scored(rows, "Files", `${BENCHMARK_FILES.length} files`);

  expect(BENCHMARK_QUESTIONS.length).toBeGreaterThanOrEqual(46);
  expect(rows.slice(0, V1_QUESTION_COUNT).filter((r: any) => !inTop3(r)).map((r: any) => r.id)).toEqual([]);
  expect(top1).toBeGreaterThanOrEqual(TOP1);
  expect(top3).toBeGreaterThanOrEqual(TOP3);
  expect(mrr).toBeGreaterThanOrEqual(MRR);
}, 60000);

/**
 * The Task part (#258): hand-labelled questions about Tasks of four Public channels, asked through `recall` from #general, scored on the
 * Tasks it shows: top-1, top-3 and MRR of the first expected Task among the first 10. Half the questions name a Task in other words, so
 * no wording is held whole. Every `named` question must hit first. The same rules hold: raise the pinned literals, never lower them.
 */
// Before #258 every other-words question missed: 6/11, 6/11, 0.55.
const TASK_TOP1 = 10;
const TASK_TOP3 = 11;
const TASK_MRR = 0.95;

discordScenario("task retrieval benchmark: a Task named in other words is still found by recall", async (s) => {
  const { BENCHMARK_TASKS, TASK_QUESTIONS, askAll, rowOf, scored } = await import(process.cwd() + "/apps/agent/test/support/recallBenchmark.ts");
  // Each recall makes a few tool calls, so fewer questions go in each step.
  const results = await askAll(s, BENCHMARK_TASKS, "recall", TASK_QUESTIONS, 6);
  expect(results).toHaveLength(TASK_QUESTIONS.length);
  const rows = TASK_QUESTIONS.map((q: any, i: number) => {
    const shown: string[] = (results[i]?.tasks ?? []).slice(0, 10).map((t: any) => `${/"(.*)"/.exec(t.label)?.[1] ?? t.label}${t.partial ? " (partial)" : ""}`);
    return rowOf(q, shown, (title: string) => q.expected.some((e: string) => title.startsWith(e)));
  });
  const { top1, top3, mrr } = scored(rows, "Tasks", `${BENCHMARK_TASKS.length} tasks`);

  expect(rows.filter((r: any) => r.group === "named" && r.rank !== 1).map((r: any) => r.id)).toEqual([]);
  expect(top1).toBeGreaterThanOrEqual(TASK_TOP1);
  expect(top3).toBeGreaterThanOrEqual(TASK_TOP3);
  expect(mrr).toBeGreaterThanOrEqual(TASK_MRR);
}, 60000);
