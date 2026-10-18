/**
 * Comparing profiles: every profile runs the same briefs for k trials. A trial scores the share of its
 * drafts that pass; trials are averaged per brief, and profiles are compared as paired per-brief differences with a
 * standard error. pass^k counts briefs where every trial passed. Cost and latency come from the usage events, per trial and in total.
 * Against the exam (`scorecard.ts`), a daily-behaviour run also scores the Rapor: per area and as one weighted total. A run whose briefs
 * name gold sources also reports retrieval, recall@5 and MRR (`retrieval.ts`), averaged per brief, then over briefs.
 */
import { AREAS, type Area } from "./assistantFixtures";
import type { AssistantJudged } from "./assistantJudge";
import type { JudgedResult } from "./judge";
import type { Exam } from "./scorecard";

/** A graded trial of either eval; both carry the fixture, coverage, question rate and one verdict per draft or turn. */
export type ScoredResult = JudgedResult | AssistantJudged;

export interface TrialUsage {
  prompt: number; completion: number;
  /** Prompt tokens the provider served from its cache; absent in runs recorded before it was kept. */
  cached?: number;
  /** Model calls, and the summed provider latency over them. */
  calls: number; latencyMs: number;
  /** Wall time of the whole trial. */
  ms: number;
}
export interface TrialResult { profile: string; trial: number; result: ScoredResult; usage: TrialUsage }
/** USD per million tokens; `cachedInput` prices prompt tokens served from the provider's cache, at the input price when left out. */
export interface Price { input: number; output: number; cachedInput?: number }
export interface ProfileInfo { name: string; provider: string; model: string; price?: Price }

export interface ProfileSummary extends ProfileInfo {
  briefScores: Record<string, number>;
  score: number;
  trialsPerBrief: number;
  passK: number;
  coverage: number;
  questionRate: number | null;
  tokens: { prompt: number; completion: number };
  costPerRun: number | null;
  latencyPerCallMs: number | null;
  secondsPerRun: number;
  /** Summed over every trial of the profile; `cost` is null without a price. */
  totals: { trials: number; prompt: number; cached: number; completion: number; calls: number; latencyMs: number; ms: number; cost: number | null };
  /** Only when some trial's facts name gold sources: means over the briefs that do, and per brief. */
  retrieval?: { recallAt5: number; mrr: number; briefs: Record<string, { recallAt5: number; mrr: number }> };
  /** Daily-behaviour runs scored against the exam only. */
  rapor?: Rapor;
}
export interface AreaScore {
  area: Area; weight: number;
  /** Mean over the area's exam briefs that ran, holdouts included; null when none ran. */
  score: number | null;
  briefs: number;
  /** Mean over the area's holdout briefs that ran; null when none ran. */
  holdoutScore: number | null;
}
/** `total` is the mean of the areas that have a score, weighted as the scorecard says and renormalised over them; null when no exam brief ran. */
export interface Rapor { version: string; total: number | null; areas: AreaScore[] }
export interface PairedDifference { n: number; mean: number; se: number | null }
export interface Summary { profiles: ProfileSummary[]; pairs: ({ a: string; b: string } & PairedDifference)[] }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * What a trial cost in USD. Anthropic reports prompt tokens without the ones read from its cache; the other providers count cache hits
 * inside prompt tokens, so they come off before the input price applies.
 */
export function costOf(usage: Pick<TrialUsage, "prompt" | "completion" | "cached">, price: Price, provider: string): number {
  const cached = usage.cached ?? 0, uncached = provider === "anthropic" ? usage.prompt : Math.max(0, usage.prompt - cached);
  return (uncached * price.input + cached * (price.cachedInput ?? price.input) + usage.completion * price.output) / 1e6;
}

export const trialScore = (r: ScoredResult) => (r.verdicts.length ? r.verdicts.filter((v) => v.passed).length / r.verdicts.length : 0);

/** Mean of b − a over the briefs both scored, with the standard error of that mean (null below two briefs). */
export function pairedDifference(a: Map<string, number>, b: Map<string, number>): PairedDifference {
  const d = [...a.keys()].filter((k) => b.has(k)).map((k) => b.get(k)! - a.get(k)!);
  const m = mean(d);
  if (d.length < 2) return { n: d.length, mean: m, se: null };
  const variance = sum(d.map((x) => (x - m) ** 2)) / (d.length - 1);
  return { n: d.length, mean: m, se: Math.sqrt(variance / d.length) };
}

