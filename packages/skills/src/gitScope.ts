import { repositories, patternCovers, assertHostAllowed, type GitAccount } from "@pachiware/db";
import type { SkillContext } from "./types.js";
import { getGitToken } from "./gitOAuth.js";
import type { GitConn } from "./git.js";

type Account = { id: string; name: string; provider: string; baseUrl: string | null; authType: string; [k: string]: any };
type Rule = { gitAccountId: string; channelId: string; repoPatterns: string[] };
/** An account the model may use here. A repo is allowed only when it matches every pattern set (server, then channel). */
export interface GitAccess { account: Account; sets: string[][] }

/** Server rules switch an account on and a channel rule narrows them; a thread uses its parent channel's rule, never its own. */
export function computeAccess(attached: Account[], rules: Rule[], channelId?: string, parentChannelId?: string): GitAccess[] {
  const place = parentChannelId || channelId;
  const channelRules = place ? rules.filter((r) => r.channelId === place) : [];
  const out: GitAccess[] = [];
  for (const account of attached) {
    const server = rules.find((r) => r.channelId === "" && r.gitAccountId === account.id);
    if (!server) continue;
    const sets = [server.repoPatterns];
    if (channelRules.length) {
      const own = channelRules.find((r) => r.gitAccountId === account.id);
      if (!own) continue;
      sets.push(own.repoPatterns);
    }
    out.push({ account, sets });
  }
  return out;
}

export function repoAllowed(access: GitAccess, repo: string): boolean {
  const name = repo.toLowerCase();
  return access.sets.every((set) => set.some((p) => patternCovers(p, name)));
}

/** An org/group is usable when some pattern in every set could match a repo inside it (so "acme/*" opens "acme"). */
export function orgAllowed(access: GitAccess, org: string): boolean {
  const probe = `${org.toLowerCase()}/x`;
  return access.sets.every((set) => set.some((p) => patternCovers(p, probe)));
}

/** `name` may be omitted only when exactly one account is usable. */
export function pickAccess(list: GitAccess[], name?: unknown): GitAccess {
  if (!list.length) throw new Error("No git account is enabled for this channel. An admin can enable one in the console under the server's git access.");
  const names = list.map((a) => a.account.name).join(", ");
  if (typeof name !== "string" || !name.trim()) {
    if (list.length === 1) return list[0]!;
    throw new Error(`Several git accounts are available; pass "account" with one of: ${names}`);
  }
  const hit = list.find((a) => a.account.name.toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new Error(`Unknown git account "${name}"; available: ${names}`);
  return hit;
}

export async function loadGitAccess(ctx: SkillContext & { parentChannelId?: string }): Promise<GitAccess[]> {
  if (!ctx.botId || !ctx.guildId) throw new Error("Git tools only work in a Discord server channel where git access has been enabled");
  const { git } = repositories();
  const attached = (await git.listBotAccounts(ctx.botId)).filter((a) => a.tenantId === ctx.tenantId);
  const rules = (await git.listScopes(ctx.botId, ctx.guildId)).filter((r) => r.tenantId === ctx.tenantId);
  return computeAccess(attached, rules, ctx.channelId, ctx.parentChannelId);
}

export async function connectionOf(access: GitAccess): Promise<GitConn> {
  const acc = access.account;
  assertHostAllowed(acc.baseUrl); // the allowlist may have changed since the account was saved
  return { provider: acc.provider as GitConn["provider"], baseUrl: acc.baseUrl, token: await getGitToken(acc as GitAccount), oauth: acc.authType === "oauth" };
}
