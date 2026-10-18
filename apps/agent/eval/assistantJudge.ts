/**
 * The judged half of the daily-behaviour eval. The same pinned judge as the issue-draft eval answers one narrow
 * question per criterion, with the conversation, the reference facts and the recorded Workspace state in front of it:
 * per must-cover fact, do the replies convey it; per turn, did the bot act on a clear request or ask one question on an
 * ambiguous one; per turn, is every statement about tasks, Memory, files or Reminders supported.
 */
import type { AssistantFixture } from "./assistantFixtures";
import type { AssistantResult, AssistantState, AssistantTurn } from "./assistantRun";
import { bullets, COVERAGE_BAR, grade, type Ask, type DraftVerdict, type Graded } from "./judge";

/** Bump on any change to this rubric's text or pass rule; separate from the issue-draft rubric, which it leaves untouched. */
export const ASSISTANT_RUBRIC_VERSION = "0.2";

const SYSTEM = `You grade the replies of a Discord bot that works as a server's administrative assistant: it keeps tasks, Memory lines, filed documents and Reminders. Rubric ${ASSISTANT_RUBRIC_VERSION}.
You answer exactly one question about one item. Judge only from the conversation, the reference facts and the recorded state shown; do not assume anything about the bot or the server yourself.
Answer "yes" or "no" when the material settles it, and "unknown" when it does not. Paraphrase counts: a fact is conveyed when a reader of the replies would learn it, whatever the wording or language.
Think it through in a few sentences first. Then end your reply with one line of JSON and nothing after it:
{"reasoning": "<one or two sentences>", "verdict": "yes" | "no" | "unknown"}`;

const stateText = (s: AssistantState) => [
  `Tasks: ${s.tasks.length ? "" : "none"}`, ...s.tasks.flatMap((t) => [
    `- ${t.status} | ${t.dueAt ? `due ${t.dueAt}` : "no due date"} | ${t.assignedTo ?? "unassigned"} | ${t.title} (created by ${t.createdByName ?? "unknown"}${t.channel ? `, in ${t.channel}` : ""})`,
    ...(t.notes ?? []).map((n) => `  Progress note ${n.replace(/^- /, "")}`),
  ]),
  `Channel Memory: ${s.memory.channel.length ? "" : "empty"}`, ...s.memory.channel.map((l) => `  ${l}`),
  `Server Memory: ${s.memory.guild.length ? "" : "empty"}`, ...s.memory.guild.map((l) => `  ${l}`),
  `Files under files/: ${s.files.join(", ") || "none"}`,
  `Reminders: ${s.reminders.length ? "" : "none"}`, ...s.reminders.map((r) => `- ${r.recurrence}${r.weekdays.length ? ` on weekdays ${r.weekdays.join(",")} (0 = Sunday)` : ""}${r.timeOfDay ? ` at ${r.timeOfDay}` : ""} ${r.timezone}, next ${r.nextAt}, ${r.status}, pings ${r.mentions.length ? `the owner and ${r.mentions.join(", ")}` : "the owner only"}: ${r.text}`),
  ...(s.kept?.length ? ["Minutes, Daily logs, Notes and Decisions the bot wrote:", ...s.kept.map((k) => `#### ${k.path}\n${k.text}`)] : []),
].join("\n");

// The author is Alice, who sent the brief; another member's message is headed with their name.
const speaker = (name = "Alice") => (name === "Alice" ? "Author" : name);
const said = (t: AssistantTurn) => (t.authors?.length ?? 1) === 1 ? `${speaker(t.authors?.[0])}: ${t.message}` : t.message.split("\n").map((l, i) => `${speaker(t.authors![i])}: ${l}`).join("\n");
const turnText = (t: AssistantTurn) => `${said(t)}\n${t.replies.length ? t.replies.map((r) => `Bot: ${r}`).join("\n") : "Bot: (no reply)"}`;
const conversation = (f: AssistantFixture, turns: AssistantTurn[], upTo = turns.length) =>
  `## The conversation (the clock is fixed at ${f.facts.clock})\n${turns.slice(0, upTo).map((t) => `### Turn ${t.n}\n${turnText(t)}`).join("\n\n")}`;

const factPrompt = (f: AssistantFixture, r: AssistantResult, fact: string) =>
  `${conversation(f, r.turns)}\n\n## Recorded state at the end\n${stateText(r.turns.at(-1)!.state)}\n\n## Question\nThe bot's replies must convey this fact:\n${fact}\n\nDo the replies, taken together, convey it?`;
