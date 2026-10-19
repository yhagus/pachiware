/**
 * Agent logs: every line the agent process writes through `console`, kept for the Console page (ADR 0017). A line still goes to
 * the terminal; it is also kept in a ring of the newest lines in memory, for the live tail, and appended to one JSON-lines file
 * per UTC day under the log folder, kept `retentionDays` days. Text shaped like a credential is masked before a line is kept.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { format } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** `id` is `<run>-<seq>`: `run` names one start of the agent process, `seq` counts its lines from 1. */
export interface LogEntry { id: string; run: string; seq: number; time: string; level: LogLevel; source: string; text: string }

export interface LogQuery {
  from?: Date;
  to?: Date;
  levels?: LogLevel[];
  sources?: string[];
  /** Matched against the text and the source: words as written, or a regular expression when `regex` is set. */
  q?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  /** The newest `limit` matching lines are returned. */
  limit: number;
}

/** `sources` are those of every line in the time range, before the other filters, so a filter can offer them all. */
export interface LogPage { entries: LogEntry[]; truncated: boolean; sources: string[] }

const FILE = /^agent-(\d{4}-\d{2}-\d{2})\.jsonl$/;
/** A leading tag such as `[HTTP]` or `[daily-log]` names the line's source; `[+]` is not a tag. */
const TAG = /^\[([a-z][a-z0-9-]*)\]\s*/i;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const DAY_MS = 86_400_000;

/** Text that looks like a credential: an API key of this platform, a bearer token, a Discord bot token or other JWT-shaped token. */
const SECRETS: [RegExp, string][] = [
  [/\b(pk_[A-Za-z0-9]+_)[A-Za-z0-9_-]{20,}/g, "$1••••"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1••••"],
  [/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, "••••"],
];
export const maskSecrets = (text: string) => SECRETS.reduce((t, [pattern, mask]) => t.replace(pattern, mask), text);

/** A matcher for the search box: case-insensitive words unless `caseSensitive`; a bad regular expression throws. */
export function textMatcher(q: string | undefined, regex = false, caseSensitive = false): ((s: string) => boolean) | null {
  if (!q) return null;
  if (regex) {
    const pattern = new RegExp(q, caseSensitive ? "" : "i");
    return (s) => pattern.test(s);
  }
  const needle = caseSensitive ? q : q.toLowerCase();
  return (s) => (caseSensitive ? s : s.toLowerCase()).includes(needle);
}

/** One line as the downloaded `.log` file has it. */
export const logLine = (e: LogEntry) => `${e.time} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.text}`;

export class AgentLog {
  readonly run = Date.now().toString(36);
  private seq = 0;
  private ring: LogEntry[] = [];
  private listeners = new Set<(entry: LogEntry) => void>();
  private dirReady = false;
  private writeFailed = false;
  /** Told once when a line cannot be written to its file, until a write works again; the line is still kept in memory. */
  onFileError?: (error: Error) => void;

  constructor(readonly dir: string, readonly retentionDays = 7, private readonly memoryLines = 5000, private readonly now = () => new Date()) {}

  /** The seq of the newest line so far; lines after it are the ones `recent(run, cursor)` replays. */
  get cursor() { return this.seq; }

  record(level: LogLevel, args: unknown[]): LogEntry {
    const raw = maskSecrets(format(...args).replace(ANSI, ""));
    const tag = TAG.exec(raw);
    const seq = ++this.seq;
    const entry: LogEntry = { id: `${this.run}-${seq}`, run: this.run, seq, time: this.now().toISOString(), level, source: tag ? tag[1]!.toLowerCase() : "agent", text: tag ? raw.slice(tag[0].length) : raw };
    this.ring.push(entry);
    if (this.ring.length > this.memoryLines) this.ring.splice(0, this.ring.length - this.memoryLines);
    this.write(entry);
    for (const listener of this.listeners) { try { listener(entry); } catch { /* a listener never stops a line */ } }
    return entry;
  }

  /** Lines of this run after `after`, from memory; every line in memory when `run` is another run's (the agent restarted). */
  recent(run: string | undefined, after: number): LogEntry[] {
    return run === this.run ? this.ring.filter((e) => e.seq > after) : [...this.ring];
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Reads the day files the range touches, oldest first, keeping the newest `limit` matches. */
  async query(q: LogQuery): Promise<LogPage> {
    const from = q.from?.getTime() ?? -Infinity, to = q.to?.getTime() ?? Infinity;
    const text = textMatcher(q.q, q.regex, q.caseSensitive);
    const levels = q.levels?.length ? new Set(q.levels) : null;
    const sources = q.sources?.length ? new Set(q.sources) : null;
    const seen = new Set<string>();
    let out: LogEntry[] = [];
    let matched = 0;
    for (const { day, path } of this.files()) {
      const start = Date.parse(`${day}T00:00:00Z`);
      if (start > to || start + DAY_MS <= from) continue;
      for await (const line of linesOf(path)) {
        let e: LogEntry;
        try { e = JSON.parse(line); } catch { continue; }
        const t = Date.parse(e.time);
        if (!(t >= from && t <= to)) continue;
        seen.add(e.source);
        if ((levels && !levels.has(e.level)) || (sources && !sources.has(e.source)) || (text && !text(e.text) && !text(e.source))) continue;
        matched++;
        out.push(e);
        if (out.length > 2 * q.limit) out = out.slice(-q.limit);
      }
    }
    return { entries: out.slice(-q.limit), truncated: matched > q.limit, sources: [...seen].sort() };
  }

  /** Removes day files older than `retentionDays` (today counts as one); other files in the folder are left alone. */
  prune(): string[] {
    const oldest = utcDay(new Date(this.now().getTime() - (this.retentionDays - 1) * DAY_MS));
    const removed = this.files().filter(({ day }) => day < oldest);
    for (const { path } of removed) rmSync(path, { force: true });
    return removed.map(({ path }) => path);
  }

  private files(): { day: string; path: string }[] {
    let names: string[];
    try { names = readdirSync(this.dir); } catch { return []; }
    return names.map((name) => FILE.exec(name)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ day: m[1]!, path: join(this.dir, m[0]) })).sort((a, b) => a.day.localeCompare(b.day));
  }

  private write(entry: LogEntry) {
    try {
      if (!this.dirReady) { mkdirSync(this.dir, { recursive: true }); this.dirReady = true; }
      appendFileSync(join(this.dir, `agent-${entry.time.slice(0, 10)}.jsonl`), JSON.stringify(entry) + "\n");
      this.writeFailed = false;
    } catch (e) {
      if (!this.writeFailed) this.onFileError?.(e as Error);
      this.writeFailed = true;
    }
  }
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** A file's lines, read in chunks so a large day file is never held whole. */
async function* linesOf(path: string): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let rest = "";
  try {
    const reader = Bun.file(path).stream().getReader();
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const parts = (rest + decoder.decode(read.value, { stream: true })).split("\n");
      rest = parts.pop()!;
      for (const part of parts) if (part) yield part;
    }
  } catch { return; }
  rest += decoder.decode();
  if (rest) yield rest;
}

