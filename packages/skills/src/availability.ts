import { db, availabilityRules } from "@pachiware/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { EFFECT_MEANING, type Effect, type SkillModule, type ToolDefinition } from "./types.js";
import { policyOf } from "./guardrails.js";
import { listPlaybooks, playbookChain, chainProblemText, type Playbook } from "./playbooks.js";

export const EFFECTS = Object.keys(EFFECT_MEANING) as Effect[];

/** Levels from the top: the tenant, a bot, a guild of that bot, a channel of that guild. */
export const AVAILABILITY_LEVELS = ["tenant", "bot", "guild", "channel"] as const;
export type AvailabilityLevel = (typeof AVAILABILITY_LEVELS)[number];
export const TARGET_KINDS = ["playbook", "skill", "tool", "effect"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];
export const RULE_VALUES = ["off", "opt_in", "on"] as const;
export type RuleValue = (typeof RULE_VALUES)[number];

/** What a rule is about. */
export interface Target { kind: TargetKind; name: string }
export interface AvailabilityRule extends Target { value: RuleValue }
/** One level's rules, looked up by targetKey. */
type LevelRules = Map<string, AvailabilityRule>;
const targetKey = (t: Target) => `${t.kind}:${t.name}`;
const valueAt = (rules: LevelRules, t: Target) => rules.get(targetKey(t))?.value;
/** One level of one tenant; the ids its level needs are set. */
export interface LevelKey { tenantId: string; level: AvailabilityLevel; botId?: string; guildId?: string; channelId?: string }
/** Where a message came from; a thread passes its parent channel. */
export interface Place { tenantId: string; botId?: string; guildId?: string; channelId?: string }

/**
 * Why a playbook cannot start: the playbook itself is off, a playbook its chain loads is off (or gone), its chain is broken
 * (a cycle or too deep), or skills some playbook of its chain requires are off (their ids).
 */
export type PlaybookCause = { off: "playbook" } | { off: "loads"; playbook: string } | { off: "chain"; problem: string } | { off: "skills"; skills: string[] };

export interface Availability {
  /** Tools of the tenant's enabled skills that are available here, sorted by name. A playbook's tools follow their playbook. */
  tools: ToolDefinition[];
  toolAvailable(name: string): boolean;
  /** Names of the playbooks that can start here. */
  playbooks: string[];
  /** Why the playbook cannot start here, or null when it can. A playbook the resolver was not given counts as off. */
  playbookCause(name: string): PlaybookCause | null;
  /** What rules turn off here, for the model: skill names, effects, skills with some tools off, playbooks off themselves. All empty when no rule takes anything away. */
  off: OffSummary;
}

export interface OffSummary { skills: string[]; effects: Effect[]; someToolsOff: string[]; playbooks: string[] }

export class AvailabilityError extends Error {}

const changeListeners = new Set<(tenantId: string) => void>();
/** Called with the tenant id when a rule above the channel level or a tenant skill switch changes; returns the unsubscribe function. */
export function onAvailabilityChanged(listener: (tenantId: string) => void) { changeListeners.add(listener); return () => changeListeners.delete(listener); }
export function availabilityChanged(tenantId: string) { for (const listener of changeListeners) listener(tenantId); }

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
  return (await db.select().from(availabilityRules).where(whereKey(key))).map(toRule).sort((a: AvailabilityRule, b: AvailabilityRule) => targetKey(a).localeCompare(targetKey(b)));
}

