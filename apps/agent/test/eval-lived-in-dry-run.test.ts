/**
 * Scripted dry runs of lived-in sessions (#252), as in eval-assistant-dry-run.test.ts: the shared corpus is seeded, the script makes the
 * recall calls a good answer needs and answers from what they return, the run goes through the real bot against the fake clock, and the
 * output passes every code check. With EVAL_RECORD=1 each run is written to apps/agent/eval/recorded/lived-in/, where
 * eval-assistant-checks.test.ts re-checks it.
 */
import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const EVAL = () => process.cwd() + "/apps/agent/eval";
type Item = { ref: string; label: string; path?: string; url?: string };

async function dryRun(s: Scenario, name: string) {
  const { runAssistantFixture, gradeAssistantRun } = await import(`${EVAL()}/assistantRun.ts`);
  const { LIVED_IN_DIR, loadAssistantFixtures } = await import(`${EVAL()}/assistantFixtures.ts`);
  const fixture = loadAssistantFixtures(LIVED_IN_DIR).find((f: any) => f.name === name)!;
  const output = await runAssistantFixture(s, fixture);
  if (process.env.EVAL_RECORD === "1") {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(`${EVAL()}/recorded/lived-in`, { recursive: true });
    writeFileSync(`${EVAL()}/recorded/lived-in/${name}.json`, `${JSON.stringify({ profile: { provider: "scripted", model: "dry run" }, ...output }, null, 2)}\n`);
  }
  const graded = gradeAssistantRun(output, fixture);
  expect(graded.failures).toEqual([]);
  expect(graded.passed).toBe(true);
  return graded;
}

/** The recall item of `part` whose path, label or url holds `phrase`. */
const find = (result: any, part: "kept" | "tasks" | "work", phrase: string): Item => {
  const found = (result[part] as Item[]).find((i) => [i.path, i.label, i.url].some((v) => v?.includes(phrase)));
  if (!found) throw new Error(`recall shows no ${part} item with "${phrase}": ${JSON.stringify(result[part].map((i: Item) => i.path ?? i.label))}`);
  return found;
};

discordScenario("dry run: loudness-dibahas-selesai finds the #audio-engine Minutes, the completed Task and the merged pull request, then the app's open ones", async (s) => {
  s.model.script(
    { tool: "recall", args: { queries: ["loudness normalization", "normalisasi loudness", "normalisasi volume audio"] } },
    (turn) => {
      const r = turn.toolResults[0], minutes = find(r, "kept", "minutes/2026-08-12"), task = find(r, "tasks", "Implement loudness normalization"), pr = find(r, "work", "/pull/88");
      return `Iya, pernah dibahas dan diputuskan: semua hasil ekspor dinormalisasi ke -16 LUFS dengan true peak -1 dBTP [${minutes.ref}]. Di audio-core sudah beres, tugasnya sudah selesai [${task.ref}] dan PR #88 sudah di-merge [${pr.ref}].`;
    },
    { tool: "recall", args: { queries: ["loudness normalization toggle", "toggle normalisasi di app", "loudness export settings"] } },
    (turn) => {
      const r = turn.toolResults[0], task = find(r, "tasks", "Turn on loudness normalization"), pr = find(r, "work", "/pull/140");
      return `Di app belum bisa dipakai: tugasnya masih dikerjakan Bayu [${task.ref}], dan PR #140 untuk toggle-nya masih terbuka [${pr.ref}].`;
    },
  );
  const graded = await dryRun(s, "loudness-dibahas-selesai");
  expect(graded.turns[0].replies[0]).toContain("(<https://github.com/gema/audio-core/pull/88>)");
  // Both turns' searches showed every gold source within the first five of its part.
  expect(graded.retrieval).toMatchObject({ recallAt5: 1, turns: [{ n: 1, gold: 3, found: 3 }, { n: 2, gold: 2, found: 2 }] });
});

discordScenario("dry run: supabase-tidak-pernah-diputuskan finds no such Decision, only the Daily log that named the idea, then the Decision to stay on Firebase", async (s) => {
  s.model.script(
    { tool: "recall", args: { queries: ["pindah ke Supabase", "Supabase migration", "Firebase ke Supabase"] } },
    (turn) => {
      const log = find(turn.toolResults[0], "kept", "daily-logs/2026-08/2026-08-20");
      return `Saya tidak menemukan keputusan pindah dari Firebase ke Supabase. Supabase cuma pernah disebut Tomi sebagai ide untuk setelah beta, dan belum dibahas serius [${log.ref}].`;
    },
    { tool: "recall", args: { queries: ["tetap di Firebase", "stay on Firebase", "keputusan backend Firebase"] } },
    (turn) => {
      const decision = find(turn.toolResults[0], "kept", "decisions/2026-07-08-tetap-firebase");
      return `Iya, resminya masih Firebase: keputusannya backend tetap di Firebase sampai beta selesai [${decision.ref}].`;
    },
  );
  const graded = await dryRun(s, "supabase-tidak-pernah-diputuskan");
  expect(graded.turns[0].replies[0]).not.toMatch(/diputuskan (pada|tanggal)/);
  expect(graded.retrieval).toMatchObject({ recallAt5: 1, mrr: 1 });
});
