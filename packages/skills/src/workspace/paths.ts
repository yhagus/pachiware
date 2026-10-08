import type { SkillContext } from "../types.js";

type Where = Pick<SkillContext, "guildId" | "channelId" | "parentChannelId" | "userId">;

const SEGMENT = /^[\p{L}\p{N}_-][\p{L}\p{N}._ -]*$/u;
const MAX_SEGMENT = 100, MAX_DEPTH = 8;

/** Discord ids are numeric; anything else must not become a folder name. */
export const safeId = (id: string | undefined) => (id && /^[\w-]{1,64}$/.test(id) ? id : undefined);

/** Tenant-relative folder behind each name the agent may use in a path; a name whose ids are missing is unreachable.
 *  A thread uses its parent channel's folder. Everything else (other channels, guilds, users) has no name here, so it cannot be addressed. */
export function visibleRoots(ctx: Where): Record<string, string> {
  const guild = safeId(ctx.guildId), channel = safeId(ctx.parentChannelId ?? ctx.channelId), user = safeId(ctx.userId);
  return {
    tenant: "shared",
    ...(guild ? { guild: `guilds/${guild}/shared` } : {}),
    ...(guild && channel ? { channel: `guilds/${guild}/channels/${channel}` } : {}),
    ...(!guild && user ? { dm: `dms/${user}` } : {}),
  };
}

/** Rejects any segment that is not a plain file or folder name. Shared by the agent's paths and the admin routes. */
export function checkSegments(parts: string[]) {
  if (parts.length > MAX_DEPTH) throw new Error("Path is too deep");
  for (const s of parts) if (s.length > MAX_SEGMENT || !SEGMENT.test(s) || s.endsWith(".")) throw new Error(`Invalid name "${s}"`);
}

/** Turns the agent's path ("channel/notes/a.md") into a tenant-relative one, or throws. This is the only place a path is trusted. */
export function resolvePath(ctx: Where, input: unknown, allowRoot = false): string {
  if (typeof input !== "string" || !input.trim()) throw new Error("path is required");
  if (input.includes("\0") || input.includes("\\") || input.startsWith("/")) throw new Error("Invalid path");
  const parts = input.replace(/\/$/, "").split("/");
  const root = visibleRoots(ctx)[parts[0]!];
  if (!root) throw new Error(`Unknown or unavailable folder "${parts[0]}". Available: ${Object.keys(visibleRoots(ctx)).join(", ") || "none here"}.`);
  const rest = parts.slice(1);
  if (!rest.length && !allowRoot) throw new Error("path must name a file");
  checkSegments(rest);
  return [root, ...rest].join("/");
}