/** Why a rule cannot be written at this level, or null. `skills` is every registered skill. */
export function ruleProblem(key: LevelKey, rule: { kind: string; name: string; value: string }, skills: SkillModule[], playbooks: Pick<Playbook, "name" | "defaultOff">[] = []): string | null {
  if (!(TARGET_KINDS as readonly string[]).includes(rule.kind)) return `kind must be one of ${TARGET_KINDS.join(", ")}`;
  if (!(RULE_VALUES as readonly string[]).includes(rule.value)) return `value must be one of ${RULE_VALUES.join(", ")}`;
  const playbook = rule.kind === "playbook" ? playbooks.find((p) => p.name === rule.name) : undefined;
  if (rule.kind === "playbook" && !playbook) return `Unknown playbook "${rule.name}"`;
  if (rule.value === "opt_in" && key.level !== "bot" && key.level !== "guild") return "opt_in is only for a bot or a guild: it makes each level below say on";
  if (rule.value === "on" && key.level === "tenant") {
    if (!playbook?.defaultOff) return "on at the tenant is only for a playbook that starts off (default: off); everything else is on unless a rule turns it off";
  } else if (rule.value === "on" && key.level !== "guild" && key.level !== "channel") return "on is only for a guild or a channel, under an opt_in above it";
  if (rule.kind === "effect" && !(EFFECTS as readonly string[]).includes(rule.name)) return `Unknown effect "${rule.name}": use ${EFFECTS.join(", ")}`;
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
  const playbooks = rule.kind === "playbook" ? await listPlaybooks(key.tenantId) : [];
  const problem = ruleProblem(key, rule, skills, playbooks);
  if (problem) throw new AvailabilityError(problem);
  if (rule.value !== "off" && key.level !== "tenant") {
    const above = withDefaults(await rulesAt(key), playbooks).slice(0, AVAILABILITY_LEVELS.indexOf(key.level));
    // A tool is also off where its skill or its effect is off.
    const skill = rule.kind === "tool" ? skills.find((s) => s.tools.some((t) => t.name === rule.name)) : undefined;
    const covering: Target[] = [rule, ...(skill ? [{ kind: "skill", name: skill.id }, { kind: "effect", name: policyOf(skill, rule.name).effect }] as Target[] : [])];
    for (const [i, rules] of above.entries()) {
      const off = covering.find((t) => valueAt(rules, t) === "off");
      if (off) throw new AvailabilityError(`${off.name} is off at the ${AVAILABILITY_LEVELS[i]}; a level below cannot turn it back on`);
    }
    if (rule.value === "on" && !above.some((rules) => valueAt(rules, rule) === "opt_in")) throw new AvailabilityError(`on needs an opt_in above it; ${rule.name} is not opt-in at the bot or guild`);
  }
  // Insert-or-update in one statement each, so two writes of one target never both insert; the unique key is an expression index, hence no conflict target.
  const updatedAt = new Date();
  const inserted = await db.insert(availabilityRules).values({ tenantId: key.tenantId, level: key.level, ...keyColumns(key), targetKind: rule.kind, targetName: rule.name, value: rule.value, updatedAt }).onConflictDoNothing().returning();
  if (!inserted.length) await db.update(availabilityRules).set({ value: rule.value, updatedAt }).where(and(whereKey(key), eq(availabilityRules.targetKind, rule.kind), eq(availabilityRules.targetName, rule.name)));
  if (key.level !== "channel") availabilityChanged(key.tenantId);
}

export async function clearAvailabilityRule(key: LevelKey, target: { kind: string; name: string }): Promise<boolean> {
  const gone = await db.delete(availabilityRules).where(and(whereKey(key), eq(availabilityRules.targetKind, target.kind), eq(availabilityRules.targetName, target.name))).returning();
  if (gone.length && key.level !== "channel") availabilityChanged(key.tenantId);
  return gone.length > 0;
}

/** The rules on the way from the tenant down to this place, one map per level, top first. */
async function rulesAt(place: Place): Promise<LevelRules[]> {
  const rows = await db.select().from(availabilityRules).where(and(eq(availabilityRules.tenantId, place.tenantId), place.botId ? or(isNull(availabilityRules.botId), eq(availabilityRules.botId, place.botId)) : isNull(availabilityRules.botId)));
  const applies = (r: any) => r.level === "tenant" || r.level === "bot"
    || (r.level === "guild" && !!place.guildId && r.guildId === place.guildId)
    || (r.level === "channel" && !!place.guildId && !!place.channelId && r.guildId === place.guildId && r.channelId === place.channelId);
  return AVAILABILITY_LEVELS.map((level) => new Map(rows.filter((r: any) => r.level === level && applies(r)).map(toRule).map((r: AvailabilityRule) => [targetKey(r), r])));
}

/**
 * What the levels above this one leave it: every target a level above has a rule on, plus each skill the tenant switched off (`enabled` are the switched-on skills).
 * `available` is the resolver's walk; `off` names the highest level that turns the target off, `optIn` the lowest that made it opt-in.
 * A target that is not listed is available from above. The tenant inherits nothing.
 */
export async function inheritedAvailability(key: LevelKey, skills: SkillModule[], enabled: SkillModule[]): Promise<{ kind: TargetKind; name: string; available: boolean; off?: AvailabilityLevel; optIn?: AvailabilityLevel }[]> {
  const depth = AVAILABILITY_LEVELS.indexOf(key.level);
  if (depth === 0) return [];
  const levels = withDefaults(await rulesAt(key), await listPlaybooks(key.tenantId)).slice(0, depth);
  for (const s of skills) if (!enabled.some((e) => e.id === s.id)) { const off: AvailabilityRule = { kind: "skill", name: s.id, value: "off" }; levels[0]!.set(targetKey(off), off); }
  const targets = new Map(levels.flatMap((rules) => [...rules]));
  return [...targets.keys()].sort().map((k) => {
    const { kind, name } = targets.get(k)!;
    const values = levels.map((rules) => rules.get(k)?.value), off = values.indexOf("off"), optIn = values.lastIndexOf("opt_in");
    return { kind, name, available: allows(levels, kind, name), ...(off >= 0 ? { off: AVAILABILITY_LEVELS[off] } : {}), ...(optIn >= 0 ? { optIn: AVAILABILITY_LEVELS[optIn] } : {}) };
  });
}

