/**
 * Drives one daily-behaviour fixture at the Discord seam: the clock is pinned, settings, grants, members, seeded talk, tasks and files
 * (in the brief's channel or another), hidden channels and attachments are put in place, the brief is sent with a mention and the
 * follow-ups in the thread it opened, each by the member it names. After every turn the replies and the Workspace and schedule state are recorded,
 * so the checks and the judge read a plain output, live or from `recorded/assistant/`. Database modules load lazily,
 * inside the scenario's subprocess.
 */
import type { FakeUser, Scenario } from "../test/support/discordScenario";
import { checkAssistantOutput, type AssistantFailure } from "./assistantChecks";
import { seedTime, zoneOf, type AssistantFacts, type AssistantFixture, type SeedFile, type SeedGit, type SeedPullRequest, type SeedTask } from "./assistantFixtures";
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
/** A Minutes or Daily log the bot wrote in the brief's channel: its path below the channel's folder, and its text without the fields at its top. */
export interface KeptState { path: string; text: string }
export interface AssistantState {
  tasks: TaskState[]; memory: { channel: string[]; guild: string[] }; files: string[]; reminders: ReminderState[];
  /** Absent when the bot wrote none. */ kept?: KeptState[];
}
export interface AssistantTurn {
  n: number; message: string;
  /** Who sent it, when not Alice: one name, or a burst's, one per line of `message`. */
  authors?: string[];
  /** What the bot posted during this turn, oldest first. */
  replies: string[];
  /** The reactions the bot left on this turn's messages; absent when none. */
  reactions?: string[];
  confirm: boolean; pings: string[];
  state: AssistantState;
}
export interface AssistantOutput {
  kind: "assistant"; fixture: string;
  /** The link of each `seed.messages` entry, in order; absent when the brief seeds no talk. */
  seeded?: string[];
  /** How writing the Daily log `then.dailyLog` names went, before the brief: "written", or why not. */
  dailyLog?: string;
  turns: AssistantTurn[];
  /** Reminder posts after the `then` tick. */
  posts: { text: string; pings: string[] }[];
}
export interface AssistantResult extends AssistantOutput { failures: AssistantFailure[]; passed: boolean }

const GUILD = "guild-1", CHANNEL_ID = "channel-1", CHANNEL = `guilds/${GUILD}/channels/${CHANNEL_ID}`, GUILD_SHARED = `guilds/${GUILD}/shared`;
const seedId = (i: number) => `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000000`;

const channelFolder = (channel?: string) => (channel ? `guilds/${GUILD}/channels/${channel.replace(/^#/, "")}` : CHANNEL);

