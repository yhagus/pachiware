import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summarize, type ProfileInfo, type TrialResult } from "./compare";

export interface RunMeta {
  judge: { provider: string; model: string }; rubricVersion: string; trials: number;
  repo: string; commit: string; startedAt: string; profiles: ProfileInfo[];
}

const fixed = (x: number) => x.toFixed(2);
const percent = (x: number | null) => (x === null ? "" : `${Math.round(x * 100)}%`);
const signed = (x: number) => (Math.abs(x) < 0.005 ? "+0.00" : `${x < 0 ? "−" : "+"}${Math.abs(x).toFixed(2)}`);

/** Writes `report.json` (everything) and `report.md` (a summary to read) into `dir`. */
export function writeReport(dir: string, meta: RunMeta, trials: TrialResult[]) {
  mkdirSync(dir, { recursive: true });
  const summary = summarize(trials, meta.profiles);
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...meta, summary, results: trials }, null, 2)}\n`);
  const briefs = [...new Set(trials.map((t) => t.result.fixture))].sort();
  const md = [
    `# Issue-draft eval, ${meta.startedAt}`,
    "",
    `Judge: ${meta.judge.provider} / ${meta.judge.model}. Rubric ${meta.rubricVersion}. ${meta.trials} ${meta.trials === 1 ? "trial" : "trials"} per brief. Repository: ${meta.repo} at \`${meta.commit.slice(0, 7)}\`.`,
    "",
    "A trial scores the share of its drafts that pass. A draft passes every code check, its brief covers at least 80% of the must-cover facts, and it invents no repository fact. Score averages trials per brief, then briefs. pass^k is the share of briefs where every trial passed.",
    "",
    "| Profile | Model | Score | pass^k | Coverage | Question rate | Tokens in / out per run | Cost per run | Latency per call | Time per run |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...summary.profiles.map((p) => `| ${p.name} | ${p.provider} / ${p.model} | ${fixed(p.score)} | ${percent(p.passK)} | ${fixed(p.coverage)} | ${percent(p.questionRate)} | ${Math.round(p.tokens.prompt)} / ${Math.round(p.tokens.completion)} | ${p.costPerRun === null ? "" : `$${p.costPerRun.toFixed(4)}`} | ${p.latencyPerCallMs === null ? "" : p.latencyPerCallMs < 1000 ? `${Math.round(p.latencyPerCallMs)} ms` : `${(p.latencyPerCallMs / 1000).toFixed(1)} s`} | ${Math.round(p.secondsPerRun)} s |`),
    ...(summary.pairs.length ? [
      "",
      "## Paired differences",
      "",
      "Score of the first profile minus the second, over the briefs both ran. A difference within about two standard errors of zero is noise at this set size.",
      "",
      "| Comparison | Briefs | Mean difference | Standard error |",
      "|---|---|---|---|",
      ...summary.pairs.map((d) => `| ${d.b} vs ${d.a} | ${d.n} | ${signed(d.mean)} | ${d.se === null ? "" : fixed(d.se)} |`),
    ] : []),
    "",
    "## Score per brief",
    "",
    `| Brief | ${summary.profiles.map((p) => p.name).join(" | ")} |`,
    `|---|${summary.profiles.map(() => "---|").join("")}`,
    ...briefs.map((b) => `| ${b} | ${summary.profiles.map((p) => (b in p.briefScores ? fixed(p.briefScores[b]!) : "")).join(" | ")} |`),
    ...meta.profiles.flatMap((p) => briefs.flatMap((b) => {
      const failed = trials.filter((t) => t.profile === p.name && t.result.fixture === b).sort((x, y) => x.trial - y.trial).flatMap((t) => !t.result.verdicts.length
        ? [`- Trial ${t.trial}: no draft was posted.`]
        : t.result.verdicts.filter((v) => !v.passed).map((v) => `- Trial ${t.trial}, draft ${v.n}: fail. ${v.reasons.join(" ")}`));
      return failed.length ? ["", `## ${p.name}: ${b}`, "", ...failed] : [];
    })),
  ];
  writeFileSync(join(dir, "report.md"), `${md.join("\n")}\n`);
}
