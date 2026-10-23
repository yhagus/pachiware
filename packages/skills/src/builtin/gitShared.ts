import type { SkillContext } from "../types.js";
import { readOf, type GitConn, type GitState, type ItemKind } from "../git.js";
import { confirmWrite, DANGER_PREFIX } from "../writeConfirmation.js";
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
  return { access, repo, conn: { ...(await connectionOf(access)), ...(ctx.callDeadline ? { deadline: ctx.callDeadline } : {}) } };
}
/** A read of the repository the call names, which says when the repository itself is gone (see `readOf`, #359). */
export async function readRepo<T>(a: any, ctx: SkillContext, read: (conn: GitConn, repo: string) => Promise<T>): Promise<T> {
  const { conn, repo } = await useRepo(a, ctx);
  return readOf(conn, repo, () => read(conn, repo));
}
export const KINDS = ["issue", "merge_request"];
export const kindOf = (v: unknown): ItemKind => { if (!KINDS.includes(v as string)) throw new Error("kind must be issue or merge_request"); return v as ItemKind; };
export const num = (v: unknown) => { if (!Number.isInteger(v) || (v as number) < 1) throw new Error("number must be a positive integer"); return v as number; };
export const clip = (t: string, n = 200) => (t.length > n ? `${t.slice(0, n)}…` : t);

export type Scope = "repo" | "org" | "account";

export async function useScope(a: any, ctx: SkillContext, scope: Scope) {
  if (scope === "repo") { const { access, repo, conn } = await useRepo(a, ctx); return { access, conn, target: repo }; }
  const access = pickAccess(await loadGitAccess(ctx), a?.account);
  const conn = { ...(await connectionOf(access)), ...(ctx.callDeadline ? { deadline: ctx.callDeadline } : {}) };
  if (scope === "account") return { access, conn, target: "" };
  const org = str(a?.org, "org");
  if (!orgAllowed(access, org)) throw new Error(`Organization/group ${org} is not enabled for account "${access.account.name}" in this channel`);
  return { access, conn, target: org };
}

// The Write confirmation helper queues the call; the confirmed re-run re-checks the asker, account, scope and arguments here.
// `level` "trusted" means Trusted members only; it is set per call site, apart from the tool's declared effect.
export async function guard(tool: string, a: any, ctx: SkillContext, level: "write" | "trusted", scope: Scope, prep: (target: string, account: string) => { summary: string; run: (conn: GitConn) => Promise<unknown> }) {
  return confirmWrite(ctx, { tool, args: a, access: level === "trusted" ? "trusted" : "anyone" }, async () => {
    const { access, conn, target } = await useScope(a, ctx, scope);
    const p = prep(target, access.account.name);
    return { summary: `${level === "trusted" ? DANGER_PREFIX : ""}${p.summary} [account ${access.account.name}]`, run: () => p.run(conn) };
  });
}
export const confirmable = (tool: string, a: any, ctx: SkillContext, prep: (repo: string, account: string) => { summary: string; run: (conn: GitConn) => Promise<unknown> }) =>
  guard(tool, a, ctx, "write", "repo", (repo, account) => { const p = prep(repo, account); return { ...p, summary: p.summary.replace(/ \[account [^\]]*\]$/, "") }; });
export const acct = { type: "string", description: "Git account name; optional when only one account is available (see gitAccounts)" };
export const repoP = { type: "string", description: "Full name, e.g. owner/name (GitLab: group/subgroup/name)" };
export const pageP = { type: "number", description: "Page number, starting at 1 (30 items per page); keep going while hasMore is true" };
export const stateP = { type: "string", enum: STATES, description: "Default open" };

export const numberP = { type: "number", description: "Issue number, or PR number (GitLab: MR iid)" };
export const kindP = { type: "string", enum: KINDS, description: "issue, or merge_request for pull/merge requests" };
export const labelsP = { type: "array", items: { type: "string" }, description: "Label names" };
export function labelsOf(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error("labels must be a list of label names");
  return v.map((x) => str(x, "label"));
}
export const CONFIRM = " Needs the user's confirmation (a button in Discord) before it runs.";

