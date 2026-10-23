import { HTTPException } from "hono/http-exception";
import { canonicalTimezone, isLanguage, docPatternError, MAX_DOC_PATTERNS, type Language } from "@pachiware/skills";
import type { DigestChannel, DailyLogChannel, DocSource } from "@pachiware/db";
import type { TurnRow } from "../loop/react.js";

export type PlaceSettings = { timezone?: string | null; language?: Language | null };
/** `timezone` (canonical IANA name) and `language` from a settings body; `nullable` lets a guild clear its override. */
export function placeSettings(body: Record<string, any>, nullable = false): PlaceSettings {
  const out: PlaceSettings = {};
  if (body.timezone !== undefined) {
    if (body.timezone === null && nullable) out.timezone = null;
    else {
      const zone = canonicalTimezone(body.timezone);
      if (!zone) throw new HTTPException(400, { message: "timezone must be an IANA zone name such as Asia/Jakarta" });
      out.timezone = zone;
    }
  }
  if (body.language !== undefined) {
    if (body.language === null && nullable) out.language = null;
    else if (!isLanguage(body.language)) throw new HTTPException(400, { message: 'language must be "id" or "en"' });
    else out.language = body.language;
  }
  return out;
}

export const MAX_IDLE_HOURS = 720;
/** `conversationIdleHours` from a tenant settings body: whole hours from 0 (never) to MAX_IDLE_HOURS; undefined when left out. */
export function conversationIdleHours(body: Record<string, any>): number | undefined {
  const hours = body.conversationIdleHours;
  if (hours === undefined) return undefined;
  if (!Number.isInteger(hours) || hours < 0 || hours > MAX_IDLE_HOURS) throw new HTTPException(400, { message: `conversationIdleHours must be a whole number of hours from 0 (never) to ${MAX_IDLE_HOURS}` });
  return hours;
}

export const MAX_MODEL_RETRY_WAIT_SECONDS = 600;
/** `modelRetryWaitSeconds` from a tenant settings body: whole seconds from 0 (pause at once) to MAX_MODEL_RETRY_WAIT_SECONDS; undefined when left out. */
export function modelRetryWaitSeconds(body: Record<string, any>): number | undefined {
  const seconds = body.modelRetryWaitSeconds;
  if (seconds === undefined) return undefined;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_MODEL_RETRY_WAIT_SECONDS) throw new HTTPException(400, { message: `modelRetryWaitSeconds must be a whole number of seconds from 0 (pause at once) to ${MAX_MODEL_RETRY_WAIT_SECONDS}` });
  return seconds;
}

export const MAX_PLAYBOOK_WORKERS = 5;
/** `playbookWorkers` from a tenant settings body: how many workers trace an API changelog's endpoints at once, 1 to MAX_PLAYBOOK_WORKERS; undefined when left out. */
export function playbookWorkers(body: Record<string, any>): number | undefined {
  const workers = body.playbookWorkers;
  if (workers === undefined) return undefined;
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_PLAYBOOK_WORKERS) throw new HTTPException(400, { message: `playbookWorkers must be a whole number from 1 to ${MAX_PLAYBOOK_WORKERS}` });
  return workers;
}

export const MAX_DIGEST_CHANNELS = 50;
/** `digestChannels` from a guild settings body: `{ channelId, hour }` entries, the hour a whole number from 0 to 23, one entry per channel. */
export function digestChannels(value: unknown): DigestChannel[] {
  if (!Array.isArray(value) || value.length > MAX_DIGEST_CHANNELS) throw new HTTPException(400, { message: `digestChannels must be an array of at most ${MAX_DIGEST_CHANNELS} entries` });
  const out: DigestChannel[] = [];
  for (const entry of value) {
    const channelId = entry && typeof entry === "object" && typeof entry.channelId === "string" ? entry.channelId.trim() : "";
    if (!channelId) throw new HTTPException(400, { message: "each digestChannels entry needs a channelId" });
    if (!Number.isInteger(entry.hour) || entry.hour < 0 || entry.hour > 23) throw new HTTPException(400, { message: "each digestChannels entry needs an hour from 0 to 23" });
    if (out.some((e) => e.channelId === channelId)) throw new HTTPException(400, { message: "a channel can hold one Digest" });
    out.push({ channelId, hour: entry.hour });
  }
  return out;
}

export const MAX_DAILY_LOG_CHANNELS = 50;
/** `dailyLogChannels` from a guild settings body: `{ channelId, backfill? }` entries, `backfill` a boolean that defaults to true, one entry per channel. */
export function dailyLogChannels(value: unknown): DailyLogChannel[] {
  if (!Array.isArray(value) || value.length > MAX_DAILY_LOG_CHANNELS) throw new HTTPException(400, { message: `dailyLogChannels must be an array of at most ${MAX_DAILY_LOG_CHANNELS} entries` });
  const out: DailyLogChannel[] = [];
  for (const entry of value) {
    const channelId = entry && typeof entry === "object" && typeof entry.channelId === "string" ? entry.channelId.trim() : "";
    if (!channelId) throw new HTTPException(400, { message: "each dailyLogChannels entry needs a channelId" });
    if (entry.backfill !== undefined && typeof entry.backfill !== "boolean") throw new HTTPException(400, { message: "backfill must be a boolean" });
    if (out.some((e) => e.channelId === channelId)) throw new HTTPException(400, { message: "a channel is listed once in dailyLogChannels" });
    out.push({ channelId, backfill: entry.backfill ?? true });
  }
  return out;
}

