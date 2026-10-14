/**
 * Drives one daily-behaviour fixture at the Discord seam: the clock is pinned, settings, grants, seeded tasks and
 * attachments are put in place, the brief is sent with a mention and the follow-ups in the thread it opened. After
 * every turn the replies and the Workspace and schedule state are recorded, so the checks and the judge read a plain
 * output, live or from `recorded/assistant/`. Database modules load lazily, inside the scenario's subprocess.
 */
import type { Scenario } from "../test/support/discordScenario";
import { checkAssistantOutput, type AssistantFailure } from "./assistantChecks";
import type { AssistantFixture, SeedTask } from "./assistantFixtures";
import { gradeAssistantWithJudge } from "./assistantJudge";
import type { TrialResult } from "./compare";
import type { Ask } from "./judge";
import { usageOf } from "./run";

export interface TaskState { title: string; status: string; dueAt: string | null; /** The Assignee's name. */ assignedTo: string | null; createdByName: string | null }
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

async function seedTasks(s: Scenario, tasks: SeedTask[]) {
  const { render, slug } = await import("../../../packages/skills/src/builtin/tasks.ts");
  const { parseAssignee } = await import("../../../packages/skills/src/builtin/assignee.ts");
  const at = new Date(s.clock.now()).toISOString();
  for (const [i, t] of tasks.entries()) {
    const id = seedId(i);
    await s.workspace.write(`${CHANNEL}/tasks/${slug(t.title)}-${id.slice(0, 8)}.md`, render({ id, title: t.title, description: null, status: (t.status ?? "pending") as any, priority: "medium", assignedTo: parseAssignee(t.assignedTo), dueAt: t.dueAt ?? null, createdBy: s.discord.alice.id, createdByName: s.discord.alice.name, createdAt: at, updatedAt: at }));
  }
}

async function attachmentsOf(s: Scenario, fixture: AssistantFixture) {
  const { attachment } = await import("../test/support/images");
  const { pdf } = await import("../test/support/documents");
  return (fixture.facts.attachments ?? []).map((a) => attachment(s, a.name, pdf(a.pdf), { contentType: "application/pdf" }));
}

async function stateOf(s: Scenario): Promise<AssistantState> {
  const { loadTasks } = await import("../../../packages/skills/src/builtin/tasks.ts");
  const { workspaceStore } = await import("../../../packages/skills/src/workspace/store.ts");
  const { schedules, eq } = await import("../../../packages/db/src/index.ts") as any;
  const lines = async (path: string) => ((await s.workspace.read(path)) ?? "").split("\n").filter((l) => l.trim());
  const tasks = (await loadTasks(workspaceStore(), { tenantId: s.tenant.id, guildId: GUILD, channelId: CHANNEL_ID })).map(({ task: t }) => ({ title: t.title, status: t.status, dueAt: t.dueAt, assignedTo: t.assignedTo?.name ?? null, createdByName: t.createdByName }))
    .sort((a, b) => a.title.localeCompare(b.title));
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
  if (facts.seed?.tasks?.length) await seedTasks(s, facts.seed.tasks);
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
    turns.push({ n: i + 1, message, replies: posted.map(textOf).filter(Boolean), confirm: posted.some((m) => m.components.length > 0), pings: [...new Set(posted.flatMap((m) => m.allowedMentions?.users ?? []))], state: await stateOf(s) });
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
