/**
 * Renders the lived-in story (`story.ts`) into the Workspace a guild has after three and a half months with the bot, in the formats the
 * bot itself writes: Daily logs as `dailyLog.ts` keeps them (frontmatter holding the log, a body linking every item to its messages, one
 * folder per month), Minutes as `minutes.ts` keeps them (the whole record in the frontmatter, topics and keywords at the end of the head),
 * Decisions and Notes with the head `addKeywords` writes, Documents as filed, and Tasks through `taskFile.ts`. Every working day of every
 * channel without a story event gets a routine Daily log from the channel's pool of everyday topics, so a search meets the noise a real
 * Workspace holds. Deterministic: the same corpus on every run, with no network and no model.
 *
 *   bun apps/agent/eval/lived-in/corpus.ts <folder>   writes the corpus out to read: <folder>/<channel>/<path>, plus git.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { render as renderTask, slug as taskSlug, type Task } from "../../../../packages/skills/src/builtin/taskFile";
import type { SeedFile, SeedGit, SeedMessage } from "../assistantFixtures";
import { CHANNELS, COMMITS, DAYS, DECISIONS, DOCUMENTS, END, HOLIDAYS, HOME, ISSUES, MEMBERS, MINUTES, MORNING, NOTES, PEOPLE, PULLS, START, TASKS, ZONE, type Action, type Channel, type Lang } from "./story";

export interface Corpus {
  /** The display name of the brief's channel, channel-1. */
  home: string;
  members: { id: string; name: string }[];
  /** Every file, below its channel's folder; `channel` is left out for the home channel's. */
  files: SeedFile[];
  /** Talk in the home channel before the clock. */
  messages: SeedMessage[];
  git: SeedGit;
}

const GUILD = "guild-1", HOME_ID = "channel-1", OFFSET = "+07:00";
const channelId = (c: Channel) => (c === HOME ? HOME_ID : c);

/** A deterministic generator per name: the same channel and day always draw the same numbers. */
function random(name: string) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]! };
}

const instant = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00${OFFSET}`);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export function workingDays(from = START, to = END): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) !== 0 && weekday(d) !== 6 && !HOLIDAYS.includes(d)) out.push(d);
  return out;
}

/** Discord message ids: the time since Discord's epoch, shifted, plus a sequence, so ids grow with time as real ones do. */
let sequence = 0;
const snowflake = (at: number) => String(((BigInt(at) - 1_420_070_400_000n) << 22n) | BigInt(++sequence & 0x3fffff));
const link = (c: Channel, id: string) => `https://discord.com/channels/${GUILD}/${channelId(c)}/${id}`;
const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
/** `count` messages between two instants, oldest first. */
function messages(c: Channel, from: number, to: number, count: number, rng: ReturnType<typeof random>) {
  const times = Array.from({ length: count }, () => from + Math.floor(rng.next() * (to - from))).sort((a, b) => a - b);
  return times.map((at) => link(c, snowflake(at)));
}

/** The head `addKeywords` leaves at the end of a kept file's frontmatter (`withKeywords` in keywords.ts). */
function withKeywords(text: string, found?: { topics: string[]; keywords: string[] }) {
  if (!found) return text;
  const add = [`topics: ${JSON.stringify(found.topics)}`, `keywords: ${JSON.stringify(found.keywords)}`];
  const m = /^---\r?\n([\s\S]*?\r?\n)?---(\r?\n|$)/.exec(text);
  const own = m ? (m[1] ?? "").split(/\r?\n/).filter((l) => l && !/^(topics|keywords): \[.*\]$/.test(l)) : [];
  return `---\n${[...own, ...add].join("\n")}\n---\n${m ? text.slice(m[0].length) : text}`;
}
const frontmatter = (fields: Record<string, unknown>, body: string) =>
  `---\n${Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n${body}`;

// ---- Daily logs, as dailyLog.ts writes them ----

const LOG_LABELS: Record<Lang, Record<string, string>> = {
  en: { topics: "Topics", decided: "Decided", open: "Still open", next: "Who does what next", noOwner: "no owner yet", due: "due", none: "None" },
  id: { topics: "Topik", decided: "Diputuskan", open: "Masih terbuka", next: "Siapa mengerjakan apa", noOwner: "belum ada pemilik", due: "tenggat", none: "Tidak ada" },
};
interface LogTopic { name: string; id: string[]; en: string[]; decided?: string[]; open?: string[]; next?: Action[]; links?: string[] }