/** The channels of the guild that talk, tasks or files are seeded in besides the brief's, each created in the fake guild; hidden ones lose @everyone's view. */
function seededChannels(s: Scenario, seed: AssistantFixture["facts"]["seed"] = {}) {
  const named = [...(seed.messages ?? []), ...(seed.tasks ?? []), ...(seed.files ?? [])].flatMap((t) => (t.channel ? [t.channel.replace(/^#/, "")] : []));
  const ids = [...new Set(named)];
  for (const id of ids) s.discord.channel(id);
  for (const name of seed.hidden ?? []) s.discord.hide(name.replace(/^#/, ""));
  return ids;
}

/** Alice, Bob, or the fixture's member of that display name. */
function memberNamed(s: Scenario, facts: AssistantFacts, name: string): FakeUser {
  const found = name === "Alice" ? s.discord.alice : name === "Bob" ? s.discord.bob : facts.members?.find((m) => m.name === name);
  if (!found) throw new Error(`No member named ${name}`);
  return found;
}

/** The channel's talk, oldest first at its times, as history the bot never saw arrive; resolves to each message's link. */
function seedTalk(s: Scenario, facts: AssistantFacts): string[] {
  const posted: Message[] = [];
  for (const m of facts.seed?.messages ?? []) {
    const [message] = s.discord.history([{ content: m.text, author: memberNamed(s, facts, m.author), at: seedTime(m.at, facts.clock), replyTo: m.replyTo === undefined ? undefined : posted[m.replyTo] }], { channel: m.channel?.replace(/^#/, "") ?? CHANNEL_ID });
    posted.push(message!);
  }
  return posted.map((m) => m.url);
}

/** The brief's channel's Daily log of `day`, written from its talk with the bot's own profile, as the overnight run would. */
async function writeDay(s: Scenario, facts: AssistantFacts, day: string): Promise<string> {
  const { writeDailyLog } = await import("../src/discord/dailyLog.ts");
  const { discordBotManager } = await import("../src/discord/client.ts");
  const adapter = discordBotManager.adapterOf(s.bot.id, GUILD);
  if (!adapter) return "the bot is not connected";
  return writeDailyLog({ tenantId: s.tenant.id, botId: s.bot.id, guildId: GUILD, channelId: CHANNEL_ID, channelName: CHANNEL_ID, timezone: zoneOf(facts), day, adapter }).catch((e) => `failed: ${e instanceof Error ? e.message : String(e)}`);
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

/**
 * GitHub as far as finding work needs it: the account's repositories, its issue search (every word of the query in a pull request's
 * title, within the `repo:` named), and pull request lists; any other repository read finds nothing.
 */
async function seedGit(s: Scenario, git: SeedGit) {
  await s.git({ provider: "github", repos: git.repos });
  const prs = git.pullRequests ?? [];
  const url = (p: SeedPullRequest) => `https://github.com/${p.repo}/pull/${p.number}`;
  const repos = [...new Set(prs.map((p) => p.repo))];
  s.http.on("GET api.github.com/repos/", () => []);
  s.http.on("GET api.github.com/user/repos", () => repos.map((r) => ({ full_name: r, owner: { login: r.split("/")[0] }, private: true, default_branch: "main", updated_at: "2026-10-01T00:00:00Z", html_url: `https://github.com/${r}` })));
  s.http.on("GET api.github.com/search/issues", (req) => {
    const terms = (new URL(req.url).searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const repo = terms.find((t) => t.startsWith("repo:"))?.slice(5), words = terms.filter((t) => !t.includes(":"));
    const items = prs.filter((p) => (!repo || p.repo === repo) && words.every((w) => p.title.toLowerCase().includes(w))).map((p) => ({
      number: p.number, title: p.title, state: p.mergedAt ? "closed" : "open", html_url: url(p), updated_at: p.mergedAt ?? new Date(s.clock.now()).toISOString(), closed_at: p.mergedAt ?? null,
      pull_request: { merged_at: p.mergedAt ?? null, html_url: url(p) },
    }));
    return { total_count: items.length, items };
  });
  for (const r of repos) s.http.on(`GET api.github.com/repos/${r}/pulls`, () => prs.filter((p) => p.repo === r).map((p) => ({
    number: p.number, title: p.title, state: p.mergedAt ? "closed" : "open", merged_at: p.mergedAt ?? null, user: { login: "dewi" }, head: { ref: "audio" }, base: { ref: "main" }, labels: [], html_url: url(p), created_at: "2026-10-10T00:00:00Z",
  })));
}

async function attachmentsOf(s: Scenario, fixture: AssistantFixture) {
  const { attachment } = await import("../test/support/images");
  const { pdf } = await import("../test/support/documents");
  return (fixture.facts.attachments ?? []).map((a) => attachment(s, a.name, pdf(a.pdf), { contentType: "application/pdf" }));
}

/** The Minutes and Daily logs of the brief's channel the bot wrote, at any depth; the seeded ones are left out. */
async function keptOf(s: Scenario, seeded: Set<string>): Promise<KeptState[]> {
  const paths = (await Promise.all(["minutes", "daily-logs"].map((f) => s.workspace.files(`${CHANNEL}/${f}`)))).flat().map((p) => p.slice(CHANNEL.length + 1)).filter((p) => p.endsWith(".md") && !seeded.has(p)).sort();
  return Promise.all(paths.map(async (path) => ({ path, text: ((await s.workspace.read(`${CHANNEL}/${path}`)) ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim() })));
}

async function stateOf(s: Scenario, channels: string[], seeded: Set<string>): Promise<AssistantState> {
  const { loadTasks, readInFull } = await import("../../../packages/skills/src/builtin/taskFile.ts");
  const { noteLine } = await import("../../../packages/skills/src/builtin/progressNotes.ts");
  const { taskChannelOf } = await import("../../../packages/skills/src/builtin/taskAccess.ts");
  const { workspaceStore } = await import("../../../packages/skills/src/workspace/store.ts");
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const lines = async (path: string) => ((await s.workspace.read(path)) ?? "").split("\n").filter((l) => l.trim());
  const store = workspaceStore(), found = new Map<string, Awaited<ReturnType<typeof loadTasks>>[number]>();
  for (const channelId of [CHANNEL_ID, ...channels]) for (const f of await loadTasks(store, { tenantId: s.tenant.id, guildId: GUILD, channelId })) found.set(f.path, f);
  const full = await readInFull(store, s.tenant.id, [...found.values()]);
  const tasks: TaskState[] = [...found.values()].map(({ path }, i) => {
    const t = full[i]!, channel = taskChannelOf(path)?.channelId, notes = (t.notes ?? []).map(noteLine);
    return { title: t.title, status: t.status, dueAt: t.dueAt, assignedTo: t.assignedTo?.name ?? null, createdByName: t.createdByName, ...(channel && channel !== CHANNEL_ID && { channel: `#${channel}` }), ...(notes.length && { notes }) };
  }).sort((a, b) => a.title.localeCompare(b.title));
  const files = (await s.workspace.list(`${CHANNEL}/files`)).map((p) => p.slice(CHANNEL.length + 1)).filter((p) => !p.split("/").pop()!.startsWith(".")).sort();
  const rows = await repositories().schedules.list({ kind: "reminder" });
  const reminders = rows.sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime() || a.text.localeCompare(b.text))
    .map((r) => ({ text: r.text, recurrence: r.recurrence, weekdays: r.weekdays ?? [], timeOfDay: r.timeOfDay ?? null, timezone: r.timezone, nextAt: r.nextAt.toISOString(), status: r.status, mentions: r.mentions ?? [] }));
  const kept = await keptOf(s, seeded);
  return { tasks, memory: { channel: await lines(`${CHANNEL}/MEMORY.md`), guild: await lines(`${GUILD_SHARED}/MEMORY.md`) }, files, reminders, ...(kept.length && { kept }) };
}

type Message = Scenario["discord"]["botMessages"][number];
const textOf = (m: Message) => [m.content, ...m.embeds.map((e) => `${e.title ?? ""}\n\n${e.description ?? ""}`.trim())].filter(Boolean).join("\n\n");

export async function runAssistantFixture(s: Scenario, fixture: AssistantFixture): Promise<AssistantOutput> {
  const { facts } = fixture;
  s.clock.set(facts.clock);
  if (facts.settings) await s.guildSettings({ timezone: facts.settings.timezone ?? null, language: facts.settings.language ?? null });
  if (facts.grants?.length) s.discord.grant(s.discord.alice, facts.grants);
  const channels = seededChannels(s, facts.seed);
  // Before anything else is posted: message ids carry their time and only grow, so earlier talk must come first.
  const seeded = seedTalk(s, facts);
  // Someone who has posted in the guild is a member its search finds.
  if (facts.members?.length) s.discord.history(facts.members.map((author) => ({ content: "hello", author })), { channel: s.discord.channel("lobby") });
  if (facts.seed?.tasks?.length) await seedTasks(s, facts.seed.tasks);
  if (facts.seed?.files?.length) await seedFiles(s, facts.seed.files);
  if (facts.seed?.git) await seedGit(s, facts.seed.git);
  const dailyLog = facts.then?.dailyLog ? await writeDay(s, facts, facts.then.dailyLog) : undefined;
  const seededFiles = new Set((facts.seed?.files ?? []).filter((f) => !f.channel).map((f) => f.path));
  const speakers = fixture.authors ?? [], member = (name: string) => memberNamed(s, facts, name);
  for (const name of new Set(["Alice", ...speakers.flat()])) s.discord.unlimited(member(name));
  const turns: AssistantTurn[] = [];
  let thread: Message["thread"], seen = s.discord.botMessages.length;
  for (const [i, message] of fixture.messages.entries()) {
    const who = speakers[i] ?? ["Alice"], where = thread ?? CHANNEL_ID;
    const sentAll = i === 0 ? [await s.discord.send(`${s.discord.mention} ${message}`, { attachments: await attachmentsOf(s, fixture) })]
      : who.length > 1 ? await s.discord.burst(message.split("\n").map((content, j) => ({ content, author: member(who[j]!) })), { channel: where })
      : [await s.discord.send(message, { author: member(who[0]!), channel: where })];
    const sent = sentAll[0]!, reactions = sentAll.flatMap((m) => m.reactions);
    thread ??= sent.thread;
    const posted = s.discord.botMessages.slice(seen);
    seen = s.discord.botMessages.length;
    turns.push({
      n: i + 1, message, ...(who.join() !== "Alice" && { authors: who }),
      replies: posted.map(textOf).filter(Boolean), ...(reactions.length && { reactions }), confirm: posted.some((m) => m.components.length > 0), pings: [...new Set(posted.flatMap((m) => m.allowedMentions?.users ?? []))], state: await stateOf(s, channels, seededFiles),
    });
  }
  const posts: AssistantOutput["posts"] = [];
  if (facts.then?.clock) {
    s.clock.set(facts.then.clock);
    await s.scheduler.tick();
    for (const m of s.discord.botMessages.slice(seen)) posts.push({ text: textOf(m), pings: m.allowedMentions?.users ?? [] });
  }
  return { kind: "assistant", fixture: fixture.name, ...(seeded.length && { seeded }), ...(dailyLog && { dailyLog }), turns, posts };
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
