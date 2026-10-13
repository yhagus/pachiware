import { createHash } from "node:crypto";
import { usageEvents } from "@pachiware/db";
import type { SkillContext, SkillModule, ToolPolicy } from "./types.js";
import { hasThreadConfirmation } from "./threadConfirmation.js";

/**
 * observe: nothing is refused, would-be refusals are only logged.
 * write:   confirmation, rate/size limits and duplicate guard are enforced.
 * enforce: everything above plus scope, role and prompt-injection refusals (default).
 */
export type GuardrailMode = "observe" | "write" | "enforce";
export const guardrailMode = (): GuardrailMode => (process.env.GUARDRAIL_MODE === "observe" || process.env.GUARDRAIL_MODE === "write" ? process.env.GUARDRAIL_MODE : "enforce");

export type GuardrailKind = "out_of_scope" | "unauthorized" | "prompt_injection" | "confirmation_required" | "limit" | "duplicate";
export type GuardrailDecision = { allow: true } | { allow: false; kind: GuardrailKind; message: string };

export type AuditEvent = "guardrail_denied" | "tool_denied" | "confirmation_requested" | "confirmation_accepted" | "confirmation_expired" | "prompt_injection_detected" | "thread_confirmation_requested" | "thread_confirmation_granted" | "thread_confirmation_denied" | "thread_confirmation_expired";

export const MAX_INPUT = 4000;
export const MAX_ARGS = 8000;
const LIMITS = { user: 30, tenant: 120, writeTool: 10 }, WINDOW_MS = 60_000, COOLDOWN_MS = 60_000;

export const isEnforced = (kind: GuardrailKind, mode = guardrailMode()) =>
  mode === "enforce" || (mode === "write" && (kind === "confirmation_required" || kind === "limit" || kind === "duplicate"));

const deny = (kind: GuardrailKind, message: string): GuardrailDecision => ({ allow: false, kind, message });

// ponytail: counters live in memory, so they reset on restart and are per process; move to Redis when the agent runs on more than one instance.
const hits = new Map<string, number[]>();
const done = new Map<string, number>();
function hit(key: string, limit: number) {
  const now = Date.now(), recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}
export const resetGuardrailState = () => { hits.clear(); done.clear(); };

const stable = (v: any): string => v && typeof v === "object" ? (Array.isArray(v) ? `[${v.map(stable)}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)}}`) : JSON.stringify(v) ?? "null";
export const payloadHash = (tool: string, args: unknown) => createHash("sha256").update(`${tool}\n${stable(args)}`).digest("hex");
/** Same person, same place, same call: what "the same action" means for the duplicate guard. */
export const actionKey = (tool: string, args: unknown, c: SkillContext) => payloadHash(`${c.tenantId}|${c.userId ?? ""}|${c.guildId ?? ""}|${c.channelId ?? ""}|${tool}`, args);
export const isDone = (key: string) => { const until = done.get(key); return !!until && until > Date.now(); };
export const markDone = (key: string) => { done.set(key, Date.now() + COOLDOWN_MS); if (done.size > 2000) for (const [k, t] of done) if (t <= Date.now()) done.delete(k); };

export const policyOf = (skill: SkillModule, tool: string) => {
  const p = skill.toolPolicy?.[tool], effect = p?.effect ?? skill.effect ?? "read";
  return { effect, requiresConfirmation: p?.requiresConfirmation ?? skill.requiresConfirmation ?? effect !== "read", metered: p?.metered ?? false, requiredPermissions: p?.requiredPermissions };
};