interface LogItem { text: string; links: string[] }
/** The frontmatter fields of a Daily log, which hold the whole log, as `dailyLog.ts` keeps them. */
export interface DailyLogFields {
  kind: "daily-log"; guildId: string; channelId: string; channel: string; day: string; timezone: string;
  header: { count: number; participants: string[]; stoppedAt: number | null };
  log: { topics: { name: string; keywords: { id: string[]; en: string[] }; links: string[] }[]; decided: LogItem[]; open: LogItem[]; next: { owner: string | null; task: string; due: string | null; links: string[] }[]; labels: Record<string, string> };
  leftOut?: string[]; topics: string[]; keywords: string[];
}

/** A Daily log's file from its fields: the body `render` in dailyLog.ts draws from them, under the fields as frontmatter. */
export function dailyLogText(f: DailyLogFields): string {
  const { log } = f, labels = log.labels, leftOut = f.leftOut ?? [], keywordsOf = (t: DailyLogFields["log"]["topics"][number]) => [...t.keywords.id, ...t.keywords.en];
  let n = 0;
  const row = (text: string, links: string[]) => `${++n}. ${text} ${links.map((l) => `[↗](${l})`).join(" ")}`;
  const block = (label: string, rows: string[]) => `## ${label}\n${rows.length ? rows.join("\n") : `*${labels.none}*`}`;
  const head = [`Topics: ${log.topics.map((t) => t.name).join(", ")}`, `Keywords: ${f.keywords.join(", ")}`, `${f.header.count} messages from ${f.header.participants.join(", ")}`].join("\n");
  const parts: [string, string, string[]][] = [
    ["topics", labels.topics!, log.topics.map((t) => row(keywordsOf(t).length ? `${t.name}: ${keywordsOf(t).join(", ")}` : t.name, t.links))],
    ["decided", labels.decided!, log.decided.map((i) => row(i.text, i.links))],
    ["open", labels.open!, log.open.map((i) => row(i.text, i.links))],
    ["next", labels.next!, log.next.map((a) => row(`${a.owner ? `**${a.owner}**` : `*${labels.noOwner}*`}: ${a.task}${a.due ? ` (${labels.due} ${a.due})` : ""}`, a.links))],
  ];
  const body = [`# Daily log #${f.channel}, ${f.day}\n\n${head}`, ...parts.filter(([part]) => !leftOut.includes(part)).map(([, label, rows]) => block(label, rows))].join("\n\n");
  return frontmatter({ ...f }, `${body}\n`);
}

function dailyLog(c: Channel, day: string, people: string[], count: number, topics: LogTopic[]): SeedFile {
  const rng = random(`log ${c} ${day}`), labels = LOG_LABELS[CHANNELS[c].language];
  const pool = messages(c, instant(day, "08:30"), instant(day, "18:30"), count, rng);
  // Each topic rests on its own run of the day's messages; an item links one or two of them.
  const per = Math.max(2, Math.floor(pool.length / Math.max(1, topics.length)));
  const log: DailyLogFields["log"] = { topics: [], decided: [], open: [], next: [], labels };
  topics.forEach((t, i) => {
    const slice = t.links ?? pool.slice(i * per, i * per + per);
    const at = (k: number) => [slice[Math.min(slice.length - 1, k)]!, ...(k % 2 ? [slice[Math.min(slice.length - 1, k + 1)]!] : [])].filter((l, j, all) => all.indexOf(l) === j);
    let k = 1;
    log.topics.push({ name: t.name, keywords: { id: t.id, en: t.en }, links: slice.slice(0, 4) });
    for (const text of t.decided ?? []) log.decided.push({ text, links: at(k++) });
    for (const text of t.open ?? []) log.open.push({ text, links: at(k++) });
    for (const [owner, task, due] of t.next ?? []) log.next.push({ owner, task, due, links: at(k++) });
  });
  const keywords = [...new Set(log.topics.flatMap((t) => [...t.keywords.id, ...t.keywords.en]))];
  const fields: DailyLogFields = { kind: "daily-log", guildId: GUILD, channelId: channelId(c), channel: c, day, timezone: ZONE, header: { count, participants: people, stoppedAt: null }, log, topics: log.topics.map((t) => t.name), keywords };
  return { ...(c === HOME ? {} : { channel: c }), path: `daily-logs/${day.slice(0, 7)}/${day}.md`, content: dailyLogText(fields) };
}

