/**
 * Daily-behaviour fixtures, one folder per brief under `assistant/`: `brief.md` (the first message, sent with a
 * mention), `follow-ups.md` (later messages, split on `---` lines, sent in the thread the bot opened; a block headed
 * `@<member>:` is that member's, and one headed `@<a>+@<b>:` is a burst of one line each), and `facts.yaml`:
 * the Rapor area, the fixed clock, settings, grants and members, anything to seed (talk, tasks, files, in the brief's channel or another) or attach, the must-cover facts, one `turns` entry per message
 * with the Workspace and schedule state expected after it, and `then`, a scheduler tick after the conversation.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TIMEZONE } from "../../../packages/skills/src/clock";
import type { Language } from "../../../packages/skills/src/language";
import { EVAL_DIR } from "./repository";

export interface ExpectedTask {
  /** A phrase the title contains, case-insensitive. */ title: string; status?: string; dueAt?: string | null; assignedTo?: string | null; createdByName?: string;
  /** The channel of a task outside the brief's channel, such as "#launch"; null for the brief's channel. */ channel?: string | null;
  /** Phrases its Progress notes contain, each in some note; an empty list means no note at all. */ notes?: string[];
}
export interface MemoryFacts { has?: string[]; lacks?: string[] }
export interface ExpectedReminder { text?: string; recurrence: string; weekdays?: number[]; timeOfDay?: string; nextAt: string; mentions?: string[] }
export interface TurnFacts {
  /** What the bot must ask about: the request is ambiguous, so nothing may change. */
  ambiguous?: string;
  /** Every task after this turn: the brief's channel's, plus those of the channels `seed.tasks` names. */
  tasks?: ExpectedTask[];
  memory?: { channel?: MemoryFacts; guild?: MemoryFacts };
  /** Every file under the channel's files/ after this turn. */
  files?: string[];
  /** Every Reminder row after this turn. */
  reminders?: ExpectedReminder[];
  replyContains?: string[];
  replyLacks?: string[];
  /** The reply lists tasks, so one line at least is in the fixed format. */
  taskList?: boolean;
  /** The reply links each of these seeded messages, by index in `seed.messages`. */
  cites?: number[];
  /** Phrases each held by a Minutes or Daily log the bot wrote in the brief's channel. */
  kept?: string[];
}
/** A message of the channel's talk before the brief, posted without the bot seeing it arrive. */
export interface SeedMessage {
  /** Another channel of the guild, by name (it is created); the brief's channel when left out. */ channel?: string;
  /** Alice, Bob or one of `members`, by display name. */ author: string;
  text: string;
  /** An ISO time, or a number of minutes before `clock`. */ at: string | number;
  /** The index of the earlier seeded message, in the same channel, it replies to. */ replyTo?: number;
}
export interface SeedTask {
  title: string; status?: string; dueAt?: string | null; assignedTo?: string | null;
  /** Another channel of the guild to file it in, by name (it is created); the brief's channel when left out. */ channel?: string;
}
export interface SeedFile {
  /** Below the channel's folder, e.g. "minutes/2026-10-07-launch-sync.md". */ path: string;
  content: string;
  /** Another channel of the guild to keep it in, by name (it is created); the brief's channel when left out. */ channel?: string;
}
export interface SeedPullRequest { repo: string; number: number; title: string; /** Absent for a pull request still open. */ mergedAt?: string }
/** A GitHub account whose Git scope opens `repos` (patterns such as "acme/*") in the guild, holding these pull requests. */
export interface SeedGit { repos: string[]; pullRequests?: SeedPullRequest[] }
/** The Rapor's areas: Minutes, Daily logs and Documents; finding what was kept; Tasks and project work; several people at once; the agent loop itself. */
export const AREAS = ["capture", "recall", "tasks", "group", "loop"] as const;
export type Area = (typeof AREAS)[number];
export interface AssistantFacts {
  language: Language;
  /** The Rapor area the brief scores in. */
  area: Area;
  /** The instant the conversation starts at. */
  clock: string;
  settings?: { timezone?: string; language?: Language };
  /** Guild permissions the author holds, discord.js names. */
  grants?: string[];
  /** Guild members besides Alice and Bob; `name` is the display name, `username` defaults to it. */
  members?: { id: string; name: string; username?: string }[];
  /** `hidden` names channels the guild's @everyone cannot view, so they are no Public channel; the author still can. */
  seed?: { messages?: SeedMessage[]; tasks?: SeedTask[]; files?: SeedFile[]; hidden?: string[]; git?: SeedGit };
  /** Attached to the brief; `pdf` lines become a real one-page PDF. */
  attachments?: { name: string; pdf: string[] }[];
  mustCover: string[];
  turns: TurnFacts[];
  /**
   * `dailyLog`: the day whose Daily log of the brief's channel the bot writes from the seeded talk before the brief is sent.
   * `clock` and `posts`: the instant the scheduler ticks once after the conversation, and the Reminder posts expected then.
   */
  then?: { dailyLog?: string; clock?: string; posts?: { contains: string; pings: string[] }[] };
}
/** `authors` names who sends each message: Alice, unless a follow-up block names someone; a burst names one per line of its message. */
export interface AssistantFixture { name: string; messages: string[]; authors?: string[][]; facts: AssistantFacts }

