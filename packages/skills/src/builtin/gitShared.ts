import type { SkillContext } from "../types.js";
import type { GitConn, GitState, ItemKind } from "../git.js";
import { queueAction } from "../gitConfirm.js";
import { hasThreadConfirmation, isGitWriteConfirmationOwner } from "../threadConfirmation.js";
import { actionKey, isDone, markDone } from "../guardrails.js";
import { loadGitAccess, pickAccess, connectionOf, repoAllowed, orgAllowed } from "../gitScope.js";

export const str = (v: unknown, name: string) => { if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`); return v.trim(); };
export const page = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 1);
export const STATES = ["open", "closed", "all"];
export const state = (v: unknown): GitState => { if (v === undefined) return "open"; if (!STATES.includes(v as string)) throw new Error("state must be open, closed or all"); return v as GitState; };

// The account is picked per call from what this server and channel allow; every repo is checked against that account's patterns.
export async function useRepo(a: any, ctx: SkillContext) {
  const access = pickAccess(await loadGitAccess(ctx), a?.account);
  const repo = str(a?.repo, "repo");
  if (!repoAllowed(access, repo)) throw new Error(`Repository ${repo} is not enabled for account "${access.account.name}" in this channel`);
  return { access, repo, conn: await connectionOf(access) };
}
export const KINDS = ["issue", "merge_request"];
export const kindOf = (v: unknown): ItemKind => { if (!KINDS.includes(v as string)) throw new Error("kind must be issue or merge_request"); return v as ItemKind; };
export const num = (v: unknown) => { if (!Number.isInteger(v) || (v as number) < 1) throw new Error("number must be a positive integer"); return v as number; };
export const clip = (t: string, n = 200) => (t.length > n ? `${t.slice(0, n)}…` : t);

export type Scope = "repo" | "org" | "account";
/** Discord user ids allowed to request and confirm "danger" actions. Empty means nobody, so those tools stay locked by default. */
// ponytail: env list for now; move to a per-bot owner list in the console when more than one deployment needs different owners.
export const isOwner = (ctx: SkillContext) => isGitWriteConfirmationOwner(ctx);

export async function useScope(a: any, ctx: SkillContext, scope: Scope) {
  if (scope === "repo") { const { access, repo, conn } = await useRepo(a, ctx); return { access, conn, target: repo }; }
  const access = pickAccess(await loadGitAccess(ctx), a?.account);
  const conn = await connectionOf(access);
  if (scope === "account") return { access, conn, target: "" };
  const org = str(a?.org, "org");
  if (!orgAllowed(access, org)) throw new Error(`Organization/group ${org} is not enabled for account "${access.account.name}" in this channel`);
  return { access, conn, target: org };
}

// Write tools only describe themselves the first time: the action is queued and a person has to press Confirm in Discord.
// The host re-runs the same call with ctx.confirmed set, which re-checks owner, account, scope and arguments before anything changes.
// `level` "owner" limits who may ask; it is set per call site and is independent of the tool's declared effect, which only describes the tool.
export async function guard(tool: string, a: any, ctx: SkillContext, level: "write" | "owner", scope: Scope, prep: (target: string, account: string) => { summary: string; run: (conn: GitConn) => Promise<unknown> }) {
  if (level === "owner" && !isOwner(ctx)) throw new Error("This action is limited to the bot's owners (Discord ids in GIT_OWNER_DISCORD_IDS). Tell the user they are not allowed to request it.");
  const { access, conn, target } = await useScope(a, ctx, scope);
  const p = prep(target, access.account.name);
  const summary = `${level === "owner" ?"⚠️ DANGEROUS: " : ""}${p.summary} [account ${access.account.name}]`;
  if (!ctx.botId || !ctx.userId || !ctx.guildId || !ctx.channelId) throw new Error("Write actions need a person to confirm them, which only works in a Discord channel");
  const key = actionKey(tool, a, ctx);
  if (isDone(key)) throw new Error("That exact action just ran. It was not repeated.");
  if (ctx.confirmed || hasThreadConfirmation(ctx)) {
    const result = await p.run(conn);
    markDone(key);
    return result;
  }
  const q = queueAction({ tenantId: ctx.tenantId, botId: ctx.botId, userId: ctx.userId, guildId: ctx.guildId, channelId: ctx.channelId, parentChannelId: ctx.parentChannelId, tool, args: a, summary });
  return { pending: true, confirmationId: q.id, summary, note: "Nothing has changed yet. Tell the user to press Confirm or Cancel on the message that appears in the channel. Do not call this tool again." };
}
export const confirmable = (tool: string, a: any, ctx: SkillContext, prep: (repo: string, account: string) => { summary: string; run: (conn: GitConn) => Promise<unknown> }) =>
  guard(tool, a, ctx, "write", "repo", (repo, account) => { const p = prep(repo, account); return { ...p, summary: p.summary.replace(/ \[account [^\]]*\]$/, "") }; });
export const acct = { type: "string", description: "Git account name; optional when only one account is available (see gitAccounts)" };
export const repoP = { type: "string", description: "Full name, e.g. owner/name (GitLab: group/subgroup/name)" };
export const pageP = { type: "number", description: "Page number, starting at 1 (30 items per page); keep going while hasMore is true" };
export const stateP = { type: "string", enum: STATES, description: "Default open" };

export const numberP = { type: "number", description: "Issue number, or PR number (GitLab: MR iid)" };
export const kindP = { type: "string", enum: KINDS, description: "issue, or merge_request for pull/merge requests" };
export const CONFIRM = " Needs the user's confirmation (a button in Discord) before it runs.";

