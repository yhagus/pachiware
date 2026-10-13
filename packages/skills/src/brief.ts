import type { SkillContext, ToolDefinition, ToolResult } from "./types.js";
import { readBinding, writeBinding, rewriteBinding, type BindingPlace, type PlaybookBinding } from "./playbooks.js";
import { groundingOf, openRepos, type BriefGrounding } from "./grounding.js";
import { replyLanguage, textIn, MESSAGE_LIMIT, type Language } from "./language.js";
import { today } from "./clock.js";

/**
 * A brief's state lives in its thread's binding file (see `bindingPath`), next to the binding fields.
 * Every value is one line of JSON in the frontmatter; the body stays the brief exactly as its author wrote it.
 *
 *   points: string[]             the brief's points, one line each; "point 1" is points[0]
 *   drafts: BriefDraft[]         the breakdown, then the issue drafts it grows into (see issueDrafts.ts); a draft's number never changes once written
 *   round: number                the latest clarifying round posted, 0 before round 1
 *   questions: BriefQuestion[]   every question of every round, each with its round and number in that round
 *   input: BriefInput[]          messages from people other than the author, kept for the author to weigh
 *   draftNow: boolean            the author said "draft now": open questions go into the drafts instead of another round
 *   draftsFileMessageId: string  the thread message carrying drafts.md, edited when a draft changes
 *   images: BriefImage[]         screenshots the author attached, kept as text so later turns need no image bytes (see briefImages.ts)
 *
 * The binding also keeps `authorName` and `botName` from when the brief started, for the drafts' footer.
 */
export interface BriefDraft {
  n: number;
  /** 1-based index into `points`; a point split into several slices has several drafts. */
  point: number;
  title: string;
  summary: string;
  /** Numbers of drafts that must land first. */
  blockedBy: number[];
  /** Set once the full draft is written; the remaining fields are the anatomy's sections. */
  writtenAt?: string;
  category?: DraftCategory;
  current?: string;
  desired?: string;
  acceptance?: string[];
  outOfScope?: string[];
  established?: string[];
  /** The model's own open questions; round questions left open or assumed are placed by point when rendering. */
  openQuestions?: { question: string; recommendation: string }[];
  /** Target repository; none means the draft is written without repository context. */
  repo?: string;
  /** Proposed labels chosen from the repository's own; the Category's label joins them when rendered (see proposedLabels). */
  labels?: string[];
  /** The thread message showing this draft as an embed. */
  messageId?: string;
  revisions?: number;
  /** The issue created from this draft, saved before the next draft is created so a retry never repeats it; `id` is GitHub's database id. */
  issue?: { number: number; url: string; id?: number };
  /** The author dropped this draft before creation; it is never created. */
  skipped?: boolean;
}
export type DraftCategory = "bug" | "feature" | "chore" | "docs";
/** open: asked, no answer yet. answered: the author settled it. carried: asked again in the next round. assumed: the recommendation was taken and is marked in the draft. */
export type QuestionStatus = "open" | "answered" | "carried" | "assumed";
export interface BriefQuestion {
  round: number;
  /** Number within its round, counted across every point. */
  n: number;
  /** 1-based point, or 0 for a question about the whole brief. */
  point: number;
  text: string;
  recommendation: string;
  options?: string[];
  status: QuestionStatus;
  answer?: string;
  /** Set on a question asked again because the author left it unanswered; unanswered a second time, it is assumed. */
  carriedFrom?: { round: number; n: number };
  /** The screenshot this question asks the author to describe; the answer becomes its description. */
  image?: string;
}
export interface BriefImage {
  /** The Discord attachment id. */
  id: string;
  name: string;
  /** The Discord message holding the image. */
  link: string;
  /** The model was sent the image's bytes; one it never saw is described by the author in the next round. */
  seen: boolean;
  /** 1-based point, or 0 for the whole brief; drafts of that point show the image. */
  point?: number;
  description?: string;
}
export interface BriefInput { messageId: string; userId: string; name: string; text: string; at: string; round: number; seen: boolean }
export interface BriefState { points: string[]; drafts: BriefDraft[]; round: number; questions: BriefQuestion[]; input: BriefInput[]; draftNow?: boolean; draftsFileMessageId?: string; images?: BriefImage[] }

