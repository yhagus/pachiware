/**
 * Drives one daily-behaviour fixture at the Discord seam: the clock is pinned, settings, grants, members, seeded tasks and files
 * (in the brief's channel or another), hidden channels and attachments are put in place, the brief is sent with a mention and the
 * follow-ups in the thread it opened. After every turn the replies and the Workspace and schedule state are recorded,
 * so the checks and the judge read a plain output, live or from `recorded/assistant/`. Database modules load lazily,
 * inside the scenario's subprocess.
 */
import type { Scenario } from "../test/support/discordScenario";
import { checkAssistantOutput, type AssistantFailure } from "./assistantChecks";
import type { AssistantFixture, SeedFile, SeedTask } from "./assistantFixtures";
import { gradeAssistantWithJudge } from "./assistantJudge";
import type { TrialResult } from "./compare";
import type { Ask } from "./judge";
import { usageOf } from "./run";

export interface TaskState {
  title: string; status: string; dueAt: string | null; /** The Assignee's name. */ assignedTo: string | null; createdByName: string | null;
  /** "#launch" for a task outside the brief's channel; absent for the brief's channel. */ channel?: string;
  /** Its Progress note lines, oldest first; absent when it has none. */ notes?: string[];
}
export interface ReminderState { text: string; recurrence: string; weekdays: number[]; timeOfDay: string | null; timezone: string; nextAt: string; status: string; mentions: string[] }
export interface AssistantState { tasks: TaskState[]; memory: { channel: string[]; guild: string[] }; files: string[]; reminders: ReminderState[] }
export interface AssistantTurn {
  n: number; message: string;
  /** What the bot posted during this turn, oldest first. */
  replies: string[];
  confirm: boolean; pings: string[];
  state: AssistantState;
}
export interface AssistantOutput {
  kind: "assistant"; fixture: string; turns: AssistantTurn[];
  /** Reminder posts after the `then` tick. */
  posts: { text: string; pings: string[] }[];
}
export interface AssistantResult extends AssistantOutput { failures: AssistantFailure[]; passed: boolean }

const GUILD = "guild-1", CHANNEL_ID = "channel-1", CHANNEL = `guilds/${GUILD}/channels/${CHANNEL_ID}`, GUILD_SHARED = `guilds/${GUILD}/shared`;
const seedId = (i: number) => `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000000`;

const channelFolder = (channel?: string) => (channel ? `guilds/${GUILD}/channels/${channel.replace(/^#/, "")}` : CHANNEL);

