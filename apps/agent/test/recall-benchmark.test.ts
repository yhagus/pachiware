import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

/**
 * Retrieval benchmark (#208): how many hand-labelled questions find an expected file among the first three files `searchFiles`
 * shows, asked from #general across four Public channels. A change may raise this number, never lower it; raise BASELINE with it.
 * The scenario prints every question with its expected files and top 3; the table shows in the failure output, or when the scenario
 * runs alone the way `runInSubprocess` runs it (PACHIWARE_SCENARIO set to its name, with a scratch DATABASE_URL and WORKSPACE_DIR).
 */
const BASELINE = 22;

discordScenario("retrieval benchmark: expected files in the top 3", async (s) => {
  const { BENCHMARK_CHANNELS, BENCHMARK_FILES, BENCHMARK_QUESTIONS, shownPaths } = await import(process.cwd() + "/apps/agent/test/support/recallBenchmark.ts");
  await s.guildSettings({ language: "en", useThreads: false });
  for (const c of BENCHMARK_CHANNELS) s.discord.channel(c.id).name = c.name;
  for (const f of BENCHMARK_FILES) await s.workspace.write(f.path, f.content);

  let tops: string[][] = [];
  s.model.script(BENCHMARK_QUESTIONS.map((q: any) => ({ tool: "searchFiles", args: { queries: q.queries } })), (turn) => {
    tops = turn.toolResults.map((r) => shownPaths(r).slice(0, 3));
    return "Done.";
  });
  await s.discord.send(`${s.discord.mention} benchmark`);

  const rows = BENCHMARK_QUESTIONS.map((q: any, i: number) => ({ id: q.id, hit: tops[i]!.some((p) => q.expected.includes(p)), expected: q.expected, top3: tops[i] }));
  const hits = rows.filter((r: any) => r.hit).length;
  console.log(rows.map((r: any) => `${r.hit ? "HIT " : "MISS"} ${r.id}\n     expected: ${r.expected.join(", ")}\n     top 3:    ${r.top3.join(", ") || "(none)"}`).join("\n"));
  console.log(`Top-3 hit rate: ${hits}/${rows.length} (${BENCHMARK_FILES.length} files)`);
  expect(BENCHMARK_FILES.length).toBeGreaterThanOrEqual(60);
  expect(hits).toBeGreaterThanOrEqual(BASELINE);
}, 60000);
