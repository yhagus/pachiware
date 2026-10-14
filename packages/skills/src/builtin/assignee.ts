import type { SkillContext } from "../types.js";

/** A task's Assignee: a guild member, by Discord user id with their display name at the time it was set, or a person known only by name. */
export interface Assignee { name: string; id?: string }

const MENTION = /^<@!?([\w-]+)>$/;
const MAX_NAME = 100;

/** An Assignee from a task file or the REST API, or null. Plain text, the format before assignees were structured, is a name only; an object is a member when it carries an id. */
export function parseAssignee(value: unknown): Assignee | null {
  if (typeof value === "string") return value.trim() ? { name: value.trim().slice(0, MAX_NAME) } : null;
  if (!value || typeof value !== "object") return null;
  const { id, name } = value as Record<string, unknown>;
  const member = typeof id === "string" && id.trim() ? id.trim() : undefined;
  const label = typeof name === "string" && name.trim() ? name.trim().slice(0, MAX_NAME) : member;
  if (!label) return null;
  return member ? { id: member, name: label } : { name: label };
}

/** The frontmatter value of an Assignee: a JSON object, id first for a member, or null. */
export const renderAssignee = (a: Assignee | null) => JSON.stringify(a ? (a.id ? { id: a.id, name: a.name } : { name: a.name }) : null);

/** The assignee column of a task line. */
export const assigneeLabel = (a: Assignee | null) => a?.name ?? "unassigned";

/** Whether a filter typed by a person names this Assignee: the name in any case, or a member's id or mention. */
export function assigneeMatches(a: Assignee | null, filter: string): boolean {
  if (!a || typeof filter !== "string" || !filter.trim()) return false;
  const key = filter.trim(), id = MENTION.exec(key)?.[1] ?? key;
  return (!!a.id && a.id === id) || a.name.toLowerCase() === key.toLowerCase();
}

/** Whether this Assignee is the given person: a member by id only, a name-only Assignee by any of the person's names, ignoring case. */
export function isAssignee(a: Assignee | null, person: { id?: string | null; names?: (string | null | undefined)[] }): boolean {
  if (!a) return false;
  if (a.id) return a.id === person.id;
  const name = a.name.toLowerCase();
  return (person.names ?? []).some((n) => !!n && n.toLowerCase() === name);
}

type Asker = Pick<SkillContext, "userId" | "userName" | "guildId" | "discord">;
/** What an assignee typed by a person resolves to: one Assignee (`nameOnly` when no member matched), or several members to choose from. */
export type ResolvedAssignee = { assignee: Assignee; nameOnly: boolean } | { candidates: (Assignee & { username?: string })[] };

const SELF = new Set(["me", "myself", "saya", "aku"]);

/** The guild members whose display name or username is exactly `name`, ignoring case; none outside a guild. */
async function membersNamed(name: string, ctx: Asker) {
  if (!ctx.guildId || !ctx.discord) return [];
  const key = name.toLowerCase(), found = await ctx.discord.listMembers({ query: name, limit: 25 });
  return [...new Map(found.filter((m) => m.displayName.toLowerCase() === key || m.username?.toLowerCase() === key).map((m) => [m.id, m])).values()];
}

/** Who a person means: a mention is that member, "me" is the asker, a name is the one member it matches, else a name only. */
export async function resolveAssignee(text: string, ctx: Asker): Promise<ResolvedAssignee> {
  const key = text.trim().slice(0, MAX_NAME), mentioned = MENTION.exec(key)?.[1];
  if (mentioned) {
    const m = await ctx.discord?.getMember(mentioned).catch(() => null);
    return { assignee: { id: mentioned, name: m?.displayName ?? mentioned }, nameOnly: false };
  }
  if (SELF.has(key.toLowerCase()) && ctx.userId) return { assignee: { id: ctx.userId, name: ctx.userName || ctx.userId }, nameOnly: false };
  const found = await membersNamed(key, ctx);
  if (found.length > 1) return { candidates: found.map((m) => ({ id: m.id, name: m.displayName, username: m.username })) };
  if (found.length === 1) return { assignee: { id: found[0]!.id, name: found[0]!.displayName }, nameOnly: false };
  return { assignee: { name: key }, nameOnly: true };
}

/** A name-only Assignee linked to the one guild member its name matches; anything else unchanged. */
export async function linkAssignee(a: Assignee | null, ctx: Asker): Promise<Assignee | null> {
  if (!a || a.id) return a;
  const found = await membersNamed(a.name, ctx).catch(() => []);
  return found.length === 1 ? { id: found[0]!.id, name: found[0]!.displayName } : a;
}

/** The listTasks assignee filter: `assigneeMatches`, plus the members a typed name or "me" resolves to. */
export async function assigneeFilter(filter: string, ctx: Asker): Promise<(a: Assignee | null) => boolean> {
  const key = filter.trim(), ids = new Set<string>();
  if (SELF.has(key.toLowerCase()) && ctx.userId) ids.add(ctx.userId);
  else if (key && !MENTION.test(key)) for (const m of await membersNamed(key, ctx).catch(() => [])) ids.add(m.id);
  return (a) => assigneeMatches(a, key) || (!!a?.id && ids.has(a.id));
}

/** The tool result when a name matched several members: nothing changed, the candidates to ask about. */
export const ambiguousAssignee = (text: string, candidates: (Assignee & { username?: string })[]) => ({
  success: false,
  ambiguous: true,
  message: `"${text.trim()}" matches ${candidates.length} members: ${candidates.map((c) => c.username && c.username !== c.name ? `${c.name} (${c.username})` : c.name).join(", ")}. Nothing was changed; ask which one is meant.`,
  candidates,
});

/** What a confirmation adds when an Assignee was recorded by name only. */
export const nameOnlyNote = (a: Assignee) => ` ${a.name} was recorded by name only: no server member matches that name, so the bot cannot reach them.`;