// ---- Minutes, as minutes.ts keeps them ----

const MINUTES_LABELS: Record<Lang, Record<string, string>> = {
  en: { decided: "Decided", open: "Still open", actions: "Action items", participants: "Participants", noOwner: "no owner yet", due: "due", none: "None" },
  id: { decided: "Diputuskan", open: "Masih terbuka", actions: "Tindak lanjut", participants: "Peserta", noOwner: "belum ada pemilik", due: "tenggat", none: "Tidak ada" },
};
const minutesSlug = (title: string) => title.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+/, "").slice(0, 48).replace(/-+$/, "") || "minutes";
export const minutesPath = (date: string, title: string) => `minutes/${date}-${minutesSlug(title)}.md`;

/** The meeting's messages, kept so the day's Daily log links the same ones. */
const meetingLinks = new Map<string, string[]>();

function minutes(m: (typeof MINUTES)[number]): SeedFile {
  const rng = random(`minutes ${m.channel} ${m.date} ${m.title}`), from = instant(m.date, m.at), to = from + m.minutes * 60_000;
  const pool = messages(m.channel, from, to, m.count, rng), labels = MINUTES_LABELS[m.language];
  meetingLinks.set(`${m.channel} ${m.date} ${m.title}`, pool);
  const pick = (k: number) => pool[Math.min(pool.length - 1, 2 + k * 3)]!;
  let k = 0;
  const content = { title: m.title, decided: m.decided.map((text) => ({ text, link: pick(k++) })), open: m.open.map((text) => ({ text, link: pick(k++) })), actions: m.actions.map(([owner, task, due]) => ({ owner, task, due, link: pick(k++) })), labels };
  const header = { from, to, count: m.count, participants: m.participants, cut: null, language: m.language };
  let n = 0;
  const row = (text: string, l: string) => `${++n}. ${text} [↗](${l})`;
  const rows = {
    decided: content.decided.map((i) => row(i.text, i.link)), open: content.open.map((i) => row(i.text, i.link)),
    actions: content.actions.map((a) => row(`${a.owner ? `**${a.owner}**` : `*${labels.noOwner}*`}: ${a.task}${a.due ? ` (${labels.due} ${a.due})` : ""}`, a.link)),
  };
  const count = m.language === "id" ? `${m.count} pesan` : `${m.count} message${m.count === 1 ? "" : "s"}`;
  const head = [`${stamp(from)} – ${stamp(to)} UTC · ${count}`, `${labels.participants}: ${m.participants.join(", ")}`].join("\n");
  const block = (key: "decided" | "open" | "actions") => `## ${labels[key]}\n${rows[key].length ? rows[key].join("\n") : `*${labels.none}*`}`;
  const body = [`# ${m.title}\n\n${head}`, block("decided"), block("open"), block("actions")].join("\n\n");
  const record = {
    title: m.title, guildId: GUILD, channelId: channelId(m.channel), postedIn: channelId(m.channel), messageId: snowflake(to + 60_000), requesterId: PEOPLE[m.requester ?? "Alice"],
    header, minutes: content, corrections: [], input: [],
  };
  return { ...(m.channel === HOME ? {} : { channel: m.channel }), path: minutesPath(m.date, m.title), content: withKeywords(frontmatter(record, `${body}\n`), m.keywords) };
}

// ---- Routine days ----