export const briefState = (b: PlaybookBinding): BriefState => ({
  points: Array.isArray(b.points) ? b.points as string[] : [],
  drafts: Array.isArray(b.drafts) ? b.drafts as BriefDraft[] : [],
  round: typeof b.round === "number" ? b.round : 0,
  questions: Array.isArray(b.questions) ? b.questions as BriefQuestion[] : [],
  input: Array.isArray(b.input) ? b.input as BriefInput[] : [],
  ...(b.draftNow === true ? { draftNow: true } : {}),
  ...(typeof b.draftsFileMessageId === "string" ? { draftsFileMessageId: b.draftsFileMessageId } : {}),
  ...(Array.isArray(b.images) && b.images.length ? { images: b.images as BriefImage[] } : {}),
});

/** Each field's cap keeps the largest possible question, with its point heading, well under one Discord message. */
const MAX = { points: 30, point: 200, drafts: 30, title: 70, summary: 200, questions: 40, question: 500, recommendation: 300, options: 5, option: 150 };
/** A brief holds at most `points` points of at most `point` characters each. */
export const BRIEF_CAPS = { points: MAX.points, point: MAX.point } as const;
/** A model-written value as one trimmed line; anything but a string is empty. */
export const oneLine = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Checks a round the model proposed and folds it into the brief; throws with every problem at once so one retry can fix them all. */
export function applyRound(current: BriefState, args: Record<string, unknown>, grounding?: BriefGrounding, language: Language = "en"): BriefState {
  const problems: string[] = [];
  const tooLong = (what: string, value: string, max: number) => { if (value.length > max) problems.push(`${what} is ${value.length} characters; keep it to ${max}.`); };
  const round = current.round + 1;
  const points = args.points === undefined && current.points.length ? current.points : Array.isArray(args.points) ? args.points.map(oneLine) : [];
  // Points set before round 1 (from minutes) are the record's, so the first round cannot rewrite them.
  if (current.round === 0 && current.points.length && JSON.stringify(points) !== JSON.stringify(current.points)) problems.push(PRESET_POINTS);
  if (!points.length || points.some((p) => !p)) problems.push("points must list the brief's points, one short line each.");
  if (points.length > MAX.points) problems.push(`A brief holds at most ${MAX.points} points.`);
  points.forEach((p, i) => tooLong(`Point ${i + 1}`, p, MAX.point));
  const pointOk = (p: unknown, allowWhole: boolean) => Number.isInteger(p) && (p as number) >= (allowWhole ? 0 : 1) && (p as number) <= points.length;

  let drafts = current.drafts;
  if (args.drafts !== undefined && current.drafts.some((d) => d.writtenAt)) problems.push("The drafts are written, so the breakdown is fixed: change a draft with writeIssueDraft instead of passing drafts.");
  else if (args.drafts !== undefined || round === 1) {
    const raw = Array.isArray(args.drafts) ? args.drafts : [];
    if (!raw.length) problems.push("drafts must propose at least one issue draft.");
    if (raw.length > MAX.drafts) problems.push(`A breakdown holds at most ${MAX.drafts} drafts; split the brief.`);
    drafts = raw.map((d: any, i) => {
      const n = i + 1, title = oneLine(d?.title), summary = oneLine(d?.summary);
      if (!pointOk(d?.point, false)) problems.push(`Draft ${n}'s point must be a number from 1 to ${points.length}.`);
      if (!title || !summary) problems.push(`Draft ${n} needs a title and a one-line summary.`);
      tooLong(`Draft ${n}'s title`, title, MAX.title);
      tooLong(`Draft ${n}'s summary`, summary, MAX.summary);
      const blockedBy = Array.isArray(d?.blockedBy) ? [...new Set(d.blockedBy as unknown[])] : [];
      if (blockedBy.some((b) => !Number.isInteger(b) || b === n || (b as number) < 1 || (b as number) > raw.length)) problems.push(`Draft ${n}'s blockedBy must name other drafts by number.`);
      const repo = d?.repo === undefined ? grounding?.single : oneLine(d.repo), repos = grounding ? openRepos(grounding) : [];
      if (repo && !repos.includes(repo)) problems.push(repos.length ? `Draft ${n}'s repo must be one of ${repos.join(", ")}.` : "No repository is open to this brief: call briefRepositories first, or leave repo out to draft without repository context.");
      return { n, point: d?.point, title, summary, blockedBy: blockedBy as number[], ...(repo ? { repo } : {}) };
    });
    if (!problems.length && hasCycle(drafts)) problems.push("The blockedBy edges form a cycle; a draft cannot wait on itself.");
  }

  const raw = Array.isArray(args.questions) ? args.questions : args.questions === undefined ? [] : null;
  if (!raw) problems.push("questions must be a list.");
  if ((raw?.length ?? 0) > MAX.questions) problems.push(`A round holds at most ${MAX.questions} questions.`);
  const asked = (raw ?? []).map((q: any, i) => {
    const text = oneLine(q?.question), recommendation = oneLine(q?.recommendation);
    const options = Array.isArray(q?.options) ? q.options.map(oneLine).filter(Boolean) : [];
    const which = `Question "${text.slice(0, 40) || i + 1}"`;
    if (!pointOk(q?.point, true)) problems.push(`${which}: point must be 0 (whole brief) or a number from 1 to ${points.length}.`);
    if (!text || !recommendation) problems.push(`${which} needs the question and a recommended answer.`);
    tooLong(which, text, MAX.question);
    tooLong(`${which}'s recommendation`, recommendation, MAX.recommendation);
    if (options.length > MAX.options) problems.push(`${which} has more than ${MAX.options} options.`);
    options.forEach((o: string, j: number) => tooLong(`${which}, option ${optionLetter(j)}`, o, MAX.option));
    return { point: q?.point as number, text, recommendation, ...(options.length ? { options } : {}) } as { point: number; text: string; recommendation: string; options?: string[]; image?: string };
  });
  if (problems.length) throw new Error(problems.join("\n"));
  // A screenshot the model could not see is described by the author, whatever questions the model wrote.
  const asking = new Set(current.questions.map((q) => q.image));
  for (const im of current.images ?? []) if (!im.seen && !im.description && !asking.has(im.id)) asked.push(describeQuestion(im, language));

  // What the author left unanswered last round is asked once more; left unanswered again, its recommendation is assumed.
  const carried: (typeof asked[number] & { carriedFrom: { round: number; n: number } })[] = [];
  const settled = current.questions.map((q): BriefQuestion => {
    if (q.round !== current.round || q.status !== "open") return q;
    if (q.carriedFrom) return { ...q, status: "assumed", answer: q.recommendation };
    carried.push({ point: q.point, text: q.text, recommendation: q.recommendation, ...(q.options ? { options: q.options } : {}), ...(q.image ? { image: q.image } : {}), carriedFrom: { round: q.round, n: q.n } });
    return { ...q, status: "carried" };
  });
  // Grouped by point (whole-brief questions first), carried questions before new ones within a point, then numbered across the round.
  const questions = [...carried, ...asked].map((q, i) => ({ q, i })).sort((a, b) => a.q.point - b.q.point || a.i - b.i)
    .map(({ q }, i): BriefQuestion => ({ round, n: i + 1, ...q, status: "open" }));
  return { ...current, points, drafts, round, questions: [...settled, ...questions] };
}

