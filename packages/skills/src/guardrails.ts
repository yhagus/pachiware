import { createHash } from "node:crypto";
import { repositories } from "@pachiware/db";
import type { SkillContext, SkillModule, SkillScope, ToolCall, ToolPolicy } from "./types.js";
import { hasThreadConfirmation } from "./threadConfirmation.js";
import { hasPermission } from "./permissions.js";
import { replyLanguage, textIn, type Language } from "./language.js";

/**
 * observe: nothing is refused, would-be refusals are only logged.
 * write:   confirmation, rate/size limits and duplicate guard are enforced.
 * enforce: everything above plus scope, permission and prompt-injection refusals (default).
 */
export type GuardrailMode = "observe" | "write" | "enforce";
export const guardrailMode = (): GuardrailMode => (process.env.GUARDRAIL_MODE === "observe" || process.env.GUARDRAIL_MODE === "write" ? process.env.GUARDRAIL_MODE : "enforce");

/** `citation`: a link in a reply that no tool gave and nobody wrote (ADR 0014). */
export type GuardrailKind = "out_of_scope" | "unauthorized" | "prompt_injection" | "confirmation_required" | "limit" | "duplicate" | "citation";
export type GuardrailDecision = { allow: true } | { allow: false; kind: GuardrailKind; message: string };

export type AuditEvent = "guardrail_denied" | "tool_denied" | "confirmation_requested" | "confirmation_accepted" | "confirmation_expired" | "prompt_injection_detected" | "thread_confirmation_requested" | "thread_confirmation_granted" | "thread_confirmation_denied" | "thread_confirmation_expired" | "profile_fallback";

/** Web chat has no Workspace place to keep a long text as a Document, so it takes inline text up to this length. */
export const MAX_WEB_INPUT = 50_000;
export const MAX_ARGS = 8000;
const LIMITS = { user: 30, tenant: 120, writeTool: 10 }, WINDOW_MS = 60_000, COOLDOWN_MS = 60_000;

export const isEnforced = (kind: GuardrailKind, mode = guardrailMode()) =>
  mode === "enforce" || (mode === "write" && (kind === "confirmation_required" || kind === "limit" || kind === "duplicate"));

