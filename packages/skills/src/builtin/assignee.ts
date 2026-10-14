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
