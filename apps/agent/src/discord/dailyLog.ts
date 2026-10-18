import { workspaceStore, renderFrontmatter, asUntrusted, redact, loadPlaybook, listPlaybooks, availabilityPlace, skillRegistry, jumpLink, wallClock, wallToInstant, type Playbook } from "@pachiware/skills";
import { botCompletion } from "../llm/completion.js";
import { stamp, transcript, type DiscordJSAdapter, type HistoryCut } from "./adapter.js";

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

const DAY_MS = 24 * 3600_000;
const date = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
/** The date of the day before the one `at` falls on in `zone`. */
export const dayBefore = (zone: string, at: number) => { const w = wallClock(zone, at); return date(w.year, w.month, w.day - 1); };
/** Where a day starts and ends in `zone`; a day across a DST change is 23 or 25 hours. */
export function daySpan(zone: string, day: string) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
  return {
    since: wallToInstant(zone, { year: y, month: m, day: d, hour: 0, minute: 0 }),
    until: wallToInstant(zone, { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0 }),
  };
}
export const dailyLogPath = (guildId: string, channelId: string, day: string) => `guilds/${guildId}/channels/${channelId}/${DAILY_LOG_FOLDER}/${day}.md`;

/** Reads the channel's day, has the model write it following the playbook, and keeps it as the day's file. Nothing is posted. */
export async function writeDailyLog(run: DailyLogRun): Promise<DailyLogResult> {
  const path = dailyLogPath(run.guildId, run.channelId, run.day), store = workspaceStore();
  if (await store.read(run.tenantId, path)) return "exists";
  const playbooks = await listPlaybooks(run.tenantId);
  const place = availabilityPlace({ tenantId: run.tenantId, botId: run.botId, guildId: run.guildId, channelId: run.channelId });
  if ((await skillRegistry.availableAt(place, playbooks)).playbookCause(DAILY_LOG_PLAYBOOK)) return "off";
  const playbook = await loadPlaybook(run.tenantId, DAILY_LOG_PLAYBOOK);
  if (!playbook) return "off";
  const { messages, cut } = await run.adapter.readSpan(run.channelId, daySpan(run.timezone, run.day));
  if (!messages.length) return "empty";
  const links = messages.map((m) => jumpLink(run.guildId, m.channelId, m.id));
  const corpus = messages.map((m) => `${m.speaker}\n${m.text}`).join("\n");
  const content = await botCompletion(run.tenantId, run.botId)({
    system: systemPrompt(playbook),
    user: `Messages of #${run.channelName} on ${run.day}, oldest first${cut ? `; only the last ${messages.length} were read, everything before ${stamp(cut.keptFrom)} UTC was left out` : ""}:\n${asUntrusted("discord:history", transcript(messages))}`,
  });
  const log = content === null ? null : parseDailyLog(content, links, corpus);
  if (!log) return "failed";
  const header = { count: messages.length, participants: [...new Set(messages.map((m) => m.speaker))], cut };
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
  const text = content ?? "";
  let raw: any;
  try { raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
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

type Header = { count: number; participants: string[]; cut: HistoryCut | null };

/** Items are numbered across all sections, as in Minutes; every item ends with its message links. */
function render(run: DailyLogRun, h: Header, log: DailyLog) {
  let n = 0;
  const row = (text: string, links: string[]) => `${++n}. ${text} ${links.map((l) => `[↗](${l})`).join(" ")}`;
  const keywords = (t: Topic) => [...t.keywords.id, ...t.keywords.en];
  const block = (label: string, rows: string[]) => `## ${label}\n${rows.length ? rows.join("\n") : `*${log.labels.none}*`}`;
  const head = [
    `Topics: ${log.topics.map((t) => t.name).join(", ")}`,
    `Keywords: ${[...new Set(log.topics.flatMap(keywords))].join(", ")}`,
    `${h.count} messages from ${h.participants.join(", ")}`,
    ...(h.cut ? [`*Only the last ${h.count} messages were read: everything before ${stamp(h.cut.keptFrom)} UTC was left out.*`] : []),
  ].join("\n");
  return [
    `# Daily log #${run.channelName}, ${run.day}\n\n${head}`,
    block(log.labels.topics, log.topics.map((t) => row(keywords(t).length ? `${t.name}: ${keywords(t).join(", ")}` : t.name, t.links))),
    block(log.labels.decided, log.decided.map((i) => row(i.text, i.links))),
    block(log.labels.open, log.open.map((i) => row(i.text, i.links))),
    block(log.labels.next, log.next.map((a) => row(`${a.owner ? `**${a.owner}**` : `*${log.labels.noOwner}*`}: ${a.task}${a.due ? ` (${log.labels.due} ${a.due})` : ""}`, a.links))),
  ].join("\n\n");
}

/**
 * The fields at the top keep the log whole, so a later change (a deleted message) can rewrite the file from them.
 * `topics` and `keywords` end the head, as `addKeywords` writes them on other kept material.
 */
function recordText(run: DailyLogRun, h: Header, log: DailyLog) {
  const fields = {
    kind: "daily-log", guildId: run.guildId, channelId: run.channelId, channel: run.channelName, day: run.day, timezone: run.timezone,
    header: h, log,
    topics: log.topics.map((t) => t.name), keywords: [...new Set(log.topics.flatMap((t) => [...t.keywords.id, ...t.keywords.en]))],
  };
  return renderFrontmatter(fields, `${render(run, h, log)}\n`);
}