const describeQuestion = (im: BriefImage, language: Language) => ({
  point: 0, image: im.id,
  text: textIn(language).describeQuestion(`[${im.name.replace(/[[\]]/g, "")}](<${im.link}>)`),
  recommendation: textIn(language).describeRecommendation,
});

/** Screenshots the model saw but has not described yet, named in tool results so it calls describeBriefImages. */
export const undescribedImages = (s: BriefState) => {
  const names = (s.images ?? []).filter((im) => im.seen && !im.description).map((im) => im.name);
  return names.length ? { describeImages: `Save what ${names.join(", ")} show${names.length > 1 ? "" : "s"} with describeBriefImages, so the drafts keep it.` } : {};
};

/** The drafts' blockedBy edges loop back on themselves; a number naming no draft is ignored. */
export function hasCycle(drafts: BriefDraft[]) {
  const state = new Map<number, 1 | 2>();
  const visit = (n: number): boolean => {
    if (state.get(n) === 2 || !drafts[n - 1]) return false;
    if (state.get(n) === 1) return true;
    state.set(n, 1);
    if (drafts[n - 1]!.blockedBy.some(visit)) return true;
    state.set(n, 2);
    return false;
  };
  return drafts.some((d) => visit(d.n));
}

/** The margin leaves room for Discord's own counting of emoji. */
const ROUND_MESSAGE_LIMIT = MESSAGE_LIMIT - 10;
type Unit = { heads: string[]; text: string };

