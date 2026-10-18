/**
 * The code checks of the daily-behaviour eval: pure functions over a recorded conversation, each turn's replies
 * and the Workspace and schedule state after it, against the fixture's facts. They grade live runs and the recorded
 * dry runs in CI alike.
 */
import { languageOf, type Language } from "../../../packages/skills/src/language";
import { fillerIn } from "../src/discord/replyStyle";
import type { AssistantFixture, ExpectedReminder, ExpectedTask, MemoryFacts, TurnFacts } from "./assistantFixtures";
import type { AssistantOutput, AssistantState, AssistantTurn } from "./assistantRun";

export type AssistantCheck = "reply" | "confirm" | "pings" | "acted" | "tasks" | "memory" | "files" | "reminders" | "kept" | "format" | "filler" | "language" | "posts" | "citations";
export interface AssistantFailure { turn: number; check: AssistantCheck; message: string }

const LANGUAGE_NAMES: Record<Language, string> = { en: "English", id: "Indonesian" };
const has = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (v: unknown) => (v === null || v === undefined ? "unassigned" : Array.isArray(v) ? v.join(", ") || "none" : String(v));
const TASK_LINE = /^[^|\n]+\|[^|\n]+\|[^|\n]+\|\s*[0-9a-f]{8}\s*\|[^|\n]+$/m;

function taskFailures(expected: ExpectedTask[], tasks: AssistantState["tasks"]): string[] {
  const out: string[] = [];
  if (tasks.length !== expected.length) out.push(`${tasks.length} tasks exist, expected ${expected.length}.`);
  for (const e of expected) {
    const task = tasks.find((t) => has(t.title, e.title));
    if (!task) { out.push(`No task whose title contains "${e.title}"; found: ${tasks.map((t) => t.title).join(", ") || "none"}.`); continue; }
    const field = (name: "status" | "dueAt" | "assignedTo" | "createdByName", equal = (a: unknown, b: unknown) => a === b) => {
      if (e[name] !== undefined && !equal(task[name], e[name])) out.push(`Task "${task.title}": ${name} is ${show(task[name])}, expected ${show(e[name])}.`);
    };
    field("status"); field("dueAt"); field("createdByName");
    field("assignedTo", (a, b) => (a ?? null) === (b ?? null) || (typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase()));
    if (e.channel !== undefined && (task.channel ?? null) !== (e.channel ?? null)) out.push(`Task "${task.title}": channel is ${task.channel ?? "this channel"}, expected ${e.channel ?? "this channel"}.`);
    const notes = task.notes ?? [];
    if (e.notes?.length === 0 && notes.length) out.push(`Task "${task.title}": has ${notes.length} Progress note${notes.length === 1 ? "" : "s"}, expected none.`);
    for (const phrase of e.notes ?? []) if (!notes.some((n) => has(n, phrase))) out.push(`Task "${task.title}": no Progress note contains "${phrase}"; notes: ${notes.join(" / ") || "none"}.`);
  }
  return out;
}

function memoryFailures(level: string, facts: MemoryFacts, lines: string[]): string[] {
  const out: string[] = [];
  for (const text of facts.has ?? []) if (!lines.some((l) => has(l, text))) out.push(`${level} Memory has no line containing "${text}".`);
  for (const text of facts.lacks ?? []) if (lines.some((l) => has(l, text))) out.push(`${level} Memory has a line containing "${text}".`);
  return out;
}

function reminderFailures(expected: ExpectedReminder[], reminders: AssistantState["reminders"]): string[] {
  const out: string[] = [];
  if (reminders.length !== expected.length) out.push(`${reminders.length} Reminder rows exist, expected ${expected.length}.`);
  expected.forEach((e, i) => {
    const row = reminders[i];
    if (!row) return;
    const name = `Reminder "${row.text}"`;
    if (e.text !== undefined && !has(row.text, e.text)) out.push(`${name}: text does not contain "${e.text}".`);
    for (const key of ["recurrence", "weekdays", "timeOfDay", "nextAt", "mentions"] as const) {
      if (e[key] !== undefined && !same(row[key], e[key])) out.push(`${name}: ${key} is ${show(row[key])}, expected ${show(e[key])}.`);
    }
  });
  return out;
}

function replyFailures(facts: TurnFacts, replies: string[]): string[] {
  const out: string[] = [], text = replies.join("\n");
  for (const needle of facts.replyContains ?? []) if (!has(text, needle)) out.push(`The reply does not mention "${needle}".`);
  for (const needle of facts.replyLacks ?? []) if (has(text, needle)) out.push(`The reply mentions "${needle}".`);
  if (facts.taskList && !TASK_LINE.test(text)) out.push("No line in the fixed task format (status | due | assignee | id | title).");
  return out;
}

