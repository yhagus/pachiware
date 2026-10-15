/**
 * Daily-behaviour fixtures, one folder per brief under `assistant/`: `brief.md` (the first message, sent with a
 * mention), `follow-ups.md` (later messages, split on `---` lines, sent in the thread the bot opened), and `facts.yaml`:
 * the fixed clock, settings, grants and members, anything to seed (in the brief's channel or another) or attach, the must-cover facts, one `turns` entry per message
 * with the Workspace and schedule state expected after it, and `then`, a scheduler tick after the conversation.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
export interface AssistantFacts {
  language: Language;
  /** The instant the conversation starts at. */
  clock: string;
  settings?: { timezone?: string; language?: Language };
  /** Guild permissions the author holds, discord.js names. */
  grants?: string[];
  /** Guild members besides Alice and Bob; `name` is the display name, `username` defaults to it. */
  members?: { id: string; name: string; username?: string }[];
  /** `hidden` names channels the guild's @everyone cannot view, so they are no Public channel; the author still can. */
  seed?: { tasks?: SeedTask[]; files?: SeedFile[]; hidden?: string[] };
  /** Attached to the brief; `pdf` lines become a real one-page PDF. */
  attachments?: { name: string; pdf: string[] }[];
  mustCover: string[];
  turns: TurnFacts[];
  then?: { clock: string; posts: { contains: string; pings: string[] }[] };
}
export interface AssistantFixture { name: string; messages: string[]; facts: AssistantFacts }

const strings = (value: unknown, where: string) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new Error(`${where} must be a list of strings`);
  return value as string[];
};

export function loadAssistantFixtures(dir = join(EVAL_DIR, "assistant")): AssistantFixture[] {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().map((name) => {
    const file = (f: string, required = true) => {
      const path = join(dir, name, f);
      if (!existsSync(path)) { if (required) throw new Error(`Fixture ${name} has no ${f}`); return ""; }
      return readFileSync(path, "utf8");
    };
    const raw = Bun.YAML.parse(file("facts.yaml")) as any;
    if (raw?.language !== "en" && raw?.language !== "id") throw new Error(`Fixture ${name}: facts.yaml language is en or id`);
    if (typeof raw.clock !== "string" || Number.isNaN(Date.parse(raw.clock))) throw new Error(`Fixture ${name}: clock is not a time`);
    const brief = file("brief.md").trim();
    if (!brief) throw new Error(`Fixture ${name} has an empty brief`);
    const messages = [brief, ...file("follow-ups.md", false).split(/^---$/m).map((m) => m.trim()).filter(Boolean)];
    if (!Array.isArray(raw.turns) || raw.turns.some((t: unknown) => typeof t !== "object" || t === null)) throw new Error(`Fixture ${name}: turns is a list of one entry per message`);
    if (raw.turns.length !== messages.length) throw new Error(`Fixture ${name} has ${messages.length} messages but ${raw.turns.length} turns`);
    const mustCover = strings(raw.mustCover, `${name} mustCover`) ?? [];
    if (!mustCover.length) throw new Error(`Fixture ${name} names no must-cover fact`);
    for (const [i, t] of (raw.turns as any[]).entries()) { strings(t.replyContains, `${name} turn ${i + 1} replyContains`); strings(t.replyLacks, `${name} turn ${i + 1} replyLacks`); strings(t.files, `${name} turn ${i + 1} files`); }
    strings(raw.seed?.hidden, `${name} seed.hidden`);
    for (const f of raw.seed?.files ?? []) if (typeof f?.path !== "string" || typeof f.content !== "string" || f.path.startsWith("/") || f.path.split("/").includes("..")) throw new Error(`Fixture ${name}: each seed file needs a path below its channel's folder and a content`);
    if (raw.then && (typeof raw.then.clock !== "string" || Number.isNaN(Date.parse(raw.then.clock)) || !Array.isArray(raw.then.posts))) throw new Error(`Fixture ${name}: then needs a clock and a list of posts`);
    const facts: AssistantFacts = { language: raw.language, clock: raw.clock, settings: raw.settings, grants: strings(raw.grants, `${name} grants`), members: raw.members, seed: raw.seed, attachments: raw.attachments, mustCover, turns: raw.turns, then: raw.then };
    return { name, messages, facts };
  });
}
