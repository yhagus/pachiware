/**
 * Drives one fixture through the issue-draft playbook at the Discord seam: the brief is posted and started with
 * "Draft issues", the stored answers follow in the thread, then "draft now" when no draft is up yet (#28, point 2).
 * Database modules load lazily, inside the scenario's subprocess.
 */
import type { Scenario } from "../test/support/discordScenario";
import { checkOutput, type DraftOutput } from "./checks";
import type { Fixture } from "./fixtures";
import { checkoutAt, offlineGitHub, pinnedTree, type PinnedRepo } from "./repository";

/** A grounded round 1 takes several tool steps per point, more than a new tenant's default of 8. */
export const EVAL_MAX_ITERATIONS = 20;

export interface EvalOutput {
  fixture: string; repo: string; commit: string;
  /** The thread as Discord showed it, oldest first; a draft embed reads as its title and body. */
  transcript: { from: "author" | "bot"; text: string }[];
  drafts: DraftOutput[];
}
export type Failure = ReturnType<typeof checkOutput>[number];
export interface EvalResult extends EvalOutput { failures: Failure[]; passed: boolean; ms?: number; tokens?: { prompt: number; completion: number } }

const db = () => import("../../../packages/db/src/index.ts") as Promise<any>;

/** Opens the pinned repository to the guild, served offline, and lifts the tenant's tool-step limit. */
export async function setUpEval(s: Scenario, pin: PinnedRepo) {
  await s.git({ repos: [pin.repo] });
  s.http.on(/^\w+ https:\/\/api\.github\.com\//, offlineGitHub(pin, checkoutAt(pin.commit)));
  const { agentsConfig, eq } = await db();
  const [row] = await s.db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, s.tenant.id));
  await s.db.update(agentsConfig).set({ settings: { ...row?.settings, maxReActIterations: EVAL_MAX_ITERATIONS } }).where(eq(agentsConfig.tenantId, s.tenant.id));
}

export async function runFixture(s: Scenario, fixture: Fixture, pin: PinnedRepo): Promise<EvalOutput> {
  await setUpEval(s, pin);
  const brief = await s.discord.send(fixture.brief);
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread;
  const output = () => ({ fixture: fixture.name, repo: pin.repo, commit: pin.commit, transcript: thread ? transcriptOf(thread.messages) : [], drafts: thread ? draftsOf(thread.messages) : [] });
  if (!thread) return output();
  await s.discord.send(fixture.answers, { channel: thread });
  if (!draftsOf(thread.messages).length) await s.discord.send("draft now", { channel: thread });
  return output();
}

type Message = Scenario["discord"]["botMessages"][number];
const isDraft = (m: Message) => m.author.bot && /^\d+\. /.test(m.embeds[0]?.title ?? "");

function transcriptOf(messages: Message[]): EvalOutput["transcript"] {
  return messages.map((m) => ({ from: m.author.bot ? "bot" as const : "author" as const, text: [m.content, ...m.embeds.map((e) => `${e.title ?? ""}\n\n${e.description ?? ""}`.trim())].filter(Boolean).join("\n\n") }));
}

/** The drafts as their embeds read now; a revision edits its embed in place. */
function draftsOf(messages: Message[]): DraftOutput[] {
  const byNumber = new Map<number, DraftOutput>();
  for (const m of messages.filter(isDraft)) {
    const e = m.embeds[0], [, n, title] = /^(\d+)\. ([\s\S]*)$/.exec(e.title)!;
    const field = (name: string) => e.fields?.find((f: any) => f.name === name)?.value as string | undefined;
    const repo = field("Repository"), labels = field("Proposed labels");
    byNumber.set(Number(n), { n: Number(n), title: title!, body: e.description ?? "", repo: repo && repo !== "None" ? repo : null, labels: labels && labels !== "None" ? labels.split(", ") : [] });
  }
  return [...byNumber.values()].sort((a, b) => a.n - b.n);
}

export interface LiveProfile { provider: "openai" | "anthropic" | "custom"; model: string; baseUrl: string | null }

/** The profile a live run answers with: EVAL_PROVIDER (openai, anthropic or custom; default openai), EVAL_MODEL, EVAL_BASE_URL. */
export function liveProfileFromEnv(env: Record<string, string | undefined> = process.env): LiveProfile {
  const provider = (env.EVAL_PROVIDER || "openai") as LiveProfile["provider"];
  if (!["openai", "anthropic", "custom"].includes(provider)) throw new Error(`EVAL_PROVIDER is openai, anthropic or custom, not ${provider}.`);
  if (!env.EVAL_MODEL) throw new Error("Set EVAL_MODEL to the model the eval profile answers with.");
  if (provider === "custom" && !env.EVAL_BASE_URL) throw new Error("A custom provider needs EVAL_BASE_URL.");
  return { provider, model: env.EVAL_MODEL, baseUrl: env.EVAL_BASE_URL || null };
}

/** Attaches `profile` to the scenario's bot and lets its model calls reach the provider. */
export async function useLiveProfile(s: Scenario, profile: LiveProfile, apiKey: string) {
  const { profiles, bots, encryptSecret, eq } = await db();
  const { providerBaseUrl } = await import("../src/llm/router.ts");
  const [row] = await s.db.insert(profiles).values({ tenantId: s.tenant.id, name: "eval", provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl, apiKeyEncrypted: encryptSecret(apiKey) }).returning();
  await s.db.update(bots).set({ profileId: row.id }).where(eq(bots.id, s.bot.id));
  s.model.live();
  s.http.passthrough(`POST ${providerBaseUrl(profile.provider, profile.baseUrl)}/`);
}

/** Tokens the tenant's model calls used so far. */
export async function tokensUsed(s: Scenario) {
  const { usageEvents, and, eq } = await db();
  const rows: any[] = await s.db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, s.tenant.id), eq(usageEvents.type, "llm_tokens")));
  return rows.reduce((t, r) => ({ prompt: t.prompt + (r.promptTokens ?? 0), completion: t.completion + (r.completionTokens ?? 0) }), { prompt: 0, completion: 0 });
}

export function gradeRun(output: EvalOutput, fixture: Fixture, pin: PinnedRepo, extra: Pick<EvalResult, "ms" | "tokens"> = {}): EvalResult {
  const failures = checkOutput(output, { pin, paths: pinnedTree(pin.commit), language: fixture.facts.language });
  return { ...output, ...extra, failures, passed: !failures.length };
}
