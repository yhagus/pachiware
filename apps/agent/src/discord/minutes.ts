import type { Message } from "discord.js";
import { workspaceStore, renderFrontmatter, parseFrontmatter, safeId, asUntrusted, redact, loadPlaybook, type Playbook } from "@pachiware/skills";
import { llmRouter } from "../llm/router.js";
import { HISTORY_PAGE, HISTORY_PAGES, HISTORY_SPAN_MS, type DiscordJSAdapter, type HistoryAccess, type HistoryCut, type HistoryMessage } from "./adapter.js";

/** The built-in playbook this module runs; a tenant playbook of the same name changes its steps and triggers, not where minutes go. */
export const MINUTES_PLAYBOOK = "minutes";
/** "@bot minutes" in a channel with no start point covers this much. */
export const RECENT_MS = 3 * 3600_000;
const EMBED_LIMIT = 4096;
const FILE_NAME = "minutes.md";

type Labels = { decided: string; open: string; actions: string; participants: string; noOwner: string; due: string; none: string };
const LABELS: Labels = { decided: "Decided", open: "Still open", actions: "Action items", participants: "Participants", noOwner: "no owner yet", due: "due", none: "None" };
export interface MinutesItem { text: string; link: string }
export interface ActionItem { owner: string | null; task: string; due: string | null; link: string }
export interface Minutes { title: string; decided: MinutesItem[]; open: MinutesItem[]; actions: ActionItem[]; labels: Labels }
type Header = { from: number; to: number; count: number; participants: string[]; cut: HistoryCut | null };
type Input = { authorId: string; author: string; text: string; at: string; link: string };
/** The Workspace file behind one posted minutes message; it is rewritten on every correction. */
interface MinutesRecord {
  title: string; guildId: string; channelId: string; postedIn: string; messageId: string; requesterId: string;
  header: Header; minutes: Minutes; corrections: Input[]; input: Input[];
}

const PERMISSION_NAMES: Record<string, string> = { ViewChannel: "View Channel", ReadMessageHistory: "Read Message History", SendMessages: "Send Messages", SendMessagesInThreads: "Send Messages in Threads", EmbedLinks: "Embed Links", AttachFiles: "Attach Files" };
const permissionName = (flag: string) => PERMISSION_NAMES[flag] ?? flag.replace(/([a-z])([A-Z])/g, "$1 $2");
const and = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);
export const jumpLink = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/** What to tell the requester when minutes cannot be written here, or null when they can. */
export async function minutesRefusal(adapter: DiscordJSAdapter, channelId: string, requesterId: string): Promise<string | null> {
  const access: HistoryAccess = await adapter.historyAccess(channelId, requesterId);
  if (access.ok) return null;
  if (access.who === "dm") return "I write minutes only in server channels and threads, not in DMs.";
  const names = and(access.missing.map(permissionName));
  if (access.who === "requester") return access.missing.length ? `You need ${names} here to get minutes of it, so I won't write them.` : "This is a private thread you are not a member of, so I won't write minutes of it.";
  return `I can't write minutes here because I'm missing the ${names} permission${access.missing.length > 1 ? "s" : ""} in this channel. A server admin can grant ${access.missing.length > 1 ? "them" : "it"}.`;
}

export interface MinutesRun {
  tenantId: string; botId: string; adapter: DiscordJSAdapter; playbook: Playbook;
  guildId: string;
  /** Where the minutes were asked for; with `parentId` it is a thread and the whole thread is read. */
  channelId: string; parentId: string | null;
  requesterId: string;
  /** The message a "Write minutes" command ran on; without it a channel's last 3 hours are read. */
  startId?: string;
  skipIds?: string[];
  post(payload: MinutesPayload): Promise<Message>;
}
export type MinutesPayload = { embeds: any[]; files: { attachment: Buffer; name: string }[]; allowedMentions: { parse: [] } };

