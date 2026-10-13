/**
 * The second half of a brief: the author's answers settle the round, then each breakdown draft is written out in
 * the anatomy, checked, and shown as one embed. Drafts keep their number for good, along with their target
 * repository, labels, and, once created, the issue's number and URL.
 */
import type { SkillContext, ToolDefinition, ToolResult } from "./types.js";
import { writeBinding, jumpLink, type BindingPlace, type PlaybookBinding } from "./playbooks.js";
import { today } from "./clock.js";
import { briefState, authorsBrief, updateBrief, undescribedImages, optionLetter, hasCycle, oneLine as line, type BriefDraft, type BriefQuestion, type BriefState, type DraftCategory } from "./brief.js";
import { checkDraft, type DraftViolation } from "./draftChecker.js";
import { describedByAnswers, screenshotLines } from "./briefImages.js";
import { contextUsed, groundingOf, proposedLabels, uncheckedQuestion } from "./grounding.js";

export const CATEGORIES: DraftCategory[] = ["bug", "feature", "chore", "docs"];
const MAX = { note: 200, answer: 500, text: 1500, item: 400, items: 12 };
const block = (v: unknown) => (typeof v === "string" ? v.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() : "");

async function draftingBrief(ctx: SkillContext) {
  const { place, found } = await authorsBrief(ctx, "Only the brief's author moves the brief on. Answer this person without changing the brief; their message is kept as input for the author.");
  const state = briefState(found.binding);
  if (!state.round || !state.drafts.length) throw new Error("This brief has no breakdown yet: post round 1 with postBriefRound first.");
  return { place, found, state };
}
const save = (tenantId: string, found: { binding: PlaybookBinding; body: string; version: string }, state: BriefState) =>
  writeBinding(tenantId, { ...found.binding, ...state }, found.body, found.version);