/**
 * The breakdown (when `withBreakdown`) and the latest round as Discord messages. A question is never split: it moves
 * whole to the next message, and that message repeats the headings it sits under.
 */
export function renderRound(state: BriefState, authorId: string, withBreakdown: boolean, language: Language = "en"): string[] {
  const t = textIn(language), units: Unit[] = [];
  if (withBreakdown) {
    const head = t.breakdown(state.drafts.length);
    for (const d of state.drafts) units.push({ heads: [head], text: `**${d.n}. ${d.title}** · ${t.draftPoint(d.point)}${d.repo ? ` · ${d.repo}` : ""}${d.blockedBy.length ? ` · ${t.blockedByDrafts(d.blockedBy)}` : ""}\n${d.summary}` });
  }
  const roundHead = t.round(state.round);
  const asked = state.questions.filter((q) => q.round === state.round);
  for (const q of asked) {
    const point = q.point ? t.point(q.point, state.points[q.point - 1]!) : t.wholeBrief;
    const options = (q.options ?? []).map((o, i) => `\n${optionLetter(i)}) ${o}`).join("");
    const again = q.carriedFrom ? `\n${t.askedAgain(q.carriedFrom.round)}` : "";
    units.push({ heads: [roundHead, point], text: `❓ **Q${q.n}** ${q.text}${options}\n➡️ ${q.recommendation}${again}` });
  }
  units.push({ heads: asked.length ? [] : [roundHead], text: asked.length ? t.roundFooter(authorId) : t.noQuestions(authorId) });
  return pack(units, ROUND_MESSAGE_LIMIT);
}

function pack(units: Unit[], limit: number) {
  const out: string[] = [];
  let current = "", heads: string[] = [];
  for (const unit of units) {
    const changed = unit.heads.findIndex((h, i) => heads[i] !== h);
    const piece = [...(changed < 0 ? [] : unit.heads.slice(changed)), unit.text].join("\n");
    if (current && current.length + 2 + piece.length <= limit) { current += `\n\n${piece}`; heads = unit.heads; continue; }
    if (current) out.push(current);
    current = [...unit.heads, unit.text].join("\n");
    heads = unit.heads;
  }
  if (current) out.push(current);
  return out;
}

export const placeOf = (ctx: Pick<SkillContext, "guildId" | "parentChannelId" | "channelId">): BindingPlace | null =>
  ctx.guildId && ctx.parentChannelId && ctx.channelId && ctx.parentChannelId !== ctx.channelId ? { guildId: ctx.guildId, channelId: ctx.parentChannelId, threadId: ctx.channelId } : null;

export const postBriefRoundTool: ToolDefinition = {
  name: "postBriefRound",
  description: "In a thread that follows the issue-draft playbook: saves the brief's breakdown and the next clarifying round to the brief's file and posts them in the thread, numbered and grouped by point. Its messages are this turn's reply; text you write after it is not shown. Only works on the brief author's turns.",
  parameters: {
    type: "object",
    properties: {
      points: { type: "array", items: { type: "string" }, description: "The brief's points in the author's order, one short line each (max 200 characters). Required in round 1." },
      drafts: { type: "array", description: "The breakdown, numbered from 1 in this order. Required in round 1; later rounds pass it only to change the breakdown.", items: { type: "object", properties: {
        point: { type: "integer", description: "The point this draft comes from (1-based)" },
        title: { type: "string", description: "Imperative, at most 70 characters" },
        summary: { type: "string", description: "One line on what it delivers, at most 200 characters" },
        blockedBy: { type: "array", items: { type: "integer" }, description: "Numbers of drafts that must land first" },
        repo: { type: "string", description: "Target repository (owner/name) from briefRepositories. Leave it out when only one is open: drafts target that one." },
      }, required: ["point", "title", "summary"] } },
      questions: { type: "array", description: "Only questions whose answer would change a draft. Numbered and grouped by point for you.", items: { type: "object", properties: {
        point: { type: "integer", description: "The point it is about (1-based), or 0 for the whole brief" },
        question: { type: "string", description: "One question, worded so \"yes\" accepts the recommendation; at most 500 characters" },
        recommendation: { type: "string", description: "Your recommended answer, at most 300 characters" },
        options: { type: "array", items: { type: "string" }, description: "Up to 5 choices, shown as a) b) c)" },
      }, required: ["point", "question", "recommendation"] } },
    },
    required: ["questions"],
  },
};