export const MAX_DOC_SOURCES = 50;
const REPO = /^[\w.-]+(\/[\w.-]+)+$/;
/**
 * `docSources` from a guild settings body: `{ channelId, repo, account?, paths }` entries, one per channel and repository. `repo` is an
 * owner/name path, kept lowercase; an empty `account` is left out; `paths` holds 1 to MAX_DOC_PATTERNS patterns (`docPatternError`), duplicates dropped.
 */
export function docSources(value: unknown): DocSource[] {
  if (!Array.isArray(value) || value.length > MAX_DOC_SOURCES) throw new HTTPException(400, { message: `docSources must be an array of at most ${MAX_DOC_SOURCES} entries` });
  const out: DocSource[] = [];
  for (const entry of value) {
    const e = entry && typeof entry === "object" ? entry : {};
    const channelId = typeof e.channelId === "string" ? e.channelId.trim() : "";
    if (!channelId) throw new HTTPException(400, { message: "each docSources entry needs a channelId" });
    const repo = typeof e.repo === "string" ? e.repo.trim().replace(/^\/+|\/+$/g, "").toLowerCase() : "";
    if (!REPO.test(repo)) throw new HTTPException(400, { message: "each docSources entry needs a repo as owner/name" });
    if (e.account != null && typeof e.account !== "string") throw new HTTPException(400, { message: "a docSources account must be a git account name" });
    const account = e.account?.trim();
    if (!Array.isArray(e.paths) || !e.paths.length || e.paths.length > MAX_DOC_PATTERNS || e.paths.some((p: unknown) => typeof p !== "string")) throw new HTTPException(400, { message: `each docSources entry needs 1 to ${MAX_DOC_PATTERNS} paths, such as README.md or docs/**` });
    const refused = e.paths.map(docPatternError).find(Boolean);
    if (refused) throw new HTTPException(400, { message: refused });
    if (out.some((s) => s.channelId === channelId && s.repo === repo)) throw new HTTPException(400, { message: "a repository is listed once per channel in docSources" });
    out.push({ channelId, repo, ...(account ? { account } : {}), paths: [...new Set<string>(e.paths.map((p: string) => p.trim()))] });
  }
  return out;
}

export function string(value: unknown, name: string, optional = false): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new HTTPException(400, { message: `${name} must be a non-empty string` });
  return value.trim();
}
export function object(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HTTPException(400, { message: `${name} must be an object` });
  return value as Record<string, any>;
}
export function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) throw new HTTPException(400, { message: `${name} must be an array of strings` });
  return value;
}
/** A server, channel or session id: letters, digits, `_` and `-`, since place ids become Workspace folder names. */
export function idOf(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[\w-]{1,64}$/.test(value)) throw new HTTPException(400, { message: `${name} must be an id of letters, digits, _ and -` });
  return value;
}

export const PLAYGROUND_HISTORY_ROWS = 200;
const PLAYGROUND_HISTORY_CHARS = 1_000_000;
const HISTORY_ROLES = new Set(["user", "assistant", "tool"]);
const isToolCall = (t: any) => !!t && typeof t.id === "string" && typeof t.name === "string" && !!t.arguments && typeof t.arguments === "object" && !Array.isArray(t.arguments);
/** The rows a Playground's earlier turns gave back, sent with the next turn; a row of any other shape is refused. */
export function playgroundHistory(value: unknown): TurnRow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PLAYGROUND_HISTORY_ROWS) throw new HTTPException(400, { message: `history must be a list of at most ${PLAYGROUND_HISTORY_ROWS} rows` });
  if (JSON.stringify(value).length > PLAYGROUND_HISTORY_CHARS) throw new HTTPException(400, { message: "history is too long; reset the Playground" });
  return value.map((row: any, i) => {
    const valid = !!row && typeof row === "object" && HISTORY_ROLES.has(row.role) && (row.content === null || typeof row.content === "string")
      && (row.toolCalls == null || (Array.isArray(row.toolCalls) && row.toolCalls.every(isToolCall))) && (row.toolCallId == null || typeof row.toolCallId === "string");
    if (!valid) throw new HTTPException(400, { message: `history row ${i} is not one the Playground gave back` });
    return { role: row.role, content: row.content, toolCalls: row.toolCalls ?? null, toolCallId: row.toolCallId ?? null };
  });
}
export function maskConfig(row: any) {
  if (!row) return null;
  const safe = { ...row };
  for (const field of ["openaiApiKeyEncrypted", "anthropicApiKeyEncrypted", "customApiKeyEncrypted"]) safe[field] = row[field] ? "••••••••" : null;
  return safe;
}
