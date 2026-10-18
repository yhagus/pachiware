import type { SkillContext, ToolDefinition } from "../types.js";
import { parseFrontmatter, renderFrontmatter } from "../playbooks.js";
import { visibleRoots } from "../workspace/paths.js";
import { workspaceStore, WorkspaceConflict } from "../workspace/store.js";
import { holdsQuery, queriesTerms, wordingsOf } from "../workspace/terms.js";
import { ambiguousAssignee, resolveAssignee } from "./assignee.js";
import { DEFAULT_TIMEZONE, wallClock } from "../clock.js";
import { textIn } from "../language.js";

/**
 * The Team roster (#249): one per guild, the people the team keeps with their role, what they are responsible for and their time zone,
 * so "who owns the backend?" has a record to come from. Anyone in the guild may set a line, as anyone may assign a Task; each line says
 * who set it and when. It lives in the guild's shared folder, beside nothing a channel keeps.
 */
export interface TeamMember { name: string; id?: string; role?: string; owns?: string[]; timezone?: string; setBy: string; setOn: string }
const MAX_MEMBERS = 100, MAX_OWNS = 10, MAX_FIELD = 120;

const rosterPath = (ctx: SkillContext) => { const guild = visibleRoots(ctx).guild; return guild ? `${guild}/team.md` : null; };

/** The guild's roster with the file's version, or none when nobody set a line yet. */
export async function readRoster(ctx: SkillContext): Promise<{ members: TeamMember[]; version?: string }> {
  const path = rosterPath(ctx), file = path ? await workspaceStore().read(ctx.tenantId, path).catch(() => null) : null;
  const members = file ? parseFrontmatter(file.content)?.fields.members : null;
  return { members: Array.isArray(members) ? members.filter((m): m is TeamMember => !!m && typeof m.name === "string") : [], ...(file ? { version: file.version } : {}) };
}

/** One line as answers and the file show it: `Bob (<@id>) · backend lead · owns API, database · Asia/Jakarta · set by Alice 2026-10-19`. */
export const memberLine = (m: TeamMember) =>
  [`${m.name}${m.id ? ` (<@${m.id}>)` : ""}`, m.role, m.owns?.length ? `owns ${m.owns.join(", ")}` : "", m.timezone, `set by ${m.setBy} ${m.setOn}`].filter(Boolean).join(" · ");

const render = (members: TeamMember[]) => renderFrontmatter({ members }, `# Team roster\n\n${members.map((m) => `- ${memberLine(m)}`).join("\n")}\n`);

/** The roster lines that hold every word of one of the queries, in their name, role or what they own. */
export async function rosterMatches(ctx: SkillContext, wordings: string[]): Promise<TeamMember[]> {
  const queries = queriesTerms(wordings);
  if (!queries.length) return [];
  return (await readRoster(ctx)).members.filter((m) => holdsQuery(queries, [m.name, m.role ?? "", ...(m.owns ?? [])].join("\n")));
}

const field = (v: unknown, name: string) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`${name} must be text`);
  const t = v.replace(/\s+/g, " ").trim();
  if (t.length > MAX_FIELD) throw new Error(`${name} has at most ${MAX_FIELD} characters`);
  return t;
};
const zone = (v: unknown) => {
  const t = field(v, "timezone");
  if (!t) return t;
  try { new Intl.DateTimeFormat("en", { timeZone: t }); return t; } catch { throw new Error(`"${t}" is not a time zone: use a name such as Asia/Jakarta`); }
};