/** The channels of the guild that tasks or files are seeded in besides the brief's, each created in the fake guild; hidden ones lose @everyone's view. */
function seededChannels(s: Scenario, seed: AssistantFixture["facts"]["seed"] = {}) {
  const named = [...(seed.tasks ?? []), ...(seed.files ?? [])].flatMap((t) => (t.channel ? [t.channel.replace(/^#/, "")] : []));
  const ids = [...new Set(named)];
  for (const id of ids) s.discord.channel(id);
  for (const name of seed.hidden ?? []) s.discord.hide(name.replace(/^#/, ""));
  return ids;
}

async function seedFiles(s: Scenario, files: SeedFile[]) {
  for (const f of files) await s.workspace.write(`${channelFolder(f.channel)}/${f.path}`, f.content);
}

async function seedTasks(s: Scenario, tasks: SeedTask[]) {
  const { render, slug } = await import("../../../packages/skills/src/builtin/taskFile.ts");
  const { parseAssignee } = await import("../../../packages/skills/src/builtin/assignee.ts");
  const at = new Date(s.clock.now()).toISOString();
  for (const [i, t] of tasks.entries()) {
    const id = seedId(i), folder = channelFolder(t.channel);
    await s.workspace.write(`${folder}/tasks/${slug(t.title)}-${id.slice(0, 8)}.md`, render({ id, title: t.title, description: null, status: (t.status ?? "pending") as any, priority: "medium", assignedTo: parseAssignee(t.assignedTo), dueAt: t.dueAt ?? null, createdBy: s.discord.alice.id, createdByName: s.discord.alice.name, createdAt: at, updatedAt: at }));
  }
}

async function attachmentsOf(s: Scenario, fixture: AssistantFixture) {
  const { attachment } = await import("../test/support/images");
  const { pdf } = await import("../test/support/documents");
  return (fixture.facts.attachments ?? []).map((a) => attachment(s, a.name, pdf(a.pdf), { contentType: "application/pdf" }));
}

async function stateOf(s: Scenario, channels: string[]): Promise<AssistantState> {
  const { loadTasks, readInFull } = await import("../../../packages/skills/src/builtin/taskFile.ts");
  const { noteLine } = await import("../../../packages/skills/src/builtin/progressNotes.ts");
  const { taskChannelOf } = await import("../../../packages/skills/src/builtin/taskAccess.ts");
  const { workspaceStore } = await import("../../../packages/skills/src/workspace/store.ts");
  const { schedules, eq } = await import("../../../packages/db/src/index.ts") as any;
  const lines = async (path: string) => ((await s.workspace.read(path)) ?? "").split("\n").filter((l) => l.trim());
  const store = workspaceStore(), found = new Map<string, Awaited<ReturnType<typeof loadTasks>>[number]>();
  for (const channelId of [CHANNEL_ID, ...channels]) for (const f of await loadTasks(store, { tenantId: s.tenant.id, guildId: GUILD, channelId })) found.set(f.path, f);
  const full = await readInFull(store, s.tenant.id, [...found.values()]);
  const tasks: TaskState[] = [...found.values()].map(({ path }, i) => {
    const t = full[i]!, channel = taskChannelOf(path)?.channelId, notes = (t.notes ?? []).map(noteLine);
    return { title: t.title, status: t.status, dueAt: t.dueAt, assignedTo: t.assignedTo?.name ?? null, createdByName: t.createdByName, ...(channel && channel !== CHANNEL_ID && { channel: `#${channel}` }), ...(notes.length && { notes }) };
  }).sort((a, b) => a.title.localeCompare(b.title));
  const files = (await s.workspace.list(`${CHANNEL}/files`)).map((p) => p.slice(CHANNEL.length + 1)).filter((p) => !p.split("/").pop()!.startsWith(".")).sort();
  const rows: any[] = await s.db.select().from(schedules).where(eq(schedules.kind, "reminder"));
  const reminders = rows.sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime() || a.text.localeCompare(b.text))
    .map((r) => ({ text: r.text, recurrence: r.recurrence, weekdays: r.weekdays ?? [], timeOfDay: r.timeOfDay ?? null, timezone: r.timezone, nextAt: r.nextAt.toISOString(), status: r.status, mentions: r.mentions ?? [] }));
  return { tasks, memory: { channel: await lines(`${CHANNEL}/MEMORY.md`), guild: await lines(`${GUILD_SHARED}/MEMORY.md`) }, files, reminders };
}

type Message = Scenario["discord"]["botMessages"][number];
const textOf = (m: Message) => [m.content, ...m.embeds.map((e) => `${e.title ?? ""}\n\n${e.description ?? ""}`.trim())].filter(Boolean).join("\n\n");

export async function runAssistantFixture(s: Scenario, fixture: AssistantFixture): Promise<AssistantOutput> {
  const { facts } = fixture;
  s.clock.set(facts.clock);
  if (facts.settings) await s.guildSettings({ timezone: facts.settings.timezone ?? null, language: facts.settings.language ?? null });
  if (facts.grants?.length) s.discord.grant(s.discord.alice, facts.grants);
  // Someone who has posted in the guild is a member its search finds.
  if (facts.members?.length) s.discord.history(facts.members.map((author) => ({ content: "hello", author })), { channel: s.discord.channel("lobby") });
  const channels = seededChannels(s, facts.seed);
  if (facts.seed?.tasks?.length) await seedTasks(s, facts.seed.tasks);
  if (facts.seed?.files?.length) await seedFiles(s, facts.seed.files);
  s.discord.unlimited(s.discord.alice);
  const turns: AssistantTurn[] = [];
  let thread: Message["thread"], seen = s.discord.botMessages.length;
  for (const [i, message] of fixture.messages.entries()) {
    const sent = i === 0
      ? await s.discord.send(`${s.discord.mention} ${message}`, { attachments: await attachmentsOf(s, fixture) })
      : await s.discord.send(message, { channel: thread ?? CHANNEL_ID });
    thread ??= sent.thread;
    const posted = s.discord.botMessages.slice(seen);
    seen = s.discord.botMessages.length;
    turns.push({ n: i + 1, message, replies: posted.map(textOf).filter(Boolean), confirm: posted.some((m) => m.components.length > 0), pings: [...new Set(posted.flatMap((m) => m.allowedMentions?.users ?? []))], state: await stateOf(s, channels) });
  }
  const posts: AssistantOutput["posts"] = [];
  if (facts.then) {
    s.clock.set(facts.then.clock);
    await s.scheduler.tick();
    for (const m of s.discord.botMessages.slice(seen)) posts.push({ text: textOf(m), pings: m.allowedMentions?.users ?? [] });
  }
  return { kind: "assistant", fixture: fixture.name, turns, posts };
}

export function gradeAssistantRun(output: AssistantOutput, fixture: AssistantFixture): AssistantResult {
  const failures = checkAssistantOutput(output, fixture);
  return { ...output, failures, passed: !failures.length };
}

/** One trial: the fixture's run, its code checks, the judge's verdicts, and what the run cost. */
export async function runAssistantTrial(s: Scenario, fixture: AssistantFixture, ask: Ask): Promise<Omit<TrialResult, "profile" | "trial">> {
  const started = Date.now();
  const output = await runAssistantFixture(s, fixture);
  const usage = { ...await usageOf(s), ms: Date.now() - started };
  return { result: await gradeAssistantWithJudge(gradeAssistantRun(output, fixture), fixture, ask), usage };
}