const strings = (value: unknown, where: string) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new Error(`${where} must be a list of strings`);
  return value as string[];
};

/** Who a brief may name as a speaker: the harness's Alice and Bob, and its own members. */
const memberNames = (facts: { members?: { name: string }[] }) => ["Alice", "Bob", ...(facts.members ?? []).map((m) => m.name)];
const bare = (channel?: string) => (channel ?? "").replace(/^#/, "");
/** When a seeded message was posted: its ISO time, or that many minutes before the clock. */
export const seedTime = (at: string | number, clock: string) => (typeof at === "number" ? Date.parse(clock) - at * 60_000 : Date.parse(at));
/** The place's zone, which says what day a message was posted on. */
export const zoneOf = (facts: Pick<AssistantFacts, "settings">) => facts.settings?.timezone ?? DEFAULT_TIMEZONE;
const dayIn = (zone: string, at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const HEAD = /^@([^\n:]+):[ \t]*/;
function spoken(name: string, block: string, n: number, members: string[]) {
  const head = HEAD.exec(block);
  if (!head) return { text: block, authors: ["Alice"] };
  const authors = head[1]!.split("+").map((a) => a.trim().replace(/^@/, "")), text = block.slice(head[0].length).trim();
  for (const a of authors) if (!members.includes(a)) throw new Error(`Fixture ${name}: follow-up ${n} is spoken by ${a}, who is no member`);
  if (!text) throw new Error(`Fixture ${name}: follow-up ${n} says nothing`);
  if (authors.length === 1) return { text, authors };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length !== authors.length) throw new Error(`Fixture ${name}: follow-up ${n} is a burst of ${authors.length} people but has ${lines.length} lines`);
  return { text: lines.join("\n"), authors };
}

function checkTalk(name: string, raw: any) {
  const talk = raw.seed?.messages;
  if (talk === undefined) return;
  if (!Array.isArray(talk)) throw new Error(`Fixture ${name}: seed.messages is a list`);
  const members = memberNames(raw), clock = Date.parse(raw.clock);
  let last = -Infinity;
  talk.forEach((m: any, i: number) => {
    const at = typeof m?.at === "number" || typeof m?.at === "string" ? seedTime(m.at, raw.clock) : NaN;
    if (typeof m?.text !== "string" || !m.text.trim() || Number.isNaN(at)) throw new Error(`Fixture ${name}: seed.messages[${i}] needs a text and an at, an ISO time or minutes before the clock`);
    if (!members.includes(m.author)) throw new Error(`Fixture ${name}: seed.messages[${i}] is from ${m.author}, who is no member`);
    if (m.replyTo !== undefined && (!Number.isInteger(m.replyTo) || m.replyTo < 0 || m.replyTo >= i)) throw new Error(`Fixture ${name}: seed.messages[${i}] replies to ${m.replyTo}, which is no earlier seeded message`);
    if (m.replyTo !== undefined && bare(talk[m.replyTo].channel) !== bare(m.channel)) throw new Error(`Fixture ${name}: seed.messages[${i}] replies to ${m.replyTo}, in another channel`);
    if (at < last || at > clock) throw new Error(`Fixture ${name}: seed.messages are listed oldest first, none after the clock`);
    last = at;
  });
}

export function loadAssistantFixtures(dir = join(EVAL_DIR, "assistant")): AssistantFixture[] {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().map((name) => {
    const file = (f: string, required = true) => {
      const path = join(dir, name, f);
      if (!existsSync(path)) { if (required) throw new Error(`Fixture ${name} has no ${f}`); return ""; }
      return readFileSync(path, "utf8");
    };
    const raw = Bun.YAML.parse(file("facts.yaml")) as any;
    if (raw?.language !== "en" && raw?.language !== "id") throw new Error(`Fixture ${name}: facts.yaml language is en or id`);
    if (!AREAS.includes(raw.area)) throw new Error(`Fixture ${name}: facts.yaml area is ${AREAS.slice(0, -1).join(", ")} or ${AREAS.at(-1)}`);
    if (typeof raw.clock !== "string" || Number.isNaN(Date.parse(raw.clock))) throw new Error(`Fixture ${name}: clock is not a time`);
    const brief = file("brief.md").trim();
    if (!brief) throw new Error(`Fixture ${name} has an empty brief`);
    const followUps = file("follow-ups.md", false).split(/^---$/m).map((m) => m.trim()).filter(Boolean).map((block, i) => spoken(name, block, i + 1, memberNames(raw)));
    const messages = [brief, ...followUps.map((f) => f.text)], authors = [["Alice"], ...followUps.map((f) => f.authors)];
    if (!Array.isArray(raw.turns) || raw.turns.some((t: unknown) => typeof t !== "object" || t === null)) throw new Error(`Fixture ${name}: turns is a list of one entry per message`);
    if (raw.turns.length !== messages.length) throw new Error(`Fixture ${name} has ${messages.length} messages but ${raw.turns.length} turns`);
    const mustCover = strings(raw.mustCover, `${name} mustCover`) ?? [];
    if (!mustCover.length) throw new Error(`Fixture ${name} names no must-cover fact`);
    for (const [i, t] of (raw.turns as any[]).entries()) {
      for (const key of ["replyContains", "replyLacks", "files", "kept"]) strings(t[key], `${name} turn ${i + 1} ${key}`);
      for (const c of t.cites ?? []) if (!Number.isInteger(c) || !raw.seed?.messages?.[c]) throw new Error(`Fixture ${name}: turn ${i + 1} cites ${c}, which is no seeded message`);
    }
    strings(raw.seed?.hidden, `${name} seed.hidden`);
    checkTalk(name, raw);
    if (raw.seed?.git && !strings(raw.seed.git.repos, `${name} seed.git.repos`)?.length) throw new Error(`Fixture ${name}: seed.git needs the repository patterns its Git scope opens`);
    for (const f of raw.seed?.files ?? []) if (typeof f?.path !== "string" || typeof f.content !== "string" || f.path.startsWith("/") || f.path.split("/").includes("..")) throw new Error(`Fixture ${name}: each seed file needs a path below its channel's folder and a content`);
    const then = raw.then;
    if (then && (then.clock !== undefined || then.posts !== undefined) && (typeof then.clock !== "string" || Number.isNaN(Date.parse(then.clock)) || !Array.isArray(then.posts))) throw new Error(`Fixture ${name}: then needs a clock and a list of posts`);
    if (then?.dailyLog !== undefined) {
      if (typeof then.dailyLog !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(then.dailyLog)) throw new Error(`Fixture ${name}: then.dailyLog is a day, such as 2026-10-13`);
      const zone = zoneOf(raw);
      if (!(raw.seed?.messages ?? []).some((m: SeedMessage) => !bare(m.channel) && dayIn(zone, seedTime(m.at, raw.clock)) === then.dailyLog)) throw new Error(`Fixture ${name}: then.dailyLog ${then.dailyLog} has no seeded talk in the brief's channel that day`);
    }
    const facts: AssistantFacts = { language: raw.language, area: raw.area, clock: raw.clock, settings: raw.settings, grants: strings(raw.grants, `${name} grants`), members: raw.members, seed: raw.seed, attachments: raw.attachments, mustCover, turns: raw.turns, then: raw.then };
    return { name, messages, authors, facts };
  });
}