const behaviourPrompt = (f: AssistantFixture, r: AssistantResult, t: AssistantTurn) => {
  const ambiguous = f.facts.turns[t.n - 1]?.ambiguous;
  return `${conversation(f, r.turns, t.n)}\n\n## Question\nLook only at turn ${t.n}. ${ambiguous
    ? `The request is ambiguous: ${ambiguous} Did the bot ask exactly one question that names this gap, and refrain from acting? Answer "no" when it acted anyway, asked nothing, asked about something else, or asked more than one question.`
    : "The request is clear. Did the bot act on it without asking a question back? A short line saying what changed is acting; a question instead of acting is not. Answer \"no\" when it asked instead of acting, or when it declined."}`;
};
const supportedPrompt = (f: AssistantFixture, r: AssistantResult, t: AssistantTurn) =>
  `${conversation(f, r.turns, t.n)}\n\n## Recorded state after turn ${t.n}\n${stateText(t.state)}\n\n## Reference facts\n${bullets(f.facts.mustCover)}\n\n## Question\nLook only at the bot's replies in turn ${t.n}. Is every statement they make about tasks, Memory, files or Reminders supported by the recorded state, the reference facts, or the conversation? Answer "no" when a reply claims something the state does not show, such as a task, due date, assignee, Memory line, file or Reminder that is not there.`;

const QUIET: Graded = { reasoning: "A quiet turn: the code checks grade it.", verdict: "yes" };

export interface AssistantJudgement {
  facts: ({ fact: string } & Graded)[];
  turns: { n: number; behaviour: Graded; supported: Graded }[];
}
export interface AssistantJudged extends AssistantResult {
  judged: AssistantJudgement;
  /** Share of must-cover facts judged conveyed; unknown counts as not conveyed. */
  coverage: number;
  /** Share of turns where the bot asked or acted as the request called for. Reported, never a gate on its own. */
  questionRate: number | null;
  verdicts: DraftVerdict[];
  /** Replaces the code-only `passed`: every turn passed. */
  passed: boolean;
}

/** Judges a run already graded by code, then applies the pass rule per turn: every code check, coverage at the bar, acted or asked as called for, nothing unsupported. */
export async function gradeAssistantWithJudge(result: AssistantResult, fixture: AssistantFixture, ask: Ask): Promise<AssistantJudged> {
  const turns = result.turns, mustCover = fixture.facts.mustCover;
  const [facts, judgedTurns] = await Promise.all([
    Promise.all(mustCover.map(async (fact) => ({ fact, ...(turns.length ? await grade(ask, factPrompt(fixture, result, fact), SYSTEM) : { reasoning: "The bot never replied.", verdict: "no" as const }) }))),
    // A quiet turn says nothing to judge: code checks that the bot posted nothing and reacted as asked.
    Promise.all(turns.map(async (t) => (fixture.facts.turns[t.n - 1]?.quiet ? { n: t.n, behaviour: QUIET, supported: QUIET }
      : { n: t.n, behaviour: await grade(ask, behaviourPrompt(fixture, result, t), SYSTEM), supported: await grade(ask, supportedPrompt(fixture, result, t), SYSTEM) }))),
  ]);
  const covered = facts.filter((f) => f.verdict === "yes").length, coverage = mustCover.length ? covered / mustCover.length : 0;
  const missing = facts.filter((f) => f.verdict !== "yes").map((f) => `${f.fact} (${f.reasoning})`).join("; ");
  const coverageReason = coverage < COVERAGE_BAR ? `coverage: ${covered} of ${facts.length} must-cover facts conveyed, under ${COVERAGE_BAR * 100}%. Missing: ${missing}` : null;
  const verdicts = fixture.facts.turns.map((_, i): DraftVerdict => {
    const n = i + 1, reasons = result.failures.filter((f) => f.turn === n).map((f) => `${f.check}: ${f.message}`);
    if (coverageReason) reasons.push(coverageReason);
    const judged = judgedTurns.find((j) => j.n === n);
    if (judged?.behaviour.verdict === "no") reasons.push(`${fixture.facts.turns[i]?.ambiguous ? "acted" : "asked"}: ${judged.behaviour.reasoning}`);
    if (judged?.supported.verdict === "no") reasons.push(`unsupported: ${judged.supported.reasoning}`);
    return { n, label: `turn ${n}`, passed: !reasons.length, reasons };
  });
  return {
    ...result, judged: { facts, turns: judgedTurns }, coverage,
    questionRate: judgedTurns.length ? judgedTurns.filter((t) => t.behaviour.verdict === "yes").length / judgedTurns.length : null,
    verdicts, passed: verdicts.length > 0 && verdicts.every((v) => v.passed),
  };
}