type Routine = { name: string; id: string[]; en: string[]; decided?: string[]; open?: string[]; next?: Action[] };
/** Everyday talk per channel: what fills the days the story skips. Same words as the story's topics turn up on purpose. */
const ROUTINE: Record<Channel, Routine[]> = {
  general: [
    { name: "Standup harian", id: ["standup", "update harian"], en: ["daily standup", "status update"] },
    { name: "Jadwal cuti", id: ["cuti", "izin"], en: ["leave", "time off"], next: [["Alice", "Update kalender cuti tim", null]] },
    { name: "Tagihan cloud bulan ini", id: ["tagihan", "biaya cloud"], en: ["cloud bill", "server cost"], open: ["Tagihan GCP naik sedikit dari bulan lalu, Tomi cek penyebabnya"] },
    { name: "Latency API jam sibuk", id: ["latency API", "lemot"], en: ["API latency", "p95", "response time"], open: ["p95 API naik ke 480 ms di jam sibuk"] },
    { name: "Makan siang bareng", id: ["makan siang", "traktiran"], en: ["team lunch"] },
    { name: "Perangkat tes", id: ["hp tes", "perangkat"], en: ["test devices", "phones"], next: [["Joko", "Catat perangkat tes yang dipinjam", null]] },
    { name: "Retro mingguan", id: ["retro", "evaluasi"], en: ["retrospective", "what went well"], decided: ["Retro pindah ke Jumat sore, 30 menit"] },
    { name: "Build internal", id: ["build internal", "TestFlight"], en: ["internal build", "release notes"], next: [["Joko", "Kirim catatan rilis build internal", "Jumat"]] },
    { name: "Wifi kantor", id: ["wifi", "internet kantor"], en: ["office wifi", "network"], open: ["Wifi lantai dua sering putus sore hari"] },
    { name: "Dokumentasi bantuan", id: ["dokumentasi", "pusat bantuan"], en: ["help docs", "documentation"] },
  ],
  "audio-engine": [
    { name: "CI flakiness on ARM runners", id: ["CI", "build gagal"], en: ["CI", "flaky tests", "ARM runner"], next: [["Rani", "Pin the NDK version on the ARM runners", null]] },
    { name: "Ring buffer tests", id: ["ring buffer", "unit test"], en: ["ring buffer", "unit tests"] },
    { name: "libopus upgrade", id: ["upgrade libopus"], en: ["libopus", "dependency upgrade"], open: ["libopus 1.5 changes the default complexity; check battery impact"] },
    { name: "Mixer profiling", id: ["profiling", "alokasi memori"], en: ["profiling", "allocations", "mixer"] },
    { name: "Device benchmarks", id: ["benchmark", "perangkat"], en: ["benchmark", "device farm"], next: [["Joko", "Run the nightly benchmark on the Galaxy A04", null]] },
    { name: "Limiter on loud intros", id: ["clipping", "limiter"], en: ["clipping", "limiter", "peaks"], open: ["Intros with music peaks still trip the limiter"] },
    { name: "Code review backlog", id: ["code review"], en: ["review backlog", "pull requests"] },
    { name: "Decoder fuzzing", id: ["fuzzing", "crash decoder"], en: ["fuzzing", "decoder crash"], next: [["Joko", "Add the fuzz corpus to CI", null]] },
    { name: "Headphone monitoring latency", id: ["monitoring", "latency headphone"], en: ["monitoring latency", "headphones", "round trip"], open: ["Round-trip monitoring latency is 40 ms on wired headphones"] },
  ],
  mobile: [
    { name: "TestFlight build", id: ["build TestFlight"], en: ["TestFlight build", "iOS build"], next: [["Bayu", "Upload the next TestFlight build", "Friday"]] },
    { name: "Play pre-launch report", id: ["laporan pre-launch"], en: ["pre-launch report", "Play Console"] },
    { name: "Dark mode", id: ["mode gelap"], en: ["dark mode", "theme"] },
    { name: "Crash-free rate", id: ["crash-free"], en: ["crash-free rate", "stability", "Crashlytics"], open: ["Crash-free sessions dipped to 98.9% on the last build"] },
    { name: "Gradle and build tooling", id: ["upgrade Gradle"], en: ["Gradle", "build tooling", "AGP"] },
    { name: "Accessibility", id: ["aksesibilitas"], en: ["accessibility", "VoiceOver", "TalkBack"], next: [["Mira", "List the controls without labels", null]] },
    { name: "Android 14 permissions", id: ["izin Android 14"], en: ["Android 14", "foreground service", "permissions"], open: ["Android 14 needs a foreground service type for recording"] },
    { name: "Waveform rendering", id: ["performa waveform"], en: ["waveform rendering", "frame drops", "scrolling"] },
    { name: "Push notifications", id: ["notifikasi"], en: ["push notifications", "FCM", "APNs"] },
    { name: "Bug triage", id: ["triase bug"], en: ["bug triage", "issues"], next: [["Joko", "Label the new issues from the testers", null]] },
  ],
  marketing: [
    { name: "Konten Instagram minggu ini", id: ["konten IG", "jadwal posting"], en: ["Instagram content", "posting schedule"], next: [["Sekar", "Jadwalkan posting Instagram minggu ini", null]] },
    { name: "Video TikTok", id: ["TikTok", "video pendek"], en: ["TikTok", "short video"] },
    { name: "Newsletter", id: ["newsletter", "email"], en: ["newsletter", "mailing list"] },
    { name: "Riset kompetitor", id: ["kompetitor"], en: ["competitor research"], open: ["Kompetitor baru muncul dengan fitur transkripsi"] },
    { name: "Komunitas podcaster", id: ["komunitas podcast"], en: ["podcaster community", "meetup"] },
    { name: "Deskripsi store", id: ["deskripsi app store"], en: ["store listing copy", "ASO"] },
    { name: "Press release partner", id: ["press release", "rilis pers"], en: ["press release", "partner"] },
    { name: "Data analitik berisik", id: ["data analitik", "metrik"], en: ["analytics", "noisy metrics", "tracking"], open: ["Event tracking dobel bikin data analitik berisik"] },
    { name: "Merchandise", id: ["kaos", "stiker"], en: ["merch", "stickers"] },
  ],
};
/** How often a channel talks on a working day the story leaves alone. */
const TALKS: Record<Channel, number> = { general: 1, "audio-engine": 0.9, mobile: 0.9, marketing: 0.7 };

