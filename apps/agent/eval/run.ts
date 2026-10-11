/**
 * Drives one fixture through the issue-draft playbook at the Discord seam: the brief is posted with its images and
 * started with "Draft issues", the stored answers follow in the thread, then "draft now" when no draft is up yet
 * (#28, point 2). Database modules load lazily, inside the scenario's subprocess.
 */
import type { Scenario } from "../test/support/discordScenario";
import { checkOutput, type DraftOutput } from "./checks";
import type { TrialResult, TrialUsage } from "./compare";
import type { Fixture } from "./fixtures";
import { gradeWithJudge, type Ask } from "./judge";
import type { EvalProfile } from "./profiles";
import { checkoutAt, offlineGitHub, pinnedTree, type PinnedRepo } from "./repository";

/** A grounded round 1 takes several tool steps per point, more than a new tenant's default of 8. */
export const EVAL_MAX_ITERATIONS = 20;

export interface EvalOutput {
  fixture: string; repo: string; commit: string;
  /** The thread as Discord showed it, oldest first; a draft embed reads as its title and body. */
  transcript: { from: "author" | "bot"; text: string }[];
  drafts: DraftOutput[];
  /** Every question the bot asked: round questions, then the drafts' own open questions. */
  questions?: EvalQuestion[];
}
export interface EvalQuestion { source: string; point?: string; text: string }
export type Failure = ReturnType<typeof checkOutput>[number];
export interface EvalResult extends EvalOutput { failures: Failure[]; passed: boolean }

const db = () => import("../../../packages/db/src/index.ts") as Promise<any>;

/** Opens the pinned repository (and the fixture's stub repositories) to the guild, served offline, and lifts the tenant's tool-step limit. */
export async function setUpEval(s: Scenario, pin: PinnedRepo, fixture?: Fixture) {
  const stubs = fixture?.facts.alsoOpen ?? [];
  await s.git({ repos: [pin.repo, ...stubs.map((r) => r.repo)] });
  s.http.on(/^\w+ https:\/\/api\.github\.com\//, offlineGitHub(pin, checkoutAt(pin.commit), stubs));
  const { agentsConfig, eq } = await db();
  const [row] = await s.db.select().from(agentsConfig).where(eq(agentsConfig.tenantId, s.tenant.id));
  await s.db.update(agentsConfig).set({ settings: { ...row?.settings, maxReActIterations: EVAL_MAX_ITERATIONS } }).where(eq(agentsConfig.tenantId, s.tenant.id));
}

async function imagesOf(s: Scenario, fixture: Fixture) {
  const { attachment } = await import("../test/support/images");
  return Promise.all(fixture.images.map(async (im) => {
    const { width, height } = await new Bun.Image(im.bytes).metadata();
    return attachment(s, im.name, im.bytes, { contentType: im.contentType, width, height });
  }));
}

export async function runFixture(s: Scenario, fixture: Fixture, pin: PinnedRepo): Promise<EvalOutput> {
  await setUpEval(s, pin, fixture);
  const brief = await s.discord.send(fixture.brief, { attachments: await imagesOf(s, fixture) });
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread;
  const output = async () => ({ fixture: fixture.name, repo: pin.repo, commit: pin.commit, transcript: thread ? transcriptOf(thread.messages) : [], drafts: thread ? draftsOf(thread.messages) : [], questions: thread ? await questionsOf(s, thread) : [] });
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

/** Round questions and the drafts' own open questions, read from the brief's binding file. */
async function questionsOf(s: Scenario, thread: NonNullable<Message["thread"]>): Promise<EvalQuestion[]> {
  const { parseFrontmatter } = await import("../../../packages/skills/src/playbooks.ts");
  const text = await s.workspace.read(`guilds/${thread.guildId}/channels/${thread.parentId}/threads/${thread.id}.md`);
  const fields: any = (text && parseFrontmatter(text)?.fields) ?? {};
  const points: string[] = Array.isArray(fields.points) ? fields.points : [];
  return [
    ...(Array.isArray(fields.questions) ? fields.questions : []).map((q: any) => ({ source: `round ${q.round}`, ...(points[q.point - 1] ? { point: points[q.point - 1] } : {}), text: String(q.text) })),
    ...(Array.isArray(fields.drafts) ? fields.drafts : []).flatMap((d: any) => (d.openQuestions ?? []).map((q: any) => ({ source: `draft ${d.n}`, ...(points[d.point - 1] ? { point: points[d.point - 1] } : {}), text: String(q.question) }))),
  ];
}

/** Attaches `profile` to the scenario's bot and lets its model calls reach the provider. */
export async function useLiveProfile(s: Scenario, profile: EvalProfile) {
  const { profiles, bots, encryptSecret, eq } = await db();
  const { providerBaseUrl } = await import("../src/llm/providers.ts");
  const [row] = await s.db.insert(profiles).values({ tenantId: s.tenant.id, name: profile.name, provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl, apiKeyEncrypted: encryptSecret(profile.apiKey), acceptsImages: profile.acceptsImages }).returning();
  await s.db.update(bots).set({ profileId: row.id }).where(eq(bots.id, s.bot.id));
  s.model.live();
  s.http.passthrough(`POST ${providerBaseUrl(profile.provider, profile.baseUrl)}/`);
}

/** Tokens, model calls and provider latency from the tenant's usage events so far. */
export async function usageOf(s: Scenario): Promise<Omit<TrialUsage, "ms">> {
  const { usageEvents, and, eq } = await db();
  const rows: any[] = await s.db.select().from(usageEvents).where(and(eq(usageEvents.tenantId, s.tenant.id), eq(usageEvents.type, "llm_tokens")));
  return rows.reduce((t, r) => ({ prompt: t.prompt + (r.promptTokens ?? 0), completion: t.completion + (r.completionTokens ?? 0), calls: t.calls + 1, latencyMs: t.latencyMs + (r.metadata?.latencyMs ?? 0) }), { prompt: 0, completion: 0, calls: 0, latencyMs: 0 });
}

export function gradeRun(output: EvalOutput, fixture: Fixture, pin: PinnedRepo): EvalResult {
  const failures = checkOutput(output, { pin, paths: pinnedTree(pin.commit), language: fixture.facts.language });
  return { ...output, failures, passed: !failures.length };
}

/** One trial: the fixture's run, its code checks, the judge's verdicts, and what the run cost. */
export async function runTrial(s: Scenario, fixture: Fixture, pin: PinnedRepo, ask: Ask): Promise<Omit<TrialResult, "profile" | "trial">> {
  const started = Date.now();
  const output = await runFixture(s, fixture, pin);
  const usage = { ...await usageOf(s), ms: Date.now() - started };
  return { result: await gradeWithJudge(gradeRun(output, fixture, pin), fixture, ask), usage };
}
