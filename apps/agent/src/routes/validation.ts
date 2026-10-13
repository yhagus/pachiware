import { HTTPException } from "hono/http-exception";
import { canonicalTimezone, isLanguage, type Language } from "@pachiware/skills";
import type { DigestChannel } from "@pachiware/db";

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
export function maskConfig(row: any) {
  if (!row) return null;
  const safe = { ...row };
  for (const field of ["openaiApiKeyEncrypted", "anthropicApiKeyEncrypted", "customApiKeyEncrypted"]) safe[field] = row[field] ? "••••••••" : null;
  return safe;
}
export function publicBot(row: any) {
  const { tokenEncrypted, ...safe } = row;
  return { ...safe, hasToken: Boolean(tokenEncrypted) };
}
