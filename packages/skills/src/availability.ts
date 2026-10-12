import { db, availabilityRules } from "@pachiware/db";
import { and, eq, isNull, or } from "drizzle-orm";
import type { SkillModule, ToolDefinition } from "./types.js";
import { listPlaybooks, type Playbook } from "./playbooks.js";

/** Levels from the top: the tenant, a bot, a guild of that bot, a channel of that guild. */
export const AVAILABILITY_LEVELS = ["tenant", "bot", "guild", "channel"] as const;
export type AvailabilityLevel = (typeof AVAILABILITY_LEVELS)[number];
export const TARGET_KINDS = ["playbook", "skill", "tool", "effect"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];
export const RULE_VALUES = ["off", "opt_in", "on"] as const;
export type RuleValue = (typeof RULE_VALUES)[number];

export interface AvailabilityRule { kind: TargetKind; name: string; value: RuleValue }
/** One level of one tenant; the ids its level needs are set. */
export interface LevelKey { tenantId: string; level: AvailabilityLevel; botId?: string; guildId?: string; channelId?: string }
/** Where a message came from; a thread passes its parent channel. */
export interface Place { tenantId: string; botId?: string; guildId?: string; channelId?: string }

/** Why a playbook cannot start: the playbook itself is off, or skills it requires are off (their ids). */
export type PlaybookCause = { off: "playbook" } | { off: "skills"; skills: string[] };

export interface Availability {
  /** Tools of the tenant's enabled skills that are available here, sorted by name. A playbook's tools follow their playbook. */
  tools: ToolDefinition[];
  toolAvailable(name: string): boolean;
  /** Names of the playbooks that can start here. */
  playbooks: string[];
  /** Why the playbook cannot start here, or null when it can. A playbook the resolver was not given counts as off. */
  playbookCause(name: string): PlaybookCause | null;
}

export class AvailabilityError extends Error {}

/** The place of a tool context or a turn: a thread's rules are its parent channel's. */
export function availabilityPlace(ctx: { tenantId: string; botId?: string; guildId?: string; channelId?: string; parentChannelId?: string }): Place {
  return { tenantId: ctx.tenantId, botId: ctx.botId, guildId: ctx.guildId, channelId: ctx.parentChannelId || ctx.channelId };
}

const keyColumns = (k: LevelKey) => ({ botId: k.level === "tenant" ? null : k.botId!, guildId: k.level === "guild" || k.level === "channel" ? k.guildId! : "", channelId: k.level === "channel" ? k.channelId! : "" });
const whereKey = (k: LevelKey) => {
  const c = keyColumns(k);
  return and(eq(availabilityRules.tenantId, k.tenantId), eq(availabilityRules.level, k.level), c.botId === null ? isNull(availabilityRules.botId) : eq(availabilityRules.botId, c.botId), eq(availabilityRules.guildId, c.guildId), eq(availabilityRules.channelId, c.channelId));
};
const toRule = (r: any): AvailabilityRule => ({ kind: r.targetKind, name: r.targetName, value: r.value });