/** The log folder: `LOG_DIR`, resolved like the SQLite path (against PACHIWARE_DIR, else the working directory), or `data/logs`. */
export function logDir(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.PACHIWARE_DIR || process.cwd(), env.LOG_DIR || "data/logs");
}

let shared: AgentLog | null = null;
/** The process's agent log, made on first use. */
export function agentLog(): AgentLog {
  return (shared ??= new AgentLog(logDir(), Math.max(1, Number(process.env.LOG_RETENTION_DAYS) || 7)));
}

const METHODS: [keyof Console & ("debug" | "log" | "info" | "warn" | "error"), LogLevel][] = [["debug", "debug"], ["log", "info"], ["info", "info"], ["warn", "warn"], ["error", "error"]];

/** The installed log and the terminal's own `console.log`, while installAgentLog is in effect. */
let active: { log: AgentLog; terminal: (...args: unknown[]) => void } | null = null;

/** Writes to the terminal's standard output, as `console.log` does, but keeps the line at `level` (the HTTP log uses it). */
export function logAt(level: LogLevel, ...args: unknown[]): void {
  if (!active) { console.log(...args); return; }
  active.terminal.apply(console, args);
  try { active.log.record(level, args); } catch { /* the terminal already has the line */ }
}
const PRUNE_EVERY_MS = 6 * 3_600_000;

/**
 * Sends every console line of this process to `log` as well as the terminal, prunes old day files now and every six hours, and
 * returns a function that puts console back. Called once at startup, before anything else logs.
 */
export function installAgentLog(log: AgentLog = agentLog()): () => void {
  const original = Object.fromEntries(METHODS.map(([m]) => [m, console[m]])) as Record<(typeof METHODS)[number][0], (...args: unknown[]) => void>;
  let busy = false;
  for (const [method, level] of METHODS) {
    console[method] = (...args: unknown[]) => {
      original[method]!.apply(console, args);
      if (busy) return;
      busy = true;
      try { log.record(level, args); } catch { /* the terminal already has the line */ } finally { busy = false; }
    };
  }
  active = { log, terminal: original.log! };
  log.onFileError = (e) => original.error!.call(console, `[logs] Could not write to ${log.dir} (${e.message}); new lines are kept in memory only until a write works again.`);
  const prune = () => { try { log.prune(); } catch { /* tried again later */ } };
  prune();
  const timer = setInterval(prune, PRUNE_EVERY_MS);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    active = null;
    for (const [method] of METHODS) console[method] = original[method] as any;
  };
}
