import { workspaceStore, WorkspaceConflict, parseFrontmatter, renderFrontmatter, asUntrusted, redact, loadPlaybook, listPlaybooks, availabilityPlace, skillRegistry, jumpLink, wallClock, wallToInstant, replyObject, addDays, DAY_MS, type Playbook } from "@pachiware/skills";
import { botCompletion } from "../llm/completion.js";
import { stamp, transcript, type DiscordJSAdapter } from "./adapter.js";

/** The built-in, reference-only playbook whose steps the Daily log follows; a tenant playbook of the same name changes the steps, not where the file goes. */
export const DAILY_LOG_PLAYBOOK = "daily-log";
/** The Kept material folder of a channel that holds its Daily logs, one file per day named by its date. */
export const DAILY_LOG_FOLDER = "daily-logs";

type Labels = { topics: string; decided: string; open: string; next: string; noOwner: string; due: string; none: string };
const LABELS: Labels = { topics: "Topics", decided: "Decided", open: "Still open", next: "Who does what next", noOwner: "no owner yet", due: "due", none: "None" };
export interface Topic { name: string; keywords: { id: string[]; en: string[] }; links: string[] }
export interface LogItem { text: string; links: string[] }
export interface NextItem { owner: string | null; task: string; due: string | null; links: string[] }
export interface DailyLog { topics: Topic[]; decided: LogItem[]; open: LogItem[]; next: NextItem[]; labels: Labels }

export interface DailyLogRun {
  tenantId: string; botId: string; guildId: string; channelId: string; channelName: string;
  /** The place's zone, which says where the day starts and ends. */
  timezone: string;
  /** The day, as its date in `timezone`: "2026-03-06". */
  day: string;
  adapter: DiscordJSAdapter;
}
/** `exists`: that day already has its Daily log, which is never rewritten. `empty`: no message from people that day. `off`: an Availability rule turns the playbook off there. */
export type DailyLogResult = "written" | "exists" | "empty" | "off" | "failed";

/** Messages one model call reads; a busier day is read in parts and the parts joined. */
const PART = 500;
/** The most messages of one day read at all, from its start; the file says where reading stopped. */
const DAY_LIMIT = 5_000;
/** The date of the day before the one `at` falls on in `zone`. */
export const dayBefore = (zone: string, at: number) => { const w = wallClock(zone, at); return addDays(new Date(Date.UTC(w.year, w.month - 1, w.day)).toISOString().slice(0, 10), -1); };
/** Where a day starts and ends in `zone`; a day across a DST change is 23 or 25 hours. */
export function daySpan(zone: string, day: string) {
  const midnight = (date: string) => { const [year, month, d] = date.split("-").map(Number) as [number, number, number]; return wallToInstant(zone, { year, month, day: d, hour: 0, minute: 0 }); };
  return { since: midnight(day), until: midnight(addDays(day, 1)) };
}
/** A day's Daily log, in its month's folder so no folder outgrows the Workspace's list limit. */
export const dailyLogPath = (guildId: string, channelId: string, day: string) => `guilds/${guildId}/channels/${channelId}/${DAILY_LOG_FOLDER}/${day.slice(0, 7)}/${day}.md`;
/** Where a day was kept before monthly folders; such files stay where they are and are still read. */
const flatDailyLogPath = (guildId: string, channelId: string, day: string) => `guilds/${guildId}/channels/${channelId}/${DAILY_LOG_FOLDER}/${day}.md`;

/** Reads the channel's day, has the model write it following the playbook, and keeps it as the day's file. Nothing is posted. */
export async function writeDailyLog(run: DailyLogRun): Promise<DailyLogResult> {
  const path = dailyLogPath(run.guildId, run.channelId, run.day), store = workspaceStore();
  if (await store.read(run.tenantId, path) || await store.read(run.tenantId, flatDailyLogPath(run.guildId, run.channelId, run.day))) return "exists";
  const playbooks = await listPlaybooks(run.tenantId);
  const place = availabilityPlace({ tenantId: run.tenantId, botId: run.botId, guildId: run.guildId, channelId: run.channelId });
  if ((await skillRegistry.availableAt(place, playbooks)).playbookCause(DAILY_LOG_PLAYBOOK)) return "off";
  const playbook = await loadPlaybook(run.tenantId, DAILY_LOG_PLAYBOOK);
  if (!playbook) return "off";
  const { messages, stoppedAt } = await run.adapter.readSpan(run.channelId, daySpan(run.timezone, run.day), DAY_LIMIT);
  if (!messages.length) return "empty";
  const complete = botCompletion(run), count = Math.ceil(messages.length / PART);
  const parts: DailyLog[] = [];
  for (let from = 0; from < messages.length; from += PART) {
    const part = messages.slice(from, from + PART);
    const which = count > 1 ? `, part ${from / PART + 1} of ${count} (messages ${from + 1}-${from + part.length} of ${messages.length})` : "";
    const content = await complete({
      system: systemPrompt(playbook),
      user: `Messages of #${run.channelName} on ${run.day}, oldest first${which}${stoppedAt ? `; reading stopped at ${messages.length} messages, nothing after ${stamp(stoppedAt)} UTC was read` : ""}:\n${asUntrusted("discord:history", transcript(part))}`,
    });
    const links = part.map((m) => jumpLink(run.guildId, m.channelId, m.id));
    const log = content === null ? null : parseDailyLog(content, links, part.map((m) => `${m.speaker}\n${m.text}`).join("\n"));
    if (!log) return "failed";
    parts.push(log);
  }
  const log = joinParts(parts);
  const header = { count: messages.length, participants: [...new Set(messages.map((m) => m.speaker))], stoppedAt };
  await store.write(run.tenantId, path, recordText(run, header, log));
  return "written";
}