/** The only walk down the levels: a target is available unless a level on the way turns it off, or opts in without a lower level saying on. */
function allows(levels: LevelRules[], kind: TargetKind, name: string): boolean {
  const values = levels.map((rules) => valueAt(rules, { kind, name }));
  if (values.includes("off")) return false;
  const optIn = values.lastIndexOf("opt_in");
  return optIn < 0 || values.slice(optIn + 1).includes("on");
}

/** The playbooks no rule (nor a `default: off` the tenant left alone) turns off at the tenant, the bot, or this guild: what the guild's command list offers. An opt_in counts, since a channel below can say on; channel rules and skills are checked at use. */
export async function playbooksListedIn(place: { tenantId: string; botId: string; guildId: string }, playbooks: Pick<Playbook, "name" | "defaultOff">[]): Promise<string[]> {
  const levels = withDefaults(await rulesAt(place), playbooks).slice(0, AVAILABILITY_LEVELS.indexOf("channel"));
  return playbooks.map((p) => p.name).filter((name) => !levels.some((rules) => valueAt(rules, { kind: "playbook", name }) === "off"));
}

/** A `default: off` playbook the tenant has no rule on is off at the tenant, as if the tenant had said so (ADR 0005). */
function withDefaults(levels: LevelRules[], playbooks: Pick<Playbook, "name" | "defaultOff">[]): LevelRules[] {
  const tenant = new Map(levels[0]);
  for (const p of playbooks) {
    const off: AvailabilityRule = { kind: "playbook", name: p.name, value: "off" };
    if (p.defaultOff && !tenant.has(targetKey(off))) tenant.set(targetKey(off), off);
  }
  return [tenant, ...levels.slice(1)];
}

/** What is available at a place. `skills` are the skills the tenant has switched on, `playbooks` the tenant's playbooks. */
export async function resolveAvailability(place: Place, skills: SkillModule[], playbooks: Pick<Playbook, "name" | "requires" | "loads" | "defaultOff">[]): Promise<Availability> {
  const ruled = await rulesAt(place), levels = withDefaults(ruled, playbooks);
  const skillOn = (id: string) => skills.some((s) => s.id === id) && allows(levels, "skill", id);
  // A chain runs whole or not at all: every playbook it loads must be on, and every skill any of them requires.
  const causes = new Map(playbooks.map((p): [string, PlaybookCause | null] => {
    if (!allows(levels, "playbook", p.name)) return [p.name, { off: "playbook" }];
    const found = playbookChain(p, playbooks);
    if ("problem" in found) return [p.name, "missing" in found.problem ? { off: "loads", playbook: found.problem.missing } : { off: "chain", problem: chainProblemText(found.problem) }];
    const chain = found.chain.map((name) => playbooks.find((x) => x.name === name)!);
    const loadedOff = chain.slice(1).find((x) => !allows(levels, "playbook", x.name));
    if (loadedOff) return [p.name, { off: "loads", playbook: loadedOff.name }];
    const off = [...new Set(chain.flatMap((x) => x.requires))].filter((id) => !skillOn(id));
    return [p.name, off.length ? { off: "skills", skills: off } : null];
  }));
  // A playbook tool follows its playbook instead of its own rule; every tool still obeys its effect.
  const tools = skills.filter((s) => skillOn(s.id))
    .flatMap((s) => s.tools.filter((t) => {
      const playbook = s.toolPolicy?.[t.name]?.playbook;
      return (playbook ? causes.get(playbook) === null : allows(levels, "tool", t.name)) && allows(levels, "effect", policyOf(s, t.name).effect);
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const names = new Set(tools.map((t) => t.name));
  const off: OffSummary = {
    skills: skills.filter((s) => !skillOn(s.id)).map((s) => s.name),
    effects: EFFECTS.filter((e) => !allows(levels, "effect", e)),
    someToolsOff: skills.filter((s) => skillOn(s.id) && s.tools.some((t) => !s.toolPolicy?.[t.name]?.playbook && !allows(levels, "tool", t.name))).map((s) => s.name),
    // A playbook off only by its default is not taken away by a rule, so the model is not told about it.
    playbooks: [...causes].filter(([name, cause]) => cause?.off === "playbook" && !allows(ruled, "playbook", name)).map(([name]) => name),
  };
  return {
    off,
    tools, toolAvailable: (name) => names.has(name),
    playbooks: [...causes].filter(([, cause]) => !cause).map(([name]) => name),
    playbookCause: (name) => (causes.has(name) ? causes.get(name)! : { off: "playbook" }),
  };
}