/** Every code check one turn fails, given the state the turn before left; empty when it passes. */
export function checkTurn(turn: AssistantTurn, facts: TurnFacts, before: AssistantState | null, language: Language): AssistantFailure[] {
  const out: AssistantFailure[] = [];
  const fail = (check: AssistantCheck, messages: string[]) => { for (const message of messages) out.push({ turn: turn.n, check, message }); };
  if (!turn.replies.length) fail("reply", ["The bot did not reply."]);
  if (turn.confirm) fail("confirm", ["A Confirm button was offered; nothing here needs one."]);
  if (turn.pings.length) fail("pings", [`The reply pinged ${turn.pings.join(", ")}; only a Reminder post pings.`]);
  if (facts.ambiguous && before && !same(turn.state, before)) fail("acted", ["The request was ambiguous, but the Workspace changed."]);
  if (facts.tasks) fail("tasks", taskFailures(facts.tasks, turn.state.tasks));
  for (const level of ["channel", "guild"] as const) if (facts.memory?.[level]) fail("memory", memoryFailures(level, facts.memory[level]!, turn.state.memory[level]));
  if (facts.files && !same([...turn.state.files].sort(), [...facts.files].sort())) fail("files", [`files/ holds ${turn.state.files.join(", ") || "nothing"}, expected ${facts.files.join(", ") || "nothing"}.`]);
  if (facts.reminders) fail("reminders", reminderFailures(facts.reminders, turn.state.reminders));
  const kept = turn.state.kept ?? [];
  fail("kept", (facts.kept ?? []).filter((p) => !kept.some((k) => has(k.text, p))).map((p) => `No Minutes or Daily log the bot wrote holds "${p}"; it wrote ${kept.map((k) => k.path).join(", ") || "none"}.`));
  fail("format", replyFailures(facts, turn.replies));
  for (const reply of turn.replies) fail("filler", fillerIn(reply).map((line) => `Filler: "${line}"`));
  for (const reply of turn.replies) {
    const read = languageOf(reply);
    if (read !== "unknown" && read !== language) fail("language", [`The reply reads as ${LANGUAGE_NAMES[read]}; the brief is in ${LANGUAGE_NAMES[language]}.`]);
  }
  return out;
}

/**
 * The links a reply may hold for this fixture, besides its seeded talk's: those written in its seeded files, the posted message of each seeded Minutes
 * (from the guildId, postedIn and messageId at its top), and each seeded pull request's. Anything else was made up.
 */
function seedLinks(fixture: AssistantFixture): string {
  const files = fixture.facts.seed?.files ?? [], prs = fixture.facts.seed?.git?.pullRequests ?? [];
  const field = (text: string, key: string) => text.match(new RegExp(`^${key}: "?([^"\\n]+)"?$`, "m"))?.[1];
  const minutes = files.flatMap((f) => {
    const guild = field(f.content, "guildId"), posted = field(f.content, "postedIn"), message = field(f.content, "messageId");
    return guild && posted && message ? [`https://discord.com/channels/${guild}/${posted}/${message}`] : [];
  });
  return [...files.map((f) => f.content), ...minutes, ...prs.map((p) => `https://github.com/${p.repo}/pull/${p.number}`)].join("\n");
}

/** A ref the bot left unrendered ("[K1]"), and every link that is not in the seed. */
export function citationFailures(reply: string, links: string): string[] {
  const refs = reply.match(/\[[KTGP]\d+\]/g) ?? [];
  const made = (reply.match(/https?:\/\/[^\s<>)\]]+/g) ?? []).map((u) => u.replace(/[.,;:!?'"]+$/, "")).filter((u) => !links.includes(u));
  return [...refs.map((r) => `The reply leaves the ref ${r} unrendered.`), ...made.map((u) => `The reply links ${u}, which nothing seeded holds.`)];
}

/** The checks over a whole run: every turn the facts name, then the Reminder posts after the tick, charged to the last turn. */
export function checkAssistantOutput(output: AssistantOutput, fixture: AssistantFixture): AssistantFailure[] {
  const out: AssistantFailure[] = [];
  const turns = fixture.facts.turns, last = turns.length, talk = output.seeded ?? [], links = [seedLinks(fixture), ...talk].join("\n");
  turns.forEach((facts, i) => {
    const turn = output.turns.find((t) => t.n === i + 1);
    if (!turn) { out.push({ turn: i + 1, check: "reply", message: "The bot did not reply." }); return; }
    out.push(...checkTurn(turn, facts, output.turns.find((t) => t.n === i)?.state ?? null, fixture.facts.language));
    const cite = (message: string) => out.push({ turn: turn.n, check: "citations", message });
    for (const c of facts.cites ?? []) if (!talk[c] || !turn.replies.some((r) => r.includes(talk[c]!))) cite(`The reply does not link seeded message ${c}, ${talk[c] ?? "which was never posted"}.`);
    for (const reply of turn.replies) for (const message of citationFailures(reply, links)) cite(message);
  });
  const then = fixture.facts.then;
  if (then) {
    const fail = (message: string) => out.push({ turn: last, check: "posts", message });
    if (output.posts.length !== then.posts.length) fail(`${output.posts.length} Reminder posts after the tick, expected ${then.posts.length}.`);
    then.posts.forEach((e, i) => {
      const post = output.posts[i];
      if (!post) return;
      if (!has(post.text, e.contains)) fail(`Post ${i + 1} does not say "${e.contains}": ${post.text}`);
      if (!same([...post.pings].sort(), [...e.pings].sort())) fail(`Post ${i + 1} pings ${post.pings.join(", ") || "nobody"}, expected ${e.pings.join(", ") || "nobody"}.`);
    });
  }
  return out;
}
