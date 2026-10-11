/**
 * The judged half of the issue-draft eval (#28, points 5 and 6). A pinned judge, configured by EVAL_JUDGE_* and never
 * one of the compared profiles' models, answers one narrow question per criterion: reasoning first, then yes, no or
 * unknown, always with the brief's reference facts in front of it.
 */
import { providerBaseUrl, providerHeaders } from "../src/llm/providers";
import type { DraftOutput } from "./checks";
import type { Fixture } from "./fixtures";
import type { EvalQuestion, EvalResult } from "./run";

/** Bump on any change to the rubric text or the pass rule; runs are comparable only at the same version. */
export const RUBRIC_VERSION = "0.1";
/** A brief's drafts must cover at least this share of its must-cover facts. */
export const COVERAGE_BAR = 0.8;

export type Verdict = "yes" | "no" | "unknown";
export interface Graded { reasoning: string; verdict: Verdict }
export interface JudgeConfig { provider: "openai" | "anthropic" | "custom"; model: string; baseUrl: string | null; apiKey: string }
export type Ask = (system: string, user: string) => Promise<string>;

export function judgeFromEnv(env: Record<string, string | undefined> = process.env): JudgeConfig {
  const provider = (env.EVAL_JUDGE_PROVIDER || "openai") as JudgeConfig["provider"];
  if (!["openai", "anthropic", "custom"].includes(provider)) throw new Error(`EVAL_JUDGE_PROVIDER is openai, anthropic or custom, not ${provider}.`);
  if (!env.EVAL_JUDGE_MODEL || !env.EVAL_JUDGE_API_KEY) throw new Error("Set EVAL_JUDGE_MODEL and EVAL_JUDGE_API_KEY (and EVAL_JUDGE_PROVIDER unless it is openai) for the judge.");
  if (provider === "custom" && !env.EVAL_JUDGE_BASE_URL) throw new Error("A custom judge provider needs EVAL_JUDGE_BASE_URL.");
  return { provider, model: env.EVAL_JUDGE_MODEL, baseUrl: env.EVAL_JUDGE_BASE_URL || null, apiKey: env.EVAL_JUDGE_API_KEY };
}

// Proxies often prefix the vendor ("anthropic/claude-..."), so only the last segment names the model.
const modelId = (model: string) => model.trim().toLowerCase().split("/").at(-1)!;

/** Throws when the judge would grade its own model's drafts. */
export function assertJudgeOutside(judge: { model: string }, profiles: { name: string; model: string }[]) {
  const same = profiles.find((p) => modelId(p.model) === modelId(judge.model));
  if (same) throw new Error(`The judge model ${judge.model} is also the model of profile ${same.name}; pick a judge outside the compared profiles.`);
}