const FORMAT = `Reply with one JSON object and nothing else, in this shape:
{"topics": [{"name": "a few words", "keywords": {"id": ["kata kunci"], "en": ["keyword"]}, "refs": [1, 4]}], "decided": [{"text": "...", "refs": [3]}], "open": [{"text": "...", "refs": [5]}], "next": [{"owner": "a name from the talk, or null", "task": "...", "due": "as stated, or null", "refs": [7]}], "labels": ${JSON.stringify(LABELS)}}
"refs" are the numbers of the messages the item rests on. "labels" are the section labels, written in the talk's language.`;
const systemPrompt = (playbook: Playbook) => `### Playbook: ${playbook.name}\n${playbook.body}\n\n${FORMAT}`;

const clean = (v: unknown) => (typeof v === "string" ? redact(v.replace(/\s+/g, " ").trim()) : "");
const words = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(clean).filter((w) => w && w.length <= 60))].slice(0, 12);

/** The model's JSON as a Daily log; an item resting on no message of the day is dropped, and an owner the talk never named is cleared. */
export function parseDailyLog(content: string | null, links: string[], corpus: string): DailyLog | null {
  const raw = replyObject(content);
  if (!raw) return null;
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const linksOf = (i: any) => [...new Set([...list(i?.refs), i?.ref].flatMap((ref) => (Number.isInteger(ref) && links[ref - 1] ? [links[ref - 1]!] : [])))];
  const items = (v: unknown) => list(v).flatMap((i) => { const l = linksOf(i), t = clean(i?.text); return l.length && t ? [{ text: t, links: l }] : []; });
  const named = (owner: string) => !!owner && corpus.toLowerCase().includes(owner.replace(/^@/, "").toLowerCase());
  const topics = list(raw.topics).flatMap((i) => {
    const l = linksOf(i), name = clean(i?.name ?? i?.text).slice(0, 120);
    return l.length && name ? [{ name, keywords: { id: words(i?.keywords?.id), en: words(i?.keywords?.en) }, links: l }] : [];
  });
  const next = list(raw.next ?? raw.actions).flatMap((i) => {
    const l = linksOf(i), task = clean(i?.task ?? i?.text), owner = clean(i?.owner);
    return l.length && task ? [{ owner: named(owner) ? owner.replace(/^@/, "") : null, task, due: clean(i?.due) || null, links: l }] : [];
  });
  const labels = { ...LABELS };
  for (const key of Object.keys(LABELS) as (keyof Labels)[]) { const v = clean(raw.labels?.[key]); if (v && v.length <= 40) labels[key] = v; }
  return { topics, decided: items(raw.decided), open: items(raw.open), next, labels };
}

/** One Daily log from its parts: a topic named in several parts appears once, with every part's keywords and links. Labels come from the first part. */
export function joinParts(parts: DailyLog[]): DailyLog {
  const topics = new Map<string, Topic>();
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  for (const t of parts.flatMap((p) => p.topics)) {
    const key = t.name.toLowerCase(), seen = topics.get(key);
    topics.set(key, seen ? { name: seen.name, keywords: { id: union(seen.keywords.id, t.keywords.id), en: union(seen.keywords.en, t.keywords.en) }, links: union(seen.links, t.links) } : t);
  }
  return { topics: [...topics.values()], decided: parts.flatMap((p) => p.decided), open: parts.flatMap((p) => p.open), next: parts.flatMap((p) => p.next), labels: parts[0]!.labels };
}

type Header = { count: number; participants: string[]; stoppedAt: number | null };
type Part = "topics" | "decided" | "open" | "next";
type Place = Pick<DailyLogRun, "guildId" | "channelId" | "channelName" | "day" | "timezone">;