// Phrases that try to rewrite the rules or pull out hidden material. Matching text is flagged, never obeyed.
const INJECTION = [
  /ignore (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules|prompts?)/i,
  /disregard (all |any |the |your )?(previous|prior|above|earlier|system) (instructions|rules|prompts?)/i,
  /(reveal|show|print|repeat|leak|tell me) (me )?(your |the )?(hidden |system |initial )?(prompt|instructions)/i,
  /\b(you are now|act as) (dan|an? unrestricted|an? unfiltered)/i,
  /(disable|bypass|turn off|ignore) (the |your |all )?(guardrails?|safety|restrictions?|confirmation|permissions?)/i,
  /\b(developer|jailbreak|god) mode\b/i,
  /abaikan (semua )?(instruksi|aturan|perintah) (sebelumnya|di atas)/i,
  /(tampilkan|bocorkan|tunjukkan) (system )?prompt/i,
];
export const looksLikeInjection = (text: string) => INJECTION.some((r) => r.test(text));

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE/i;
const SECRET_PATTERNS = [/\bsk-[A-Za-z0-9_-]{16,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bglpat-[A-Za-z0-9_-]{16,}/g, /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, /\b[MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}/g, /\b(Bearer|Basic) [A-Za-z0-9._~+/=-]{16,}/g];
const PATHS = /(?:\/(?:Users|home|root|var|opt|app|srv|etc|tmp|usr)\/[^\s"'`)\]},:;]+|[A-Za-z]:\\(?:Users|Windows|Program Files)[^\s"'`)\]},:;]*)/g;
/** Keeps credentials, env values and filesystem paths out of anything shown to a user or fed back to the model. */
export function redact(text: string): string {
  let out = text;
  for (const [name, value] of Object.entries(process.env)) if (value && value.length >= 8 && SECRET_NAME.test(name)) out = out.split(value).join("[redacted]");
  for (const r of SECRET_PATTERNS) out = out.replace(r, "[redacted]");
  return out.replace(PATHS, "[path]");
}
/** Tool output is data. The tags tell the model so; a closing tag inside the data cannot end the block early. */
export const asUntrusted = (source: string, text: string) => `<untrusted_data source="${source}">\n${text.replace(/<\/?untrusted_data[^>]*>/gi, "")}\n</untrusted_data>`;

const DISCOVERY = /\b(what (can|do) you (do|support)|your (skills|tools|capabilities|abilities)|which (skills|tools)|apa (saja )?yang (bisa|dapat) (kamu|kau|anda)|kamu bisa apa|fitur apa)\b/i;

export type RequestKind = "conversation" | "capability_discovery";

export const GuardrailService = {
  allowConversation: (): GuardrailDecision => ({ allow: true }),
  allowTool: (): GuardrailDecision => ({ allow: true }),
  denyOutOfScope: (message: string) => deny("out_of_scope", message),
  denyUnauthorized: (message: string) => deny("unauthorized", message),
  requireConfirmation: (message: string) => deny("confirmation_required", message),
  denyPromptInjection: (message = "I can't follow instructions that try to change my rules or reveal internal details.") => deny("prompt_injection", message),

  /** Runs before the ReAct loop: refuses oversized and rule-rewriting messages. Whether a skill can serve the request is the model's call, from the prompt. */
  classify(message: string): { kind: RequestKind; decision: GuardrailDecision } {
    if (message.length > MAX_INPUT) return { kind: "conversation", decision: deny("limit", `That message is too long (limit ${MAX_INPUT} characters). Please shorten it.`) };
    if (looksLikeInjection(message)) return { kind: "conversation", decision: this.denyPromptInjection() };
    if (DISCOVERY.test(message)) return { kind: "capability_discovery", decision: this.allowConversation() };
    return { kind: "conversation", decision: this.allowConversation() };
  },

  /** Runs inside SkillRegistry.executeTool, after the tool is known to be active for the tenant. */
  checkTool(skill: SkillModule, tool: string, args: unknown, ctx: SkillContext): GuardrailDecision {
    if (JSON.stringify(args ?? {}).length > MAX_ARGS) return deny("limit", "Tool arguments are too large.");
    const a = ctx.auth;
    if (a && (a.tenantId !== ctx.tenantId || a.botId !== ctx.botId || a.userId !== ctx.userId || a.guildId !== ctx.guildId || a.channelId !== ctx.channelId)) return this.denyUnauthorized("Authorization context does not match this request.");
    const present: Record<string, unknown> = { tenant: ctx.tenantId, guild: ctx.guildId, channel: ctx.channelId, user: ctx.userId, role: a };
    for (const s of skill.allowedScopes ?? []) if (!present[s]) return this.denyOutOfScope(`This action only works inside a Discord server channel (missing ${s}).`);
    const policy = policyOf(skill, tool);
    const needs = policy.requiredPermissions ?? skill.requiredPermissions;
    if (policy.effect !== "read" && needs?.length) {
      const perms = a?.permissions ?? [];
      if (!perms.includes("Administrator") && !needs.some((p) => perms.includes(p))) return this.denyUnauthorized(`You need one of these Discord permissions to ask for this: ${needs.join(", ")}.`);
    }
    const who = ctx.userId ?? "anon";
    // A skill that confirms internally (git) runs its own duplicate guard behind Confirm, so the per-tool write limit and the checks below skip it.
    if (!hit(`t:${ctx.tenantId}`, LIMITS.tenant) || (!policy.metered && !hit(`u:${ctx.tenantId}:${who}`, LIMITS.user)) || (policy.effect !== "read" && !skill.confirmsInternally && !hit(`w:${ctx.tenantId}:${who}:${tool}`, LIMITS.writeTool))) return deny("limit", "Too many requests right now. Wait a minute and try again.");
    if (policy.effect !== "read" && !skill.confirmsInternally) {
      const until = done.get(actionKey(tool, args, ctx));
      if (until && until > Date.now()) return deny("duplicate", "That exact action just ran. It was not repeated.");
      if (policy.requiresConfirmation && !ctx.confirmed && !hasThreadConfirmation(ctx)) return this.requireConfirmation(`${tool} ${redact(JSON.stringify(args ?? {})).slice(0, 600)}`);
    }
    return this.allowTool();
  },
};

/** Structured, categorical audit row. It never holds message text, model reasoning or secrets. */
export async function audit(ctx: Pick<SkillContext, "db" | "tenantId" | "botId">, event: AuditEvent, meta: Record<string, unknown>) {
  try { if (ctx.tenantId) await ctx.db.insert(usageEvents).values({ tenantId: ctx.tenantId, botId: ctx.botId || null, type: event, metadata: { mode: guardrailMode(), ...meta } }); } catch {}
}