export const teamTools: ToolDefinition[] = [
  {
    name: "setTeamMember",
    description: "Keeps or changes one person's line in this server's Team roster, when someone tells you who does what (\"catat ya, Bob pegang backend\", \"Dewi is our designer, in Asia/Makassar\"): their role, what they are responsible for, their time zone. Fields left out stay as they were; owns replaces the list. remove takes the person off the roster. Anyone may set a line; each says who set it and when.",
    parameters: {
      type: "object",
      properties: {
        person: { type: "string", description: "A mention, \"me\" for the asker, or the name the team uses" },
        role: { type: "string", description: "Their role, e.g. \"backend lead\"" },
        owns: { type: "array", items: { type: "string" }, description: "What they are responsible for, e.g. [\"API\", \"database\"]" },
        timezone: { type: "string", description: "Their time zone, e.g. Asia/Jakarta" },
        remove: { type: "boolean", description: "true takes the person off the roster" },
      },
      required: ["person"],
    },
  },
  {
    name: "teamRoster",
    description: "Reads this server's Team roster: who has which role, what they are responsible for, and their time zone, each line with who set it and when. query keeps the lines holding its words (\"backend\", \"design\"). For \"who works on X\", also look at the Assignees recall or listTasks give.",
    parameters: { type: "object", properties: { query: { type: "string" }, queries: { type: "array", items: { type: "string" } } } },
  },
];

export const teamHandlers = {
  setTeamMember: async (args: Record<string, unknown>, ctx: SkillContext) => {
    const path = rosterPath(ctx);
    if (!path) throw new Error(textIn(ctx.language).teamNoGuild);
    if (typeof args.person !== "string" || !args.person.trim()) throw new Error("person is required");
    const who = await resolveAssignee(args.person, ctx);
    if ("candidates" in who) return ambiguousAssignee(args.person, who.candidates);
    const { members, version } = await readRoster(ctx);
    const same = (m: TeamMember) => (who.assignee.id ? m.id === who.assignee.id : !m.id && m.name.toLowerCase() === who.assignee.name.toLowerCase());
    const before = members.find(same), rest = members.filter((m) => !same(m));
    if (args.remove === true || args.remove === "true") {
      if (!before) return { success: false, message: textIn(ctx.language).teamNotListed(who.assignee.name) };
      await write(ctx, path, rest, version);
      return { success: true, removed: who.assignee.name };
    }
    const owns = args.owns === undefined ? before?.owns : Array.isArray(args.owns) ? args.owns.map((o) => field(o, "owns")!).filter(Boolean).slice(0, MAX_OWNS) : (() => { throw new Error("owns must be a list"); })();
    const w = wallClock(ctx.timezone ?? DEFAULT_TIMEZONE), pad = (n: number) => String(n).padStart(2, "0");
    const role = args.role === undefined ? before?.role : field(args.role, "role"), timezone = args.timezone === undefined ? before?.timezone : zone(args.timezone);
    const member: TeamMember = {
      name: who.assignee.name, ...(who.assignee.id ? { id: who.assignee.id } : {}), ...(role ? { role } : {}), ...(owns?.length ? { owns } : {}), ...(timezone ? { timezone } : {}),
      setBy: ctx.userName || ctx.userId || "someone", setOn: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    };
    if (!before && rest.length >= MAX_MEMBERS) throw new Error(`The roster holds at most ${MAX_MEMBERS} people.`);
    await write(ctx, path, [...rest, member].sort((a, b) => a.name.localeCompare(b.name)), version);
    return { success: true, line: memberLine(member), ...(who.nameOnly ? { nameOnly: true } : {}) };
  },
  teamRoster: async (args: Record<string, unknown>, ctx: SkillContext) => {
    if (!rosterPath(ctx)) throw new Error(textIn(ctx.language).teamNoGuild);
    const wordings = wordingsOf(args.query, args.queries);
    const members = wordings.length ? await rosterMatches(ctx, wordings) : (await readRoster(ctx)).members;
    return { total: members.length, lines: members.map(memberLine), ...(members.length ? {} : { note: textIn(ctx.language).teamEmpty }) };
  },
};

async function write(ctx: SkillContext, path: string, members: TeamMember[], version?: string) {
  try { await workspaceStore().write(ctx.tenantId, path, render(members), version); }
  catch (e) { if (e instanceof WorkspaceConflict) throw new Error("The roster was changed by someone else just now. Try again."); throw e; }
}
