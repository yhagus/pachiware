/**
 * Comparing profiles: every profile runs the same briefs for k trials. A trial scores the share of its
 * drafts that pass; trials are averaged per brief, and profiles are compared as paired per-brief differences with a
 * standard error. pass^k counts briefs where every trial passed. Cost and latency come from the usage events.
 */
import type { JudgedResult } from "./judge";

export interface TrialUsage {
  prompt: number; completion: number;
  /** Model calls, and the summed provider latency over them. */
  calls: number; latencyMs: number;
  /** Wall time of the whole trial. */
  ms: number;
}
export interface TrialResult { profile: string; trial: number; result: JudgedResult; usage: TrialUsage }
/** USD per million tokens. */
export interface Price { input: number; output: number }
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
}
export interface PairedDifference { n: number; mean: number; se: number | null }
export interface Summary { profiles: ProfileSummary[]; pairs: ({ a: string; b: string } & PairedDifference)[] }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const trialScore = (r: JudgedResult) => (r.verdicts.length ? r.verdicts.filter((v) => v.passed).length / r.verdicts.length : 0);

/** Mean of b − a over the briefs both scored, with the standard error of that mean (null below two briefs). */
export function pairedDifference(a: Map<string, number>, b: Map<string, number>): PairedDifference {
  const d = [...a.keys()].filter((k) => b.has(k)).map((k) => b.get(k)! - a.get(k)!);
  const m = mean(d);
  if (d.length < 2) return { n: d.length, mean: m, se: null };
  const variance = sum(d.map((x) => (x - m) ** 2)) / (d.length - 1);
  return { n: d.length, mean: m, se: Math.sqrt(variance / d.length) };
}

function byBrief(trials: TrialResult[]) {
  const out = new Map<string, TrialResult[]>();
  for (const t of trials) out.set(t.result.fixture, [...(out.get(t.result.fixture) ?? []), t]);
  return out;
}

export function summarize(trials: TrialResult[], profiles: ProfileInfo[]): Summary {
  const summaries = profiles.map((p): ProfileSummary => {
    const own = trials.filter((t) => t.profile === p.name), briefs = byBrief(own);
    const perBrief = (f: (t: TrialResult) => number) => mean([...briefs.values()].map((ts) => mean(ts.map(f))));
    const rates = [...briefs.values()].map((ts) => ts.map((t) => t.result.questionRate).filter((r): r is number => r !== null)).filter((rs) => rs.length);
    const calls = sum(own.map((t) => t.usage.calls));
    const tokens = { prompt: mean(own.map((t) => t.usage.prompt)), completion: mean(own.map((t) => t.usage.completion)) };
    return {
      ...p,
      briefScores: Object.fromEntries([...briefs].map(([name, ts]) => [name, mean(ts.map((t) => trialScore(t.result)))])),
      score: perBrief((t) => trialScore(t.result)),
      trialsPerBrief: Math.max(0, ...[...briefs.values()].map((ts) => ts.length)),
      passK: briefs.size ? [...briefs.values()].filter((ts) => ts.every((t) => t.result.passed)).length / briefs.size : 0,
      coverage: perBrief((t) => t.result.coverage),
      questionRate: rates.length ? mean(rates.map(mean)) : null,
      tokens,
      costPerRun: p.price ? (tokens.prompt * p.price.input + tokens.completion * p.price.output) / 1e6 : null,
      latencyPerCallMs: calls ? sum(own.map((t) => t.usage.latencyMs)) / calls : null,
      secondsPerRun: mean(own.map((t) => t.usage.ms)) / 1000,
    };
  });
  const pairs = summaries.flatMap((a, i) => summaries.slice(i + 1).map((b) => ({ a: a.name, b: b.name, ...pairedDifference(new Map(Object.entries(a.briefScores)), new Map(Object.entries(b.briefScores))) })));
  return { profiles: summaries, pairs };
}