const topicKeywords = (t: Topic) => [...t.keywords.id, ...t.keywords.en];
const allKeywords = (log: DailyLog) => [...new Set(log.topics.flatMap(topicKeywords))];

/** Items are numbered across all sections, as in Minutes; every item ends with its message links. A part in `leftOut` is not shown; any other empty part says "None". */
function render(run: Place, h: Header, log: DailyLog, leftOut: Part[] = []) {
  let n = 0;
  const row = (text: string, links: string[]) => `${++n}. ${text} ${links.map((l) => `[↗](${l})`).join(" ")}`;
  const block = (label: string, rows: string[]) => `## ${label}\n${rows.length ? rows.join("\n") : `*${log.labels.none}*`}`;
  const head = [
    `Topics: ${log.topics.map((t) => t.name).join(", ")}`,
    `Keywords: ${allKeywords(log).join(", ")}`,
    `${h.count} messages from ${h.participants.join(", ")}`,
    ...(h.stoppedAt ? [`*Reading stopped at ${h.count} messages: nothing after ${stamp(h.stoppedAt)} UTC was read.*`] : []),
  ].join("\n");
  const parts: [Part, string, string[]][] = [
    ["topics", log.labels.topics, log.topics.map((t) => row(topicKeywords(t).length ? `${t.name}: ${topicKeywords(t).join(", ")}` : t.name, t.links))],
    ["decided", log.labels.decided, log.decided.map((i) => row(i.text, i.links))],
    ["open", log.labels.open, log.open.map((i) => row(i.text, i.links))],
    ["next", log.labels.next, log.next.map((a) => row(`${a.owner ? `**${a.owner}**` : `*${log.labels.noOwner}*`}: ${a.task}${a.due ? ` (${log.labels.due} ${a.due})` : ""}`, a.links))],
  ];
  return [
    `# Daily log #${run.channelName}, ${run.day}\n\n${head}`,
    ...parts.filter(([part]) => !leftOut.includes(part)).map(([, label, rows]) => block(label, rows)),
  ].join("\n\n");
}

/**
 * The fields at the top keep the log whole, so a later change (a deleted message) can rewrite the file from them.
 * `topics` and `keywords` end the head, as `addKeywords` writes them on other kept material.
 */
function recordText(run: Place, h: Header, log: DailyLog, leftOut: Part[] = []) {
  const fields = {
    kind: "daily-log", guildId: run.guildId, channelId: run.channelId, channel: run.channelName, day: run.day, timezone: run.timezone,
    header: h, log, ...(leftOut.length ? { leftOut } : {}),
    topics: log.topics.map((t) => t.name), keywords: allKeywords(log),
  };
  return renderFrontmatter(fields, `${render(run, h, log, leftOut)}\n`);
}

/** A message deleted in Discord: its link leaves `channelId`'s Daily logs, i.e. the parent channel's for a thread's message. */
export interface DeletedMessage { tenantId: string; guildId: string; channelId: string; messageChannelId: string; messageId: string; createdAt: number }

const PARTS: Part[] = ["topics", "decided", "open", "next"];

/**
 * Takes a deleted message's link out of the Daily log holding it; an item left with no link goes, and so does a part a deletion emptied.
 * Only the files of the days around the message's creation are read: any place's zone puts it within a day of its UTC date.
 */
export async function forgetDeletedMessage(m: DeletedMessage) {
  const store = workspaceStore(), link = jumpLink(m.guildId, m.messageChannelId, m.messageId);
  const days = [-DAY_MS, 0, DAY_MS].map((d) => new Date(m.createdAt + d).toISOString().slice(0, 10));
  for (const day of days) for (const path of [dailyLogPath(m.guildId, m.channelId, day), flatDailyLogPath(m.guildId, m.channelId, day)]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const file = await store.read(m.tenantId, path);
      if (!file?.content.includes(link)) break;
      const fields = parseFrontmatter(file.content)?.fields as any;
      if (!fields?.log) break;
      const keep = <T extends { links: string[] }>(items: T[]) => items.map((i) => ({ ...i, links: i.links.filter((l) => l !== link) })).filter((i) => i.links.length);
      const log: DailyLog = { ...fields.log, topics: keep(fields.log.topics), decided: keep(fields.log.decided), open: keep(fields.log.open), next: keep(fields.log.next) };
      const emptied = PARTS.filter((part) => fields.log[part].length && !log[part].length);
      const leftOut = [...new Set([...(fields.leftOut ?? []), ...emptied])];
      const run = { guildId: fields.guildId, channelId: fields.channelId, channelName: fields.channel, day: fields.day, timezone: fields.timezone };
      try { await store.write(m.tenantId, path, recordText(run, fields.header, log, leftOut), file.version); return; } catch (e) { if (!(e instanceof WorkspaceConflict)) throw e; }
    }
  }
}