/** What one Routine adds to a day: its name and keywords always, an item sometimes. */
function routine(r: Routine, rng: ReturnType<typeof random>): LogTopic {
  const some = rng.next() < 0.5;
  return { name: r.name, id: r.id, en: r.en, ...(some ? { decided: r.decided, open: r.open, next: r.next } : {}) };
}

function dailyLogs(): SeedFile[] {
  const out: SeedFile[] = [];
  for (const c of Object.keys(CHANNELS) as Channel[]) for (const day of workingDays()) {
    const rng = random(`day ${c} ${day}`);
    const story = DAYS.filter((d) => d.channel === c && d.date === day), meetings = MINUTES.filter((m) => m.channel === c && m.date === day);
    if (!story.length && !meetings.length && rng.next() >= TALKS[c]) continue;
    const people = new Set<string>(), topics: LogTopic[] = [];
    let count = 0;
    for (const m of meetings) {
      // The day of a meeting logs it too: its talk, and what the Minutes settled.
      topics.push({ name: m.title, id: m.keywords.keywords.slice(0, 4), en: m.keywords.keywords.slice(4, 8), decided: m.decided, open: m.open, next: m.actions, links: meetingLinks.get(`${m.channel} ${m.date} ${m.title}`)!.slice(0, 12) });
      m.participants.forEach((p) => people.add(p));
      count += m.count;
    }
    for (const d of story) {
      for (const [name, id, en] of d.topics) topics.push({ name, id, en });
      // The story's items belong to its last topic: a day that names two topics settles the second.
      Object.assign(topics.at(-1)!, { decided: d.decided, open: d.open, next: d.next });
      d.people.forEach((p) => people.add(p));
      count += d.count;
    }
    const extra = story.length || meetings.length ? (rng.next() < 0.4 ? 1 : 0) : rng.int(1, 3);
    const pool = [...ROUTINE[c]];
    for (let i = 0; i < extra; i++) topics.push(routine(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!, rng));
    for (const p of CHANNELS[c].people) if (people.size < 2 || rng.next() < 0.5) people.add(p);
    out.push(dailyLog(c, day, [...people], count + rng.int(8, 40), topics));
  }
  return out;
}

// ---- Decisions, Notes, Documents, Tasks, git ----