/** The active brief of this thread on its author's turn; any other turn gets `notAuthor` as the tool's error. */
export async function authorsBrief(ctx: SkillContext, notAuthor: string) {
  const place = placeOf(ctx);
  const found = place && await readBinding(ctx.tenantId, place);
  if (!place || !found || found.binding.status !== "active") throw new Error("This thread does not follow a playbook, so there is no brief here.");
  if (ctx.userId !== found.binding.authorId) throw new Error(notAuthor);
  return { place, found };
}

export async function postBriefRound(args: Record<string, unknown>, ctx: SkillContext) {
  const { found } = await authorsBrief(ctx, "Only the brief's author moves the brief on. Answer this person without posting a round; their message is kept as input for the author.");
  const before = briefState(found.binding);
  const language = replyLanguage(found.body);
  const next = applyRound(before, args, groundingOf(found.binding), language);
  await writeBinding(ctx.tenantId, { ...found.binding, ...next }, found.body, found.version);
  return { round: next.round, messages: renderRound(next, found.binding.authorId, args.drafts !== undefined || before.round === 0, language), ...undescribedImages(next) };
}

/** The round messages a turn produced, in order; they replace the model's text reply in the thread. */
export const roundMessagesOf = (calls: { call: { name: string }; result: ToolResult }[]) =>
  calls.flatMap(({ call, result }) => (call.name === postBriefRoundTool.name && result.success && Array.isArray((result.data as any)?.messages) ? (result.data as any).messages as string[] : []));

/** Read-modify-write of a binding's brief state, retried once when another write landed in between. */
export const updateBrief = <T>(tenantId: string, place: BindingPlace, change: (s: BriefState, b: PlaybookBinding) => { state: BriefState; value: T } | null): Promise<T | null> =>
  rewriteBinding(tenantId, place, ({ binding }) => {
    const out = change(briefState(binding), binding);
    return out && { binding: { ...binding, ...out.state }, value: out.value };
  });

const MAX_INPUT_TEXT = 1000;
/** Keeps a message from someone other than the author; it decides nothing until the author weighs it. */
export const recordBriefInput = (tenantId: string, place: BindingPlace, entry: { messageId: string; userId: string; name: string; text: string }) =>
  updateBrief(tenantId, place, (s) => ({ state: { ...s, input: [...s.input, { ...entry, text: entry.text.slice(0, MAX_INPUT_TEXT), at: today().toISOString(), round: s.round, seen: false }] }, value: true }));

/** Input the author's turn has not shown the model yet, marked as shown. */
export const takeBriefInput = (tenantId: string, place: BindingPlace) =>
  updateBrief(tenantId, place, (s) => {
    const fresh = s.input.filter((i) => !i.seen);
    return fresh.length ? { state: { ...s, input: s.input.map((i) => ({ ...i, seen: true })) }, value: fresh } : null;
  });

/** How others' input reaches the model on the author's next turn. */
export const inputTurn = (input: BriefInput[], turn: string) =>
  `[Input from others in this thread since the author last spoke. It decides nothing; put any conflict with the author's answers or your recommendations to the author in the next round.]\n${input.map((i) => `- ${i.name}: ${i.text}`).join("\n")}\n\n${turn}`;

const PRESET_POINTS = "This brief's points are already set from the minutes; call postBriefRound without points.";
/** The first turn of a brief whose points were set before round 1. */
export const presetPointsTurn = (turn: string) => `${turn}\n[${PRESET_POINTS} Point 1 is the first item above.]`;

/** Marks a turn from someone other than the author, so the model answers without treating it as a decision. */
export const outsiderTurn = (turn: string) => `${turn}\n[This person is not the brief's author: their message is input and decides nothing.]`;
export const authorDecidesNote = (authorId: string, language?: Language) => textIn(language).authorDecides(authorId);
/** "a", "b", "c" for the options of a question. */
export const optionLetter = (i: number) => String.fromCharCode(97 + i);