/** Reads the range, has the model write the content, then posts and stores the minutes. Returns what to tell the requester when it could not. */
export async function writeMinutes(run: MinutesRun, now = Date.now()): Promise<string | null> {
  const range = run.parentId ? {} : run.startId ? { startId: run.startId } : { since: now - RECENT_MS };
  const { messages, cut } = await run.adapter.readHistory(run.channelId, { ...range, skipIds: run.skipIds }, now);
  if (!messages.some((m) => !m.own)) return "I found no messages to write minutes of in this range.";
  const links = messages.map((m) => jumpLink(run.guildId, m.channelId, m.id));
  const corpus = messages.map((m) => `${m.speaker}\n${m.text}`).join("\n");
  const response = await llmRouter.complete([
    { role: "system", content: systemPrompt(run.playbook) },
    { role: "user", content: `Messages, oldest first${cut ? `. ${cutNote(cut, false)}` : ""}:\n${asUntrusted("discord:history", transcript(messages))}` },
  ], { tenantId: run.tenantId, botId: run.botId }).catch(() => null);
  const minutes = response && response.finishReason !== "error" ? parseMinutes(response.content, links, corpus) : null;
  if (!minutes) return "I couldn't write the minutes this time. Try again in a moment.";
  const header: Header = { from: messages[0]!.at, to: messages.at(-1)!.at, count: messages.length, participants: [...new Set(messages.filter((m) => !m.own).map((m) => m.speaker))], cut };
  const folder = minutesFolder(run.guildId, run.parentId ?? run.channelId);
  const file = await freeName(run.tenantId, folder, `${new Date(now).toISOString().slice(0, 10)}-${slug(minutes.title)}`);
  const payload = payloadOf(minutes, header, file);
  const posted = await run.post(payload).catch(() => null);
  if (!posted) return `I couldn't post the minutes here. Check that I have Send Messages and Embed Links${payload.files.length ? ", plus Attach Files for minutes.md" : ""}.`;
  const record: MinutesRecord = { title: minutes.title, guildId: run.guildId, channelId: run.parentId ?? run.channelId, postedIn: run.channelId, messageId: posted.id, requesterId: run.requesterId, header, minutes, corrections: [], input: [] };
  await workspaceStore().write(run.tenantId, `${folder}/${file}`, recordText(record));
  return null;
}

/** The Workspace file name a posted minutes message carries in its footer, or null for any other message. */
export function minutesFileOf(message: Message): string | null {
  return /minutes\/([^\s/]+\.md)$/u.exec(message.embeds?.[0]?.footer?.text ?? "")?.[1] ?? null;
}

export interface MinutesReply { tenantId: string; botId: string; guildId: string; minutesMessage: Message; reply: Message; text: string }
/** A reply to posted minutes: the requester's corrects them in place, anyone else's is recorded as input. */
export async function correctMinutes(c: MinutesReply, now = Date.now()) {
  const answer = (content: string) => c.reply.reply({ content, allowedMentions: { parse: [] } }).catch(() => {});
  const channel = c.minutesMessage.channel;
  const path = `${minutesFolder(c.guildId, (channel.isThread() ? channel.parentId : channel.id) ?? channel.id)}/${minutesFileOf(c.minutesMessage)}`;
  const stored = await workspaceStore().read(c.tenantId, path);
  const record = stored && parseRecord(stored.content);
  if (!stored || !record || record.messageId !== c.minutesMessage.id) return answer("I can't find the stored copy of these minutes, so I can't change them.");
  const entry: Input = { authorId: c.reply.author.id, author: c.reply.member?.displayName || c.reply.author.username, text: clean(c.text), at: new Date(now).toISOString(), link: jumpLink(c.guildId, c.reply.channelId, c.reply.id) };
  if (c.reply.author.id !== record.requesterId) {
    record.input.push(entry);
    await workspaceStore().write(c.tenantId, path, recordText(record), stored.version);
    await c.reply.react("👀").catch(() => {});
    return;
  }
  const m = record.minutes;
  const links = [...new Set([...m.decided, ...m.open, ...m.actions].map((i) => i.link)), entry.link];
  const ref = (link: string) => links.indexOf(link) + 1;
  const current = { title: m.title, decided: m.decided.map((i) => ({ text: i.text, ref: ref(i.link) })), open: m.open.map((i) => ({ text: i.text, ref: ref(i.link) })), actions: m.actions.map((a) => ({ owner: a.owner, task: a.task, due: a.due, ref: ref(a.link) })), labels: m.labels };
  const playbook = await loadPlaybook(c.tenantId, MINUTES_PLAYBOOK);
  const response = playbook && await llmRouter.complete([
    { role: "system", content: `${systemPrompt(playbook)}\n\n${CORRECTION}` },
    { role: "user", content: `Current minutes:\n${JSON.stringify(current)}\n\nSources:\n${links.map((l, i) => `[${i + 1}] ${i === links.length - 1 ? "the correction" : l}`).join("\n")}\n\nCorrection:\n${asUntrusted("discord:correction", c.text)}` },
  ], { tenantId: c.tenantId, botId: c.botId }).catch(() => null);
  const corpus = [...record.header.participants, ...m.actions.map((a) => a.owner ?? ""), c.text].join("\n");
  const next = response && response.finishReason !== "error" ? parseMinutes(response.content, links, corpus, m.labels) : null;
  if (!next) return answer("I couldn't apply that correction. Try saying it another way.");
  const edited = await c.minutesMessage.edit({ ...payloadOf(next, record.header, minutesFileOf(c.minutesMessage)!), attachments: [] }).catch(() => null);
  if (!edited) return answer("I couldn't edit the minutes message.");
  Object.assign(record, { title: next.title, minutes: next, corrections: [...record.corrections, entry] });
  await workspaceStore().write(c.tenantId, path, recordText(record), stored.version);
  await c.reply.react("✅").catch(() => {});
}

