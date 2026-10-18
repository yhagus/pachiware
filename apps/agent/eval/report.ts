import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { costOf, summarize, type ProfileInfo, type TrialResult } from "./compare";
import type { Exam } from "./scorecard";

export interface RunMeta {
  /** Which eval the run is; the issue-draft eval when absent. */
  kind?: "drafts" | "assistant";
  judge: { provider: string; model: string }; rubricVersion: string; trials: number;
  /** The pinned repository, issue-draft runs only. */
  repo?: string; commit?: string;
  /** Daily-behaviour runs: the exam whose briefs ran, "lived-in" for the lived-in sessions; the Rapor's briefs when absent. */
  exam?: "rapor" | "lived-in";
  startedAt: string; profiles: ProfileInfo[];
}

const fixed = (x: number) => x.toFixed(2);
const percent = (x: number | null) => (x === null ? "" : `${Math.round(x * 100)}%`);
const signed = (x: number) => (Math.abs(x) < 0.005 ? "+0.00" : `${x < 0 ? "−" : "+"}${Math.abs(x).toFixed(2)}`);

const WORDING = {
  drafts: {
    title: "Issue-draft eval",
    rule: "A trial scores the share of its drafts that pass. A draft passes every code check, its brief covers at least 80% of the must-cover facts, and it invents no repository fact. Score averages trials per brief, then briefs. pass^k is the share of briefs where every trial passed.",
    nothing: "no draft was posted.",
  },
  assistant: {
    title: "Daily-behaviour eval",
    rule: "A trial scores the share of its turns that pass. A turn passes every code check on the replies and the Workspace and schedule state after it, its brief covers at least 80% of the must-cover facts, the bot acted or asked as the request called for, and every statement about tasks, Memory, files or Reminders is supported. Score averages trials per brief, then briefs. pass^k is the share of briefs where every trial passed.",
    nothing: "no turn was graded.",
  },
};

const raporRule = (name: string) => `The ${name === "Rapor" ? "Rapor" : `${name} score`} is out of 100. An area scores the mean of its exam briefs' scores, held-out briefs included; the total is the mean of the areas that ran, weighted as \`scorecard.yaml\` says. Holdout score is the mean of the area's held-out briefs alone, which nothing is ever tuned to.`;
const hundred = (x: number | null) => (x === null ? "" : (x * 100).toFixed(1));
const RETRIEVAL_RULE = "Retrieval scores what each turn's searches showed against the sources its facts name as gold. Recall@5 is the share of gold sources found among the first 5 of their part (kept files, Tasks, git work); MRR is the mean reciprocal rank of the first gold source found within 10. Turns, then trials, then briefs are averaged; briefs without gold are left out.";
const COST_RULE = "Tokens in are prompt tokens, with those served from the provider's prompt cache in brackets; model latency is the summed provider latency of every model call, wall time the whole trial. Cost needs a `price` on the profile; cached tokens are priced at `cachedInput` when it is given.";
const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const dollars = (x: number | null) => (x === null ? "" : `$${x.toFixed(4)}`);