/** Applies the author's answers to the latest round. Pure; throws with every problem at once. */
export function applyAnswers(state: BriefState, args: Record<string, unknown>): BriefState {
  const problems: string[] = [];
  if (args.round !== state.round) problems.push(`round must be ${state.round}, the latest round; its question numbers are the ones the author answers.`);
  const latest = (n: unknown) => state.questions.find((q) => q.round === state.round && q.n === n);
  const raw = Array.isArray(args.answers) ? args.answers : args.answers === undefined ? [] : null;
  if (!raw) problems.push("answers must be a list of {q, answer}.");
  const given = new Map<number, string>();
  for (const a of raw ?? []) {
    const q = latest((a as any)?.q), answer = line((a as any)?.answer);
    if (!q) problems.push(`Round ${state.round} has no Q${(a as any)?.q}.`);
    else if (!answer) problems.push(`The answer to Q${q.n} is empty.`);
    else if (answer.length > MAX.answer) problems.push(`The answer to Q${q.n} is ${answer.length} characters; keep it to ${MAX.answer}.`);
    else given.set(q.n, answer);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  const questions = state.questions.map((q): BriefQuestion => {
    if (q.round !== state.round) return q;
    const answer = given.get(q.n);
    if (answer) return { ...q, status: "answered", answer };
    return q.status === "open" && args.acceptRest === true ? { ...q, status: "answered", answer: q.recommendation } : q;
  });
  return describedByAnswers({ ...state, questions, ...(args.draftNow === true ? { draftNow: true } : {}) }, given);
}

/**
 * Before drafting, the latest round's leftovers resolve: after "draft now" they stay open and go into the drafts;
 * a question already asked twice is assumed; one asked only once must go to another round first.
 */
function settleForDrafting(state: BriefState): BriefState {
  const pending = state.questions.filter((q) => q.round === state.round && q.status === "open" && !state.draftNow && !q.carriedFrom);
  if (pending.length) throw new Error(`${pending.map((q) => `Q${q.n}`).join(", ")} of round ${state.round} ${pending.length > 1 ? "have" : "has"} no answer yet. Record the author's answers with recordBriefAnswers. A question the author skipped is asked once more with postBriefRound before drafting, unless the author said "draft now".`);
  return { ...state, questions: state.questions.map((q) => q.round === state.round && q.status === "open" && !state.draftNow ? { ...q, status: "assumed", answer: q.recommendation } : q) };
}

/** Round questions a draft shows: assumptions always, open ones after "draft now"; a whole-brief question goes in every draft. */
const placed = (state: BriefState, d: BriefDraft) => state.questions.filter((q) => !q.image && (q.status === "assumed" || (q.status === "open" && state.draftNow)) && (q.point === d.point || q.point === 0));
const ask = (q: Pick<BriefQuestion, "text" | "recommendation" | "options">) => `- ${q.text}${q.options?.length ? ` (${q.options.map((o, i) => `${optionLetter(i)}) ${o}`).join("; ")})` : ""} ➡️ ${q.recommendation}`;

/** Where the brief came from: a thread started from a message shares that message's id. */
export const sourceLink = (b: PlaybookBinding) => jumpLink(b.guildId, b.sourceMessageId === b.threadId ? b.channelId : b.threadId, b.sourceMessageId);

/** The issue body of draft `n`, exactly as it would be created. `blocker` names a draft it waits on; creation swaps in issue numbers. */
export function draftBody(state: BriefState, binding: PlaybookBinding, n: number, blocker = (d: BriefDraft) => `Draft ${d.n}: ${d.title}`): string {
  const d = state.drafts[n - 1]!;
  const author = typeof binding.authorName === "string" && binding.authorName ? binding.authorName : "the author";
  const bot = typeof binding.botName === "string" && binding.botName ? binding.botName : "the bot";
  const qs = placed(state, d), grounding = groundingOf(binding), unchecked = uncheckedQuestion(grounding, d);
  const established = [...(d.established ?? []).map((e) => `- ${e}`), ...qs.filter((q) => q.status === "assumed").map((q) => `${ask(q)} *(assumed)*`)];
  const need = [...(d.openQuestions ?? []), ...(unchecked ? [unchecked] : [])].map((q) => ask({ text: q.question, recommendation: q.recommendation })).concat(qs.filter((q) => q.status === "open").map(ask));
  const open = [established.length ? `**Established so far:**\n${established.join("\n")}` : "", need.length ? `**Still need from @${author}:**\n${need.join("\n")}` : ""].filter(Boolean).join("\n\n");
  const section = (name: string, text: string | undefined) => (text ? `## ${name}\n${text}` : "");
  const list = (items: string[] | undefined, prefix = "- ") => (items?.length ? items.map((i) => `${prefix}${i}`).join("\n") : "");
  const repo = d.repo ? "" : " without repository context";
  const used = contextUsed(grounding, d), sha = d.repo && grounding.repos[d.repo]?.sha;
  const evidence = used.length ? `\n\n**Context used** (${d.repo} at \`${sha!.slice(0, 7)}\`):\n${used.map((u) => `- [${u.title}](${u.url})`).join("\n")}` : "";
  // Screenshots sit with what they show: the current behaviour when there is one, else the desired.
  const shots = screenshotLines(state, d), withShots = (text?: string) => (text && shots ? `${text}\n\n${shots}` : text);
  return [
    section("Summary", d.summary),
    section("Current behaviour", withShots(d.current)),
    section("Desired behaviour", d.current ? d.desired : withShots(d.desired)),
    section("Acceptance criteria", list(d.acceptance, "- [ ] ")),
    section("Out of scope", list(d.outOfScope)),
    section("Open questions", open),
    section("Blocked by", d.blockedBy.map((b) => `- ${blocker(state.drafts[b - 1]!)}`).join("\n")),
    `---\n[Drafted by ${bot} from a brief by ${author}](${sourceLink(binding)})${repo}.${evidence}`,
  ].filter(Boolean).join("\n\n");
}

/** Draft `n` as a Discord embed: the body as description; repository, Category and Proposed labels as fields. Labels stay out of the body. */
export function draftEmbed(state: BriefState, binding: PlaybookBinding, n: number) {
  const d = state.drafts[n - 1]!, labels = proposedLabels(groundingOf(binding), d);
  const fields = [{ name: "Repository", value: d.repo ?? "None", inline: true }, { name: "Category", value: d.category ?? "feature", inline: true }];
  if (d.repo) fields.push({ name: "Proposed labels", value: labels.join(", ") || "None", inline: true });
  return { title: `${d.n}. ${d.title}`, description: draftBody(state, binding, n), fields };
}

/** drafts.md, every written draft's Markdown to paste by hand; null once every draft has a target repository. `only` picks drafts whatever their repository, such as those a failed batch left. */
export function draftsFile(state: BriefState, binding: PlaybookBinding, only?: number[]): { name: string; content: string } | null {
  const written = state.drafts.filter((d) => d.writtenAt && (!only || only.includes(d.n)));
  if (!written.length || (!only && written.every((d) => d.repo))) return null;
  return { name: "drafts.md", content: `${written.map((d) => `# ${d.n}. ${d.title}\n\nCategory: ${d.category}\n\n${draftBody(state, binding, d.n)}`).join("\n\n")}\n` };
}

const SPLIT_RULES = new Set<DraftViolation["rule"]>(["body", "acceptanceCriteria", "openQuestions"]);

/** Writes or revises draft `n` (or adds draft drafts.length + 1). Pure; throws with every problem at once. */
export function applyDraft(current: BriefState, binding: PlaybookBinding, args: Record<string, unknown>): BriefState {
  const state = settleForDrafting(current);
  const problems: string[] = [];
  const count = state.drafts.length, n = args.n as number;
  if (!Number.isInteger(n) || n < 1 || n > count + 1) throw new Error(`n must name a draft from 1 to ${count}, or be ${count + 1} to add a draft.`);
  const before = state.drafts[n - 1];
  if (before?.issue) throw new Error(`Draft ${n} is already issue ${before.issue.url}; change it there.`);
  const fresh = !before;
  if (fresh && !(Number.isInteger(args.point) && (args.point as number) >= 1 && (args.point as number) <= state.points.length)) problems.push(`A new draft needs its point, a number from 1 to ${state.points.length}.`);
  if (before?.messageId && !line(args.note)) problems.push(`Draft ${n} is already posted: say what changed in note, one line.`);
  if (line(args.note).length > MAX.note) problems.push(`note is ${line(args.note).length} characters; keep it to ${MAX.note}.`);
  if (args.category !== undefined && !CATEGORIES.includes(args.category as DraftCategory)) problems.push(`category is one of ${CATEGORIES.join(", ")}.`);

  const text = (key: string) => { if (args[key] === undefined) return undefined; const v = block(args[key]); if (v.length > MAX.text) problems.push(`${key} is ${v.length} characters; keep it to ${MAX.text}.`); return v; };
  const items = (key: string) => {
    if (args[key] === undefined) return undefined;
    if (!Array.isArray(args[key])) { problems.push(`${key} must be a list.`); return undefined; }
    const v = (args[key] as unknown[]).map(line).filter(Boolean);
    if (v.length > MAX.items) problems.push(`${key} holds at most ${MAX.items} items.`);
    v.forEach((x, i) => { if (x.length > MAX.item) problems.push(`${key} item ${i + 1} is ${x.length} characters; keep it to ${MAX.item}.`); });
    return v;
  };
  const openQuestions = args.openQuestions === undefined ? undefined : Array.isArray(args.openQuestions)
    ? (args.openQuestions as any[]).map((q) => ({ question: line(q?.question), recommendation: line(q?.recommendation) }))
    : (problems.push("openQuestions must be a list."), undefined);
  if (openQuestions?.some((q) => !q.question || !q.recommendation)) problems.push("Every open question needs the question and your recommended answer.");
  let blockedBy = before?.blockedBy ?? [];
  if (args.blockedBy !== undefined) {
    const raw = Array.isArray(args.blockedBy) ? [...new Set(args.blockedBy as unknown[])] : [null];
    if (raw.some((b) => !Number.isInteger(b) || b === n || (b as number) < 1 || (b as number) > Math.max(count, n))) problems.push(`blockedBy must name other drafts by number.`);
    else blockedBy = raw as number[];
  }
  // A draft targets a repository read for this brief, and proposes only labels that repository already has.
  const grounding = groundingOf(binding);
  let repo = before ? before.repo : state.drafts.find((x) => x.point === args.point)?.repo ?? grounding.single;
  if (args.repo !== undefined) repo = line(args.repo) || undefined;
  if (repo && !grounding.repos[repo]) problems.push(`Read ${repo} with briefRead (step "repository") before drafting for it, or pass repo "" to draft without repository context.`);
  let labels = repo === before?.repo ? before?.labels : undefined;
  if (args.labels !== undefined) {
    const known = (repo && grounding.repos[repo]?.labels) || [], find = (l: string) => known.find((k) => k.toLowerCase() === l.toLowerCase());
    const raw = Array.isArray(args.labels) ? args.labels.map(line).filter(Boolean) : null;
    const unknown = raw?.filter((l) => !find(l)) ?? [];
    if (!raw) problems.push("labels must be a list.");
    else if (!repo && raw.length) problems.push("A draft without a repository carries only its Category: leave labels out.");
    else if (unknown.length) problems.push(`${unknown.join(", ")} ${unknown.length > 1 ? "are not labels" : "is not a label"} of ${repo}. Propose only labels it has: ${known.slice(0, 40).join(", ") || "it has none"}.`);
    else labels = [...new Set(raw.map((l) => find(l)!))];
  }

  const changes = Object.fromEntries(Object.entries({
    title: args.title === undefined ? undefined : line(args.title), summary: text("summary"), current: text("current"), desired: text("desired"),
    category: args.category, acceptance: items("acceptance"), outOfScope: items("outOfScope"), established: items("established"), openQuestions,
  }).filter(([, v]) => v !== undefined));
  const draft: BriefDraft = { ...(before ?? { n, point: args.point as number, title: "", summary: "" }), ...changes, n, blockedBy, writtenAt: today().toISOString(), ...(before?.messageId ? { revisions: (before.revisions ?? 0) + 1 } : {}) };
  if (!draft.current) delete draft.current;
  if (repo) draft.repo = repo; else delete draft.repo;
  if (labels?.length) draft.labels = labels; else delete draft.labels;
  for (const [key, ok] of [["category", !!draft.category], ["desired", !!draft.desired], ["acceptance", !!draft.acceptance?.length], ["outOfScope", !!draft.outOfScope?.length], ["summary", !!draft.summary]] as const)
    if (!ok) problems.push(`Draft ${n} needs ${key}.`);
  if (problems.length) throw new Error(problems.join("\n"));

  const drafts = [...state.drafts];
  drafts[n - 1] = draft;
  if (hasCycle(drafts)) throw new Error("The blockedBy edges form a cycle; a draft cannot wait on itself.");
  const next = { ...state, drafts };
  const violations = checkDraft({ title: draft.title, body: draftBody(next, binding, n) });
  if (violations.length) {
    const split = violations.some((v) => SPLIT_RULES.has(v.rule)) ? `\nIf the draft is more than one slice, split it: keep one slice in draft ${n} and write the rest as draft ${count + 1}.` : "";
    throw new Error(`Draft ${n} was not posted:\n${violations.map((v) => `- ${v.message}`).join("\n")}${split}`);
  }
  return next;
}

export const recordBriefAnswersTool: ToolDefinition = {
  name: "recordBriefAnswers",
  description: "In a thread that follows the issue-draft playbook: records the brief author's answers to the latest clarifying round. Call it first on every author turn that answers a question or says \"draft now\". Only works on the brief author's turns.",
  parameters: {
    type: "object",
    properties: {
      round: { type: "integer", description: "The round being answered: the latest one posted" },
      answers: { type: "array", description: "Questions the author answered one by one, e.g. \"Q2 option b\" or the exception in \"yes, except Q3: …\"", items: { type: "object", properties: {
        q: { type: "integer", description: "Question number in that round" },
        answer: { type: "string", description: "The author's answer, at most 500 characters; for an option, its letter and text" },
      }, required: ["q", "answer"] } },
      acceptRest: { type: "boolean", description: "The author said \"yes\": every question not in answers takes its recommendation" },
      draftNow: { type: "boolean", description: "The author said \"draft now\": questions still open go into the drafts' Open questions" },
    },
    required: ["round"],
  },
};

export async function recordBriefAnswers(args: Record<string, unknown>, ctx: SkillContext) {
  const { found, state } = await draftingBrief(ctx);
  const next = applyAnswers(state, args);
  await save(ctx.tenantId, found, next);
  const latest = next.questions.filter((q) => q.round === next.round);
  return {
    round: next.round,
    answered: latest.filter((q) => q.status === "answered").map((q) => `Q${q.n}: ${q.answer}`),
    unanswered: latest.filter((q) => q.status === "open").map((q) => `Q${q.n}${q.carriedFrom ? " (asked twice: taken as an assumption when drafting)" : " (asked once: carried into the next round)"}`),
    draftNow: !!next.draftNow,
    ...undescribedImages(next),
  };
}

export const writeIssueDraftTool: ToolDefinition = {
  name: "writeIssueDraft",
  description: "In a thread that follows the issue-draft playbook: writes one issue draft in the anatomy, checks it against the detail budget, saves it to the brief's file, and shows it as an embed. Call once per draft. On a posted draft it revises: pass only the fields that change, plus note; the embed is edited in place. The posted drafts are this turn's reply; text you write after it is not shown. Only works on the brief author's turns.",
  parameters: {
    type: "object",
    properties: {
      n: { type: "integer", description: "The draft's number from the breakdown; drafts.length + 1 adds a draft (to split one)" },
      point: { type: "integer", description: "The point it comes from (1-based); only for a new draft" },
      title: { type: "string", description: "Imperative, at most 70 characters, no [Category] prefix; defaults to the breakdown title" },
      category: { type: "string", enum: CATEGORIES, description: "Neutral category" },
      summary: { type: "string", description: "One or two lines on what changes and why" },
      current: { type: "string", description: "Current behaviour; leave out for a brand-new feature" },
      desired: { type: "string", description: "Desired behaviour, with edge cases and error conditions" },
      acceptance: { type: "array", items: { type: "string" }, description: "At most 7, each testable on its own; tag additions *(added)*" },
      outOfScope: { type: "array", items: { type: "string" } },
      established: { type: "array", items: { type: "string" }, description: "What the author settled that a reader of the open questions needs" },
      openQuestions: { type: "array", description: "Your own questions still open. Unanswered round questions are added for you", items: { type: "object", properties: { question: { type: "string" }, recommendation: { type: "string" } }, required: ["question", "recommendation"] } },
      blockedBy: { type: "array", items: { type: "integer" }, description: "Numbers of drafts that must land first" },
      repo: { type: "string", description: "Target repository, read with briefRead; defaults to the breakdown's. \"\" drafts without repository context" },
      labels: { type: "array", items: { type: "string" }, description: "Proposed labels, only from the repository's existing labels. The Category's own label is added for you" },
      note: { type: "string", description: "Revisions only: one line on what changed, at most 200 characters" },
    },
    required: ["n"],
  },
};

export async function writeIssueDraft(args: Record<string, unknown>, ctx: SkillContext) {
  const { found, state } = await draftingBrief(ctx);
  const next = applyDraft(state, found.binding, args);
  await save(ctx.tenantId, found, next);
  const d = next.drafts[(args.n as number) - 1]!;
  return { draft: d.n, title: d.title, ...(state.drafts[d.n - 1]?.messageId ? { revised: true, note: line(args.note) } : { posted: true }) };
}

/** The drafts a turn wrote, in order, each once, with the note of its last revision. */
export const draftsWrittenOf = (calls: { call: { name: string }; result: ToolResult }[]) => {
  const out = new Map<number, string | undefined>();
  for (const { call, result } of calls) if (call.name === writeIssueDraftTool.name && result.success) { const d = result.data as any; out.delete(d.draft); out.set(d.draft, d.note ?? out.get(d.draft)); }
  return [...out].map(([n, note]) => ({ n, note }));
};

/** Remembers the thread messages showing the drafts, so a revision edits them in place even after a restart. */
export const recordDraftMessages = (tenantId: string, place: BindingPlace, ids: Record<number, string>, draftsFileMessageId?: string) =>
  updateBrief(tenantId, place, (s) => ({ state: { ...s, drafts: s.drafts.map((d) => (ids[d.n] ? { ...d, messageId: ids[d.n] } : d)), ...(draftsFileMessageId ? { draftsFileMessageId } : {}) }, value: true }));

/** The one-line note under a revised draft, linking to its embed. */
export const revisionNote = (binding: PlaybookBinding, d: BriefDraft, note: string) =>
  `${d.messageId ? `[Draft ${d.n}](${jumpLink(binding.guildId, binding.threadId, d.messageId)})` : `Draft ${d.n}`} updated: ${note}`;
export const DRAFTS_FILE_NOTE = "drafts.md has every draft's Markdown, to paste into your tracker by hand.";