export function raporOf(briefScores: Record<string, number>, exam: Exam): Rapor {
  const held = new Set(exam.holdout), meanOf = (briefs: string[]) => (briefs.length ? mean(briefs.map((b) => briefScores[b]!)) : null);
  const areas = AREAS.map((area): AreaScore => {
    const ran = exam.briefs.filter((b) => exam.areas[b] === area && b in briefScores);
    return { area, weight: exam.weights[area], score: meanOf(ran), briefs: ran.length, holdoutScore: meanOf(ran.filter((b) => held.has(b))) };
  });
  const scored = areas.filter((a) => a.score !== null);
  return { version: exam.version, total: scored.length ? sum(scored.map((a) => a.weight * a.score!)) / sum(scored.map((a) => a.weight)) : null, areas };
}

function byBrief(trials: TrialResult[]) {
  const out = new Map<string, TrialResult[]>();
  for (const t of trials) out.set(t.result.fixture, [...(out.get(t.result.fixture) ?? []), t]);
  return out;
}

export function summarize(trials: TrialResult[], profiles: ProfileInfo[], exam?: Exam): Summary {
  const summaries = profiles.map((p): ProfileSummary => {
    const own = trials.filter((t) => t.profile === p.name), briefs = byBrief(own);
    const perBrief = (f: (t: TrialResult) => number) => mean([...briefs.values()].map((ts) => mean(ts.map(f))));
    const rates = [...briefs.values()].map((ts) => ts.map((t) => t.result.questionRate).filter((r): r is number => r !== null)).filter((rs) => rs.length);
    const calls = sum(own.map((t) => t.usage.calls));
    const tokens = { prompt: mean(own.map((t) => t.usage.prompt)), completion: mean(own.map((t) => t.usage.completion)) };
    const briefScores = Object.fromEntries([...briefs].map(([name, ts]) => [name, mean(ts.map((t) => trialScore(t.result)))]));
    const costs = p.price ? own.map((t) => costOf(t.usage, p.price!, p.provider)) : null;
    const retrieved = [...briefs].flatMap(([name, ts]) => {
      const scored = ts.map((t) => (t.result as { retrieval?: { recallAt5: number; mrr: number } }).retrieval).filter((r) => r !== undefined);
      return scored.length ? [[name, { recallAt5: mean(scored.map((r) => r.recallAt5)), mrr: mean(scored.map((r) => r.mrr)) }] as const] : [];
    });
    return {
      ...p,
      briefScores,
      ...(exam && { rapor: raporOf(briefScores, exam) }),
      score: perBrief((t) => trialScore(t.result)),
      trialsPerBrief: Math.max(0, ...[...briefs.values()].map((ts) => ts.length)),
      passK: briefs.size ? [...briefs.values()].filter((ts) => ts.every((t) => t.result.passed)).length / briefs.size : 0,
      coverage: perBrief((t) => t.result.coverage),
      questionRate: rates.length ? mean(rates.map(mean)) : null,
      tokens,
      costPerRun: costs ? mean(costs) : null,
      latencyPerCallMs: calls ? sum(own.map((t) => t.usage.latencyMs)) / calls : null,
      secondsPerRun: mean(own.map((t) => t.usage.ms)) / 1000,
      totals: {
        trials: own.length, prompt: sum(own.map((t) => t.usage.prompt)), cached: sum(own.map((t) => t.usage.cached ?? 0)), completion: sum(own.map((t) => t.usage.completion)),
        calls, latencyMs: sum(own.map((t) => t.usage.latencyMs)), ms: sum(own.map((t) => t.usage.ms)), cost: costs ? sum(costs) : null,
      },
      ...(retrieved.length && { retrieval: { recallAt5: mean(retrieved.map(([, r]) => r.recallAt5)), mrr: mean(retrieved.map(([, r]) => r.mrr)), briefs: Object.fromEntries(retrieved) } }),
    };
  });
  const pairs = summaries.flatMap((a, i) => summaries.slice(i + 1).map((b) => ({ a: a.name, b: b.name, ...pairedDifference(new Map(Object.entries(a.briefScores)), new Map(Object.entries(b.briefScores))) })));
  return { profiles: summaries, pairs };
}