export function judgeOverHttp(config: JudgeConfig, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch): Ask {
  const base = providerBaseUrl(config.provider, config.baseUrl), headers = { "Content-Type": "application/json", ...providerHeaders(config.provider, config.apiKey) };
  return async (system, user) => {
    const anthropic = config.provider === "anthropic";
    const res = await fetchImpl(anthropic ? `${base}/messages` : `${base}/chat/completions`, {
      method: "POST", headers, signal: AbortSignal.timeout(120_000),
      body: JSON.stringify(anthropic
        ? { model: config.model, max_tokens: 2048, system, messages: [{ role: "user", content: user }] }
        : { model: config.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`The judge's provider answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: any = await res.json();
    return anthropic ? (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") : data.choices?.[0]?.message?.content ?? "";
  };
}

/** The reply's last JSON object with a verdict; anything else is unknown. */
export function parseVerdict(text: string): Graded {
  for (const match of [...text.matchAll(/\{[^{}]*"verdict"[^{}]*\}/g)].reverse()) {
    try {
      const { reasoning, verdict } = JSON.parse(match[0]);
      if (["yes", "no", "unknown"].includes(verdict)) return { reasoning: String(reasoning ?? ""), verdict };
    } catch {}
  }
  return { reasoning: `The judge gave no verdict: ${text.trim().slice(0, 300)}`, verdict: "unknown" };
}

const SYSTEM = `You grade issue drafts that a Discord bot wrote from a short brief. Rubric ${RUBRIC_VERSION}.
You answer exactly one question about one item. Judge only from the brief, the author's answers, the reference facts and the item shown; do not recall anything about the repository yourself.
Answer "yes" or "no" when the material settles it, and "unknown" when it does not. Paraphrase counts: a fact is covered when a reader of the drafts would learn it, whatever the wording.
Think it through in a few sentences first. Then end your reply with one line of JSON and nothing after it:
{"reasoning": "<one or two sentences>", "verdict": "yes" | "no" | "unknown"}`;

const bullets = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)");
const draftText = (d: DraftOutput) => `### ${d.n}. ${d.title}\nRepository: ${d.repo ?? "none"}. Proposed labels: ${d.labels.join(", ") || "none"}.\n\n${d.body}`;
const context = (f: Fixture) => `## Brief\n${f.brief}\n\n## The author's answers to round 1\n${f.answers}`;

const factPrompt = (f: Fixture, drafts: DraftOutput[], fact: string) =>
  `${context(f)}\n\n## The drafts\n${drafts.map(draftText).join("\n\n")}\n\n## Question\nThe drafts must cover this fact:\n${fact}\n\nDo the drafts, taken together, cover it?`;
const questionPrompt = (f: Fixture, q: EvalQuestion) =>
  `${context(f)}\n\n## Known gaps in the brief\n${bullets(f.facts.knownGaps)}\n\n## Facts the bot could read in the repository\n${bullets(f.facts.repoFacts)}\n\n## The bot's question (${q.source}${q.point ? `, on: ${q.point}` : ""})\n${q.text}\n\n## Question\nThe author's answers came after this question, so they do not make it redundant. Does the question probe one of the known gaps, or something else the brief leaves open that a draft needs? It does not when the brief already answers it or the bot could have read the answer in the repository.`;
const inventionPrompt = (f: Fixture, d: DraftOutput) =>
  `${context(f)}\n\n## Repository facts the draft may state\n${bullets(f.facts.repoFacts)}\n\n## The draft\n${draftText(d)}\n\n## Question\nIs every statement this draft makes about the repository (its files, code, current behaviour, issues or labels) supported by the repository facts above, the brief, the answers, or the files listed under Context used? Answer "no" if the draft invents or contradicts a repository fact.`;

export interface Judgement {
  facts: ({ fact: string } & Graded)[];
  questions: (EvalQuestion & Graded)[];
  drafts: ({ n: number } & Graded)[];
}
export interface DraftVerdict { n: number; passed: boolean; reasons: string[] }
export interface JudgedResult extends EvalResult {
  judged: Judgement;
  /** Share of must-cover facts judged covered; unknown counts as not covered. */
  coverage: number;
  /** Share of questions judged to probe a gap or real ambiguity; null when the bot asked none. Reported, never a gate. */
  questionRate: number | null;
  verdicts: DraftVerdict[];
  /** Replaces the code-only `passed`: at least one draft, and every draft passed. */
  passed: boolean;
}

async function grade(ask: Ask, user: string): Promise<Graded> {
  try { return parseVerdict(await ask(SYSTEM, user)); }
  catch (e) { return { reasoning: `The judge call failed: ${e instanceof Error ? e.message : String(e)}`, verdict: "unknown" }; }
}

/** Judges a run already graded by code, then applies the pass rule: every code check, coverage at the bar, nothing invented. */
export async function gradeWithJudge(result: EvalResult, fixture: Fixture, ask: Ask): Promise<JudgedResult> {
  const drafts = result.drafts, questions = result.questions ?? [];
  const [facts, judgedQuestions, judgedDrafts] = await Promise.all([
    Promise.all(fixture.facts.mustCover.map(async (fact) => ({ fact, ...(drafts.length ? await grade(ask, factPrompt(fixture, drafts, fact)) : { reasoning: "No draft was posted.", verdict: "no" as const }) }))),
    Promise.all(questions.map(async (q) => ({ ...q, ...await grade(ask, questionPrompt(fixture, q)) }))),
    Promise.all(drafts.map(async (d) => ({ n: d.n, ...await grade(ask, inventionPrompt(fixture, d)) }))),
  ]);
  const covered = facts.filter((f) => f.verdict === "yes").length, coverage = covered / fixture.facts.mustCover.length;
  const missing = facts.filter((f) => f.verdict !== "yes").map((f) => `${f.fact} (${f.reasoning})`).join("; ");
  const coverageReason = coverage < COVERAGE_BAR ? `coverage: ${covered} of ${facts.length} must-cover facts covered, under ${COVERAGE_BAR * 100}%. Missing: ${missing}` : null;
  const verdicts = drafts.map((d) => {
    const reasons = result.failures.filter((f) => f.draft === d.n).map((f) => `${f.check}: ${f.message}`);
    if (coverageReason) reasons.push(coverageReason);
    const invented = judgedDrafts.find((j) => j.n === d.n);
    if (invented?.verdict === "no") reasons.push(`invented: ${invented.reasoning}`);
    return { n: d.n, passed: !reasons.length, reasons };
  });
  const asked = judgedQuestions.length;
  return {
    ...result, judged: { facts, questions: judgedQuestions, drafts: judgedDrafts }, coverage,
    questionRate: asked ? judgedQuestions.filter((q) => q.verdict === "yes").length / asked : null,
    verdicts, passed: verdicts.length > 0 && verdicts.every((v) => v.passed),
  };
}
