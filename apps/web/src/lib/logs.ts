/** The agent's logs for the Console page: history from `/api/admin/logs`, the live tail from its stream (ADR 0017). */
import { getPlatformKey } from "@/lib/api";

const BASE_URL = import.meta.env.VITE_API_URL || "";

export type LogLevel = "debug" | "info" | "warn" | "error";
/** Most severe first, as the level filter shows them. */
export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

/** `run` names one start of the agent process; `seq` counts its lines. */
export interface LogEntry { id: string; run: string; seq: number; time: string; level: LogLevel; source: string; text: string }

export interface LogFilters {
  from?: string;
  to?: string;
  /** Empty: every level. */
  levels: LogLevel[];
  /** Empty: every source. */
  sources: string[];
  q: string;
  regex: boolean;
  caseSensitive: boolean;
}

export interface LogPage { entries: LogEntry[]; truncated: boolean; sources: string[]; run: string; cursor: number; retentionDays: number; dir: string }

function queryString(f: LogFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.levels.length) p.set("level", f.levels.join(","));
  if (f.sources.length) p.set("source", f.sources.join(","));
  if (f.q) p.set("q", f.q);
  if (f.regex) p.set("regex", "1");
  if (f.caseSensitive) p.set("case", "1");
  return p.toString();
}

async function adminFetch(path: string, signal?: AbortSignal) {
  const res = await fetch(`${BASE_URL}/api/admin${path}`, { headers: { "X-Platform-Key": getPlatformKey() }, signal, cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res;
}

export async function fetchLogs(f: LogFilters, limit: number, signal?: AbortSignal): Promise<LogPage> {
  return (await adminFetch(`/logs?${queryString(f, { limit: String(limit) })}`, signal)).json();
}

/** Saves every matching line in the range (up to the server's text limit) as a `.log` file. */
export async function downloadLogs(f: LogFilters): Promise<void> {
  const res = await adminFetch(`/logs?${queryString(f, { format: "text" })}`);
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "pachiware-agent.log";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type StreamState = "connecting" | "live" | "retrying";

/**
 * Follows the live tail from the line after `after` of `run`, reconnecting after a dropped connection from the last line it
 * got. The key goes in a header, never the URL, so the stream is read with fetch rather than EventSource. Ends when `signal` aborts.
 */
export async function followLogs(start: { run: string; after: number }, on: { log(e: LogEntry): void; state(s: StreamState): void }, signal: AbortSignal) {
  let { run, after } = start;
  while (!signal.aborted) {
    on.state("connecting");
    try {
      const res = await adminFetch(`/logs/stream?${new URLSearchParams({ run, after: String(after) })}`, signal);
      const reader = res.body!.getReader(), decoder = new TextDecoder();
      let buffer = "";
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        buffer += decoder.decode(read.value, { stream: true });
        for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (event === "hello") on.state("live");
          if (event === "log" && data) {
            const entry: LogEntry = JSON.parse(data);
            run = entry.run;
            after = entry.seq;
            on.log(entry);
          }
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    on.state("retrying");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** The search box's matcher, the server's rules: words in any case unless `caseSensitive`; null for an empty or invalid regex. */
export function textMatcher(q: string, regex: boolean, caseSensitive: boolean): ((s: string) => boolean) | null {
  if (!q) return null;
  if (regex) {
    const pattern = compile(q, caseSensitive ? "" : "i");
    return pattern ? (s) => pattern.test(s) : null;
  }
  const needle = caseSensitive ? q : q.toLowerCase();
  return (s) => (caseSensitive ? s : s.toLowerCase()).includes(needle);
}

export const compile = (q: string, flags: string) => { try { return new RegExp(q, flags); } catch { return null; } };

/** Whether a live line passes the filters the history was read with. */
export function passes(e: LogEntry, f: LogFilters, text: ((s: string) => boolean) | null): boolean {
  return (!f.levels.length || f.levels.includes(e.level)) && (!f.sources.length || f.sources.includes(e.source)) && (!text || text(e.text) || text(e.source));
}

/** `text` split into plain and matching parts, for highlighting the search. */
export function matchParts(text: string, q: string, regex: boolean, caseSensitive: boolean): { text: string; hit: boolean }[] {
  if (!q) return [{ text, hit: false }];
  const pattern = regex ? compile(q, caseSensitive ? "g" : "gi") : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  if (!pattern) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (!m[0]) continue;
    if (m.index! > last) parts.push({ text: text.slice(last, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

/** One line as the downloaded file has it. */
export const logLine = (e: LogEntry) => `${e.time} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.text}`;

/** When a run started: its id is the start time in base 36. */
export const runStart = (run: string) => new Date(parseInt(run, 36));