const deny = (kind: GuardrailKind, message: string): Extract<GuardrailDecision, { allow: false }> => ({ allow: false, kind, message });

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
/** The JSON object a model reply holds, from its first "{" to its last "}"; null when there is none. */
export function replyObject(reply: string | null): Record<string, any> | null {
  const text = reply ?? "", start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { const parsed = JSON.parse(text.slice(start, end + 1)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; }
}

const DISCOVERY = /\b(what (can|do) you (do|support)|your (skills|tools|capabilities|abilities)|which (skills|tools)|apa (saja )?yang (bisa|dapat) (kamu|kau|anda)|kamu bisa apa|fitur apa)\b/i;

export type RequestKind = "conversation" | "capability_discovery";

export const GuardrailService = {
  allowConversation: (): GuardrailDecision => ({ allow: true }),
  allowTool: (): GuardrailDecision => ({ allow: true }),
  denyOutOfScope: (message: string) => deny("out_of_scope", message),
  denyUnauthorized: (message: string) => deny("unauthorized", message),
  requireConfirmation: (message: string) => deny("confirmation_required", message),
  denyPromptInjection: (language?: Language) => deny("prompt_injection", textIn(language).guardInjection),
  /** A refusal for web chat text over MAX_WEB_INPUT characters. */
  limitLength: (message: string, language: Language = replyLanguage(message)): GuardrailDecision => (message.length > MAX_WEB_INPUT ? deny("limit", textIn(language).guardTooLong(MAX_WEB_INPUT)) : { allow: true }),
  /** A confirmed action needs a Discord channel for its Confirm button. */
  denyNoConfirmer: (language?: Language) => deny("confirmation_required", textIn(language).guardNoConfirmer),

  /** Runs before the ReAct loop on the assembled turn: refuses rule-rewriting messages, never long ones. Whether a skill can serve the request is the model's call, from the prompt. */
  classify(message: string, language: Language = replyLanguage(message)): { kind: RequestKind; decision: GuardrailDecision } {
    if (looksLikeInjection(message)) return { kind: "conversation", decision: this.denyPromptInjection(language) };
    if (DISCOVERY.test(message)) return { kind: "capability_discovery", decision: this.allowConversation() };
    return { kind: "conversation", decision: this.allowConversation() };
  },

  /** Runs inside SkillRegistry.executeTool, after the tool is known to be active for the tenant. Refusals are in the place's language, for the model to relay. */
  checkTool(skill: SkillModule, tool: string, args: unknown, ctx: SkillContext): GuardrailDecision {
    const t = textIn(ctx.language);
    if (JSON.stringify(args ?? {}).length > MAX_ARGS) return deny("limit", t.guardArgsTooLarge);
    const a = ctx.auth;
    if (a && (a.tenantId !== ctx.tenantId || a.botId !== ctx.botId || a.userId !== ctx.userId || a.guildId !== ctx.guildId || a.channelId !== ctx.channelId)) return this.denyUnauthorized(t.guardAuthMismatch);
    const present: Record<SkillScope, unknown> = { tenant: ctx.tenantId, guild: ctx.guildId, channel: ctx.channelId, user: ctx.userId };
    for (const s of skill.allowedScopes ?? []) if (!present[s]) return this.denyOutOfScope(t.guardOutOfScope(s));
    const policy = policyOf(skill, tool);
    const needs = policy.requiredPermissions ?? skill.requiredPermissions;
    if (policy.effect !== "read" && needs?.length && !hasPermission(ctx, ...needs)) return this.denyUnauthorized(t.guardPermission(needs.join(", ")));
    const who = ctx.userId ?? "anon";
    // A skill that confirms internally (git) runs its own duplicate guard behind Confirm, so the per-tool write limit and the checks below skip it.
    if (!hit(`t:${ctx.tenantId}`, LIMITS.tenant) || (!policy.metered && !hit(`u:${ctx.tenantId}:${who}`, LIMITS.user)) || (policy.effect !== "read" && !skill.confirmsInternally && !ctx.bulkApproved && !hit(`w:${ctx.tenantId}:${who}:${tool}`, LIMITS.writeTool))) return deny("limit", t.guardRateLimit);
    if (policy.effect !== "read" && !skill.confirmsInternally) {
      const until = done.get(actionKey(tool, args, ctx));
      if (until && until > Date.now()) return deny("duplicate", t.guardDuplicate);
      if (policy.requiresConfirmation && !ctx.confirmed && !hasThreadConfirmation(ctx)) return this.requireConfirmation(`${tool} ${redact(JSON.stringify(args ?? {})).slice(0, 600)}`);
    }
    return this.allowTool();
  },
};

/** Task writes that count toward a bulk change: more than BULK_TASK_LIMIT of them in one turn wait for the user's yes. */
export const BULK_TASK_TOOLS = new Set(["updateTaskStatus", "assignTask", "setTaskDueDate", "editTask", "moveTask", "createTask"]);
export const BULK_TASK_LIMIT = 3;
/** A task write as the bulk guard remembers it: the task id's first eight characters (its short form), or the title for a new task, and the change it makes. */
export type BulkItem = { tool: string; target: string; change: string };
/** A refused bulk, kept on the conversation for the asker's next turn only. */
export type BulkApproval = { userId: string; items: BulkItem[] };
export type BulkDecision = { allow: true; approved: Set<string> } | { allow: false; kind: "confirmation_required"; message: string; batch: BulkItem[] };

const normalized = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : value;
const bulkItem = (call: ToolCall): BulkItem => {
  const { taskId, ...rest } = call.arguments ?? {};
  // Every other argument, so a yes to "assign to Bob" does not cover "assign to Alice"; a left-out argument and an empty one read the same.
  // Hashed, so a long description is not copied into the conversation's metadata.
  const change = Object.entries(rest).filter(([, v]) => v != null && v !== "").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalized(v)]);
  return { tool: call.name, target: String(normalized(taskId != null ? String(taskId).trim().slice(0, 8) : rest.title ?? "")), change: createHash("sha256").update(JSON.stringify(change)).digest("hex").slice(0, 16) };
};
const sameItem = (a: BulkItem, b: BulkItem) => a.tool === b.tool && a.target === b.target && a.change === b.change;

const bulkMessage = (n: number) => `confirmation_required: none of these ${n} task changes ran, nothing changed. More than ${BULK_TASK_LIMIT} task changes in one turn need the user's yes first. List every task you meant to change, one per line as status | due | assignee | id | title (for a new task: title, assignee and due date), say what would happen to them, and wait for a yes. After the yes, make the same calls again.`;

/**
 * Counts one turn's task writes. Every response's calls are checked together before any runs, so a bulk is refused whole, never after its first few.
 * `approved` is the bulk the user was asked about last turn: calls matching it neither count nor wait.
 */
export function bulkTaskTurn(approved: BulkItem[] = []) {
  let written = 0, left = approved;
  return {
    check(calls: ToolCall[]): BulkDecision {
      const writes = calls.filter((c) => BULK_TASK_TOOLS.has(c.name));
      const remaining = [...left], matched = new Set<string>();
      for (const call of writes) {
        const item = bulkItem(call), i = remaining.findIndex((r) => sameItem(r, item));
        if (i >= 0) { remaining.splice(i, 1); matched.add(call.id); }
      }
      const counted = writes.length - matched.size;
      if (written + counted > BULK_TASK_LIMIT) return { allow: false, kind: "confirmation_required", message: bulkMessage(writes.length), batch: writes.map(bulkItem) };
      written += counted; left = remaining;
      return { allow: true, approved: matched };
    },
  };
}

/** Structured, categorical audit row. It never holds message text, model reasoning or secrets. */
export async function audit(ctx: Pick<SkillContext, "tenantId" | "botId">, event: AuditEvent, meta: Record<string, unknown>) {
  try { if (ctx.tenantId) await repositories().usage.record({ tenantId: ctx.tenantId, botId: ctx.botId || null, type: event, metadata: { mode: guardrailMode(), ...meta } }); } catch {}
}