const CORRECTION = `The person who asked for these minutes sent a correction. Apply it and reply with the whole corrected minutes in the same JSON shape, changing only what the correction asks for. "ref" is the number of a source in the list; an item the correction adds points to the correction.`;

const FORMAT = `Reply with one JSON object and nothing else, in this shape:
{"title": "a few words naming the discussion", "decided": [{"text": "...", "ref": 3}], "open": [{"text": "...", "ref": 5}], "actions": [{"owner": "a name from the discussion, or null", "task": "...", "due": "as stated, or null", "ref": 7}], "labels": ${JSON.stringify(LABELS)}}
"ref" is the number of the message the item comes from. "labels" are the section labels, written in the discussion's language.`;
const systemPrompt = (playbook: Playbook) => `### Playbook: ${playbook.name}\n${playbook.body}\n\n${FORMAT}`;

const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
function transcript(messages: HistoryMessage[]) {
  const number = new Map(messages.map((m, i) => [m.id, i + 1]));
  return messages.map((m, i) => {
    const reply = m.replyTo && number.has(m.replyTo) ? ` (reply to [${number.get(m.replyTo)}])` : "";
    const files = m.attachments.map((a) => ` [${a}]`).join("");
    return `[${i + 1}] ${stamp(m.at)} ${m.speaker}${m.own ? " (this bot)" : ""}${reply}: ${m.text}${files}`;
  }).join("\n");
}