const at = (c: Channel) => (c === HOME ? {} : { channel: c });
const decisions = () => DECISIONS.map((d): SeedFile => ({ ...at(d.channel), path: `decisions/${d.date}-${d.slug}.md`, content: withKeywords(`${d.text}\n`, d.keywords) }));
const notes = () => NOTES.map((n): SeedFile => {
  const source = link(n.channel, snowflake(instant(n.date, "11:00")));
  return { ...at(n.channel), path: `notes/${n.date}-${n.slug}.md`, content: withKeywords(frontmatter({ source, author: n.author, askedBy: n.askedBy, date: n.date }, n.text), n.keywords) };
});
const documents = () => DOCUMENTS.map((d): SeedFile => ({ ...at(d.channel), path: `files/${d.name}`, content: d.name.endsWith(".md") ? withKeywords(`${d.text}\n`, d.keywords) : `${d.text}\n` }));

/** A corpus task's id: hex, in story order, so the tasks file names never collide with a brief's own seeded ones. */
export const taskId = (i: number) => `c${String(i + 1).padStart(7, "0")}-0000-4000-8000-000000000000`;
function tasks(): SeedFile[] {
  return TASKS.map((t, i): SeedFile => {
    const id = taskId(i), notes = (t.notes ?? []).map(([on, by, text]) => ({ on, by, text }));
    const updated = notes.at(-1)?.on ?? t.created;
    const task: Task = {
      id, title: t.title, description: t.description ?? null, status: t.status, priority: "medium",
      assignedTo: t.assignee ? { id: PEOPLE[t.assignee]!, name: t.assignee } : null, dueAt: t.due ?? null,
      createdBy: PEOPLE[t.by]!, createdByName: t.by, createdAt: `${t.created}T03:00:00.000Z`, updatedAt: `${updated}T10:00:00.000Z`, notes,
    };
    return { ...at(t.channel), path: `tasks/${taskSlug(t.title)}-${id.slice(0, 8)}.md`, content: renderTask(task) };
  });
}

const sha = (text: string) => {
  let out = "";
  for (let i = 0; out.length < 40; i++) { const r = random(`${text} ${i}`); out += Math.floor(r.next() * 0xffffffff).toString(16).padStart(8, "0"); }
  return out.slice(0, 40);
};
function git(): SeedGit {
  return {
    repos: ["gema/*"],
    pullRequests: PULLS.map((p) => ({ repo: p.repo, number: p.number, title: p.title, createdAt: `${p.created}T03:00:00Z`, author: p.author, ...(p.mergedAt ? { mergedAt: p.mergedAt } : {}), ...(p.closedAt ? { closedAt: p.closedAt } : {}) })),
    issues: ISSUES.map((i) => ({ repo: i.repo, number: i.number, title: i.title, createdAt: `${i.created}T03:00:00Z`, ...(i.closedAt ? { closedAt: i.closedAt } : {}) })),
    commits: COMMITS.map((c) => ({ repo: c.repo, sha: sha(`${c.repo} ${c.message}`), message: c.message, date: c.date })),
  };
}

/** Renders the corpus from the story; the same every time. */
export function buildLivedInCorpus(): Corpus {
  sequence = 0;
  meetingLinks.clear();
  const files = [...MINUTES.map(minutes), ...dailyLogs(), ...decisions(), ...notes(), ...documents(), ...tasks()];
  const morning = MORNING.map(([author, text, hhmm]): SeedMessage => ({ author, text, at: `2026-10-14T${hhmm}:00${OFFSET}` }));
  return { home: HOME, members: MEMBERS, files, messages: morning, git: git() };
}

let built: Corpus | undefined;
/** The lived-in corpus, built once per process. */
export const livedInCorpus = (): Corpus => (built ??= buildLivedInCorpus());

/** Kept material: everything but Tasks. */
export const keptFiles = (c: Corpus) => c.files.filter((f) => !f.path.startsWith("tasks/"));

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: bun apps/agent/eval/lived-in/corpus.ts <folder>");
  const corpus = livedInCorpus();
  for (const f of corpus.files) {
    const path = join(dir, f.channel ?? corpus.home, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.content);
  }
  writeFileSync(join(dir, "git.json"), `${JSON.stringify(corpus.git, null, 2)}\n`);
  console.log(`${corpus.files.length} files (${keptFiles(corpus).length} kept, ${corpus.files.length - keptFiles(corpus).length} Tasks) in ${dir}`);
}