export async function listAvailabilityRules(key: LevelKey): Promise<AvailabilityRule[]> {
  return (await db.select().from(availabilityRules).where(whereKey(key))).map(toRule).sort((a: AvailabilityRule, b: AvailabilityRule) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
}

/** Why a rule cannot be written at this level, or null. `skills` is every registered skill. */
export function ruleProblem(key: LevelKey, rule: { kind: string; name: string; value: string }, skills: SkillModule[], playbooks: string[] = []): string | null {
  if (!(TARGET_KINDS as readonly string[]).includes(rule.kind)) return `kind must be one of ${TARGET_KINDS.join(", ")}`;
  if (!(RULE_VALUES as readonly string[]).includes(rule.value)) return `value must be one of ${RULE_VALUES.join(", ")}`;
  if (rule.value === "opt_in" && key.level !== "bot" && key.level !== "guild") return "opt_in is only for a bot or a guild: it makes each level below say on";
  if (rule.value === "on" && key.level !== "guild" && key.level !== "channel") return "on is only for a guild or a channel, under an opt_in above it";
  if (rule.kind === "effect") return "Effect rules are not supported yet";
  if (rule.kind === "playbook" && !playbooks.includes(rule.name)) return `Unknown playbook "${rule.name}"`;
  if (rule.kind === "skill") {
    if (!skills.some((s) => s.id === rule.name)) return `Unknown skill "${rule.name}"`;
    if (key.level === "tenant") return "Use the skill switch to turn a skill off for the tenant";
  }
  if (rule.kind === "tool") {
    const skill = skills.find((s) => s.tools.some((t) => t.name === rule.name));
    if (!skill) return `Unknown tool "${rule.name}"`;
    const playbook = skill.toolPolicy?.[rule.name]?.playbook;
    if (playbook) return `${rule.name} serves the ${playbook} playbook and follows it; it has no rule of its own`;
  }
  return null;
}

export async function setAvailabilityRule(key: LevelKey, rule: AvailabilityRule, skills: SkillModule[]): Promise<void> {
  const playbooks = rule.kind === "playbook" ? (await listPlaybooks(key.tenantId)).map((p) => p.name) : [];
  const problem = ruleProblem(key, rule, skills, playbooks);
  if (problem) throw new AvailabilityError(problem);
  if (rule.value === "on") {
    const above = (await rulesAt(key)).slice(0, AVAILABILITY_LEVELS.indexOf(key.level));
    if (!above.some((rules) => rules.get(`${rule.kind}:${rule.name}`) === "opt_in")) throw new AvailabilityError(`on needs an opt_in above it; ${rule.name} is not opt-in at the bot or guild`);
  }
  await clearAvailabilityRule(key, rule);
  await db.insert(availabilityRules).values({ tenantId: key.tenantId, level: key.level, ...keyColumns(key), targetKind: rule.kind, targetName: rule.name, value: rule.value, updatedAt: new Date() });
}

export async function clearAvailabilityRule(key: LevelKey, target: { kind: string; name: string }): Promise<boolean> {
  const gone = await db.delete(availabilityRules).where(and(whereKey(key), eq(availabilityRules.targetKind, target.kind), eq(availabilityRules.targetName, target.name))).returning();
  return gone.length > 0;
}

/** The rules on the way from the tenant down to this place, one map per level, top first. */
async function rulesAt(place: Place): Promise<Map<string, RuleValue>[]> {
  const rows = await db.select().from(availabilityRules).where(and(eq(availabilityRules.tenantId, place.tenantId), place.botId ? or(isNull(availabilityRules.botId), eq(availabilityRules.botId, place.botId)) : isNull(availabilityRules.botId)));
  const applies = (r: any) => r.level === "tenant" || r.level === "bot"
    || (r.level === "guild" && !!place.guildId && r.guildId === place.guildId)
    || (r.level === "channel" && !!place.guildId && !!place.channelId && r.guildId === place.guildId && r.channelId === place.channelId);
  return AVAILABILITY_LEVELS.map((level) => new Map(rows.filter((r: any) => r.level === level && applies(r)).map((r: any) => [`${r.targetKind}:${r.targetName}`, r.value as RuleValue])));
}

/** The only walk down the levels: a target is available unless a level on the way turns it off, or opts in without a lower level saying on. */
function allows(levels: Map<string, RuleValue>[], kind: TargetKind, name: string): boolean {
  const values = levels.map((rules) => rules.get(`${kind}:${name}`));
  if (values.includes("off")) return false;
  const optIn = values.lastIndexOf("opt_in");
  return optIn < 0 || values.slice(optIn + 1).includes("on");
}

/** What is available at a place. `skills` are the skills the tenant has switched on, `playbooks` the tenant's playbooks. */
export async function resolveAvailability(place: Place, skills: SkillModule[], playbooks: Pick<Playbook, "name" | "requires">[]): Promise<Availability> {
  const levels = await rulesAt(place);
  const skillOn = (id: string) => skills.some((s) => s.id === id) && allows(levels, "skill", id);
  const causes = new Map(playbooks.map((p): [string, PlaybookCause | null] => {
    if (!allows(levels, "playbook", p.name)) return [p.name, { off: "playbook" }];
    const off = p.requires.filter((id) => !skillOn(id));
    return [p.name, off.length ? { off: "skills", skills: off } : null];
  }));
  const tools = skills.filter((s) => skillOn(s.id))
    .flatMap((s) => s.tools.filter((t) => { const playbook = s.toolPolicy?.[t.name]?.playbook; return playbook ? causes.get(playbook) === null : allows(levels, "tool", t.name); }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const names = new Set(tools.map((t) => t.name));
  return {
    tools, toolAvailable: (name) => names.has(name),
    playbooks: [...causes].filter(([, cause]) => !cause).map(([name]) => name),
    playbookCause: (name) => (causes.has(name) ? causes.get(name)! : { off: "playbook" }),
  };
}