/** Writes `report.json` (everything) and `report.md` (a summary to read) into `dir`; with the exam, a daily-behaviour report opens with the Rapor. */
export function writeReport(dir: string, meta: RunMeta, trials: TrialResult[], exam?: Exam) {
  mkdirSync(dir, { recursive: true });
  const summary = summarize(trials, meta.profiles, exam), words = WORDING[meta.kind ?? "drafts"], examName = exam?.name ?? "Rapor";
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...meta, summary, results: trials }, null, 2)}\n`);
  const briefs = [...new Set(trials.map((t) => t.result.fixture))].sort();
  const run = `Judge: ${meta.judge.provider} / ${meta.judge.model}. Rubric ${meta.rubricVersion}. ${meta.trials} ${meta.trials === 1 ? "trial" : "trials"} per brief.${meta.repo && meta.commit ? ` Repository: ${meta.repo} at \`${meta.commit.slice(0, 7)}\`.` : ""}`;
  const md = [
    ...(exam ? [
      `# ${examName} v${exam.version}: ${summary.profiles.map((p) => `${p.rapor!.total === null ? "none" : hundred(p.rapor!.total)} (${p.name})`).join(", ")}`,
      "",
      `${words.title}, ${meta.startedAt}. ${run}`,
    ] : [`# ${words.title}, ${meta.startedAt}`, "", run]),
    "",
    words.rule,
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
    ...(exam ? ["", raporRule(examName), ...summary.profiles.flatMap((p) => [
      "",
      `## ${examName} per area: ${p.name}`,
      "",
      "| Area | Weight | Score | Briefs | Holdout score |",
      "|---|---|---|---|---|",
      ...p.rapor!.areas.map((a) => `| ${a.area} | ${a.weight} | ${hundred(a.score)} | ${a.briefs} | ${hundred(a.holdoutScore)} |`),
    ])] : []),
    ...(summary.profiles.some((p) => p.retrieval) ? [
      "",
      "## Retrieval",
      "",
      RETRIEVAL_RULE,
      "",
      "| Profile | Recall@5 | MRR | Briefs with gold |",
      "|---|---|---|---|",
      ...summary.profiles.map((p) => `| ${p.name} | ${p.retrieval ? fixed(p.retrieval.recallAt5) : ""} | ${p.retrieval ? fixed(p.retrieval.mrr) : ""} | ${Object.keys(p.retrieval?.briefs ?? {}).length} |`),
      "",
      `| Brief | ${summary.profiles.map((p) => `${p.name} recall@5 | ${p.name} MRR`).join(" | ")} |`,
      `|---|${summary.profiles.map(() => "---|---|").join("")}`,
      ...[...new Set(summary.profiles.flatMap((p) => Object.keys(p.retrieval?.briefs ?? {})))].sort().map((b) => `| ${b} | ${summary.profiles.map((p) => {
        const r = p.retrieval?.briefs[b];
        return r ? `${fixed(r.recallAt5)} | ${fixed(r.mrr)}` : " | ";
      }).join(" | ")} |`),
    ] : []),
    "",
    "## Cost and latency",
    "",
    COST_RULE,
    "",
    "| Profile | Trials | Tokens in (cached) / out | Model calls | Model latency | Wall time | Cost |",
    "|---|---|---|---|---|---|---|",
    ...summary.profiles.map((p) => `| ${p.name} | ${p.totals.trials} | ${p.totals.prompt} (${p.totals.cached}) / ${p.totals.completion} | ${p.totals.calls} | ${seconds(p.totals.latencyMs)} | ${seconds(p.totals.ms)} | ${dollars(p.totals.cost)} |`),
    "",
    "| Profile | Brief | Trial | Tokens in (cached) / out | Model calls | Model latency | Wall time | Cost |",
    "|---|---|---|---|---|---|---|---|",
    ...[...trials].sort((x, y) => x.profile.localeCompare(y.profile) || x.result.fixture.localeCompare(y.result.fixture) || x.trial - y.trial).map((t) => {
      const p = meta.profiles.find((q) => q.name === t.profile), u = t.usage;
      return `| ${t.profile} | ${t.result.fixture} | ${t.trial} | ${u.prompt} (${u.cached ?? 0}) / ${u.completion} | ${u.calls} | ${seconds(u.latencyMs)} | ${seconds(u.ms)} | ${dollars(p?.price ? costOf(u, p.price, p.provider) : null)} |`;
    }),
    "",
    "## Score per brief",
    "",
    `| Brief | ${summary.profiles.map((p) => p.name).join(" | ")} |`,
    `|---|${summary.profiles.map(() => "---|").join("")}`,
    ...briefs.map((b) => `| ${b} | ${summary.profiles.map((p) => (b in p.briefScores ? fixed(p.briefScores[b]!) : "")).join(" | ")} |`),
    ...meta.profiles.flatMap((p) => briefs.flatMap((b) => {
      const failed = trials.filter((t) => t.profile === p.name && t.result.fixture === b).sort((x, y) => x.trial - y.trial).flatMap((t) => !t.result.verdicts.length
        ? [`- Trial ${t.trial}: ${words.nothing}`]
        : t.result.verdicts.filter((v) => !v.passed).map((v) => `- Trial ${t.trial}, ${v.label ?? `draft ${v.n}`}: fail. ${v.reasons.join(" ")}`));
      return failed.length ? ["", `## ${p.name}: ${b}`, "", ...failed] : [];
    })),
  ];
  writeFileSync(join(dir, "report.md"), `${md.join("\n")}\n`);
}