const clean = (v: unknown) => (typeof v === "string" ? redact(v.replace(/\s+/g, " ").trim()) : "");
/** The model's JSON as minutes; items without a message to point to are dropped, and an owner the discussion never named is cleared. */
export function parseMinutes(content: string | null, links: string[], corpus: string, base: Labels = LABELS): Minutes | null {
  let raw: any;
  try { raw = JSON.parse((content ?? "").slice((content ?? "").indexOf("{"), (content ?? "").lastIndexOf("}") + 1)); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const linkOf = (ref: unknown) => (typeof ref === "number" && Number.isInteger(ref) ? links[ref - 1] : undefined);
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const items = (v: unknown) => list(v).flatMap((i) => { const link = linkOf(i?.ref), text = clean(i?.text); return link && text ? [{ text, link }] : []; });
  const named = (owner: string) => !!owner && corpus.toLowerCase().includes(owner.replace(/^@/, "").toLowerCase());
  const actions = list(raw.actions).flatMap((i) => {
    const link = linkOf(i?.ref), task = clean(i?.task ?? i?.text), owner = clean(i?.owner);
    return link && task ? [{ owner: named(owner) ? owner.replace(/^@/, "") : null, task, due: clean(i?.due) || null, link }] : [];
  });
  const labels = { ...LABELS, ...base };
  for (const key of Object.keys(LABELS) as (keyof Labels)[]) { const v = clean(raw.labels?.[key]); if (v && v.length <= 40) labels[key] = v; }
  return { title: clean(raw.title).slice(0, 200) || "Minutes", decided: items(raw.decided), open: items(raw.open), actions, labels };
}

function cutNote(cut: HistoryCut, embed: boolean) {
  const when = embed ? `<t:${Math.floor(cut.keptFrom / 1000)}:f>` : `${stamp(cut.keptFrom)} UTC`;
  return cut.reason === "count" ? `Cut to the latest ${HISTORY_PAGE * HISTORY_PAGES} messages: everything before ${when} was left out.` : `Cut to the last ${HISTORY_SPAN_MS / 3600_000} hours: everything before ${when} was left out.`;
}

/** Items are numbered across all sections, so "point 2" names one item. */
function sections(m: Minutes) {
  let n = 0;
  const row = (text: string, link: string) => `${++n}. ${text} [↗](${link})`;
  return {
    decided: m.decided.map((i) => row(i.text, i.link)),
    open: m.open.map((i) => row(i.text, i.link)),
    actions: m.actions.map((a) => row(`${a.owner ? `**${a.owner}**` : `*${m.labels.noOwner}*`}: ${a.task}${a.due ? ` (${m.labels.due} ${a.due})` : ""}`, a.link)),
  };
}

function render(m: Minutes, h: Header, embed: boolean, only?: (keyof ReturnType<typeof sections>)[]) {
  const rows = sections(m);
  const range = embed ? `<t:${Math.floor(h.from / 1000)}:f> – <t:${Math.floor(h.to / 1000)}:f>` : `${stamp(h.from)} – ${stamp(h.to)} UTC`;
  const head = [`${range} · ${h.count} messages`, `${m.labels.participants}: ${h.participants.join(", ")}`, ...(h.cut ? [`*${cutNote(h.cut, embed)}*`] : [])].join("\n");
  const block = (key: keyof typeof rows) => `${embed ? `**${m.labels[key]}**` : `## ${m.labels[key]}`}\n${rows[key].length ? rows[key].join("\n") : `*${m.labels.none}*`}`;
  const keys = only ?? (["decided", "open", "actions"] as const);
  return [embed ? head : `# ${m.title}\n\n${head}`, ...keys.map(block)].join("\n\n");
}

/** One embed; when the minutes do not fit, the embed keeps Decided and Action items and the whole text goes along as minutes.md. */
function payloadOf(m: Minutes, h: Header, file: string): MinutesPayload {
  const full = render(m, h, true);
  const long = full.length > EMBED_LIMIT;
  let description = long ? `${render(m, h, true, ["decided", "actions"])}\n\n*${m.labels.open} (${m.open.length}): ${FILE_NAME}*` : full;
  if (description.length > EMBED_LIMIT) description = `${description.slice(0, description.lastIndexOf("\n", EMBED_LIMIT - 20))}\n… ${FILE_NAME}`;
  const embed = { title: m.title.slice(0, 256), description, footer: { text: `Reply to correct · minutes/${file}` } };
  return { embeds: [embed], files: long ? [{ attachment: Buffer.from(render(m, h, false)), name: FILE_NAME }] : [], allowedMentions: { parse: [] } };
}

const minutesFolder = (guildId: string, channelId: string) => {
  const g = safeId(guildId), c = safeId(channelId);
  if (!g || !c) throw new Error("Invalid minutes location");
  return `guilds/${g}/channels/${c}/minutes`;
};
const slug = (title: string) => title.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+/, "").slice(0, 48).replace(/-+$/, "") || "minutes";
async function freeName(tenantId: string, folder: string, base: string) {
  for (let i = 1; ; i++) {
    const name = `${i === 1 ? base : `${base}-${i}`}.md`;
    if (!(await workspaceStore().read(tenantId, `${folder}/${name}`))) return name;
  }
}

function recordText(r: MinutesRecord) {
  const input = r.input.length ? `\n\n## Input from others\n${r.input.map((i) => `- ${i.author}, ${i.at}: ${i.text} ([message](${i.link}))`).join("\n")}` : "";
  return renderFrontmatter({ ...r }, `${render(r.minutes, r.header, false)}${input}\n`);
}
export function parseRecord(text: string): MinutesRecord | null {
  const fields = parseFrontmatter(text)?.fields as Partial<MinutesRecord> | undefined;
  return fields && typeof fields.messageId === "string" && fields.minutes && fields.header ? fields as MinutesRecord : null;
}
