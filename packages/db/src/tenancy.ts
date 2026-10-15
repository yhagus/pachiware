import { eq, and, ne, inArray } from "drizzle-orm";
import { db, bots, gitAccounts, botGitAccounts, gitScopes, skills, tenantSkills } from "./index.js";

/** Git accounts attached to a bot (many). Replaces the set; scopes of removed accounts cascade away. */
export async function listBotGitAccounts(botId: string) {
  return db.select({ id: gitAccounts.id, name: gitAccounts.name, provider: gitAccounts.provider, baseUrl: gitAccounts.baseUrl, username: gitAccounts.username })
    .from(botGitAccounts).innerJoin(gitAccounts, eq(gitAccounts.id, botGitAccounts.gitAccountId)).where(eq(botGitAccounts.botId, botId));
}
export async function setBotGitAccounts(tenantId: string, botId: string, ids: string[]) {
  const want = [...new Set(ids)];
  if (want.length) {
    const owned = await db.select({ id: gitAccounts.id }).from(gitAccounts).where(and(eq(gitAccounts.tenantId, tenantId), inArray(gitAccounts.id, want)));
    if (owned.length !== want.length) throw new Error("Git account not found");
  }
  const have = (await db.select({ id: botGitAccounts.gitAccountId }).from(botGitAccounts).where(eq(botGitAccounts.botId, botId))).map((r: any) => r.id);
  const drop = have.filter((id: string) => !want.includes(id));
  if (drop.length) {
    // ponytail: SQLite connections may run with FK enforcement off, so cascade explicitly.
    await db.delete(gitScopes).where(and(eq(gitScopes.botId, botId), inArray(gitScopes.gitAccountId, drop)));
    await db.delete(botGitAccounts).where(and(eq(botGitAccounts.botId, botId), inArray(botGitAccounts.gitAccountId, drop)));
  }
  const add = want.filter((id) => !have.includes(id));
  if (add.length) {
    await db.insert(botGitAccounts).values(add.map((gitAccountId) => ({ tenantId, botId, gitAccountId })));
    await enableGitSkill(tenantId);
  }
}
/** The git skill ships off; attaching an account is the moment someone wants it. Git stays closed anywhere without a server rule, so this opens nothing by itself. */
async function enableGitSkill(tenantId: string) {
  const [skill] = await db.select({ id: skills.id }).from(skills).where(eq(skills.id, "git_repositories")).limit(1);
  if (!skill) return;
  const where = and(eq(tenantSkills.tenantId, tenantId), eq(tenantSkills.skillId, skill.id));
  const [row] = await db.select().from(tenantSkills).where(where).limit(1);
  if (!row) await db.insert(tenantSkills).values({ tenantId, skillId: skill.id, isEnabled: true });
  else if (!row.isEnabled) await db.update(tenantSkills).set({ isEnabled: true, updatedAt: new Date() }).where(where);
}
export async function botsUsingGitAccount(tenantId: string, accountId: string) {
  return db.select({ id: bots.id, name: bots.name }).from(botGitAccounts).innerJoin(bots, eq(bots.id, botGitAccounts.botId))
    .where(and(eq(botGitAccounts.tenantId, tenantId), eq(botGitAccounts.gitAccountId, accountId), ne(bots.connectionStatus, "deleted")));
}

export type GitScopeRule = { gitAccountId: string; repoPatterns: string[] };
export async function listGitScopes(botId: string, guildId: string) {
  return db.select().from(gitScopes).where(and(eq(gitScopes.botId, botId), eq(gitScopes.guildId, guildId)));
}
function cleanPatterns(p: string[]) {
  const out = [...new Set((p || []).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!out.length) throw new Error("repoPatterns must not be empty");
  if (out.some((x) => !/^[a-z0-9_.*\/-]+$/.test(x))) throw new Error("Invalid repo pattern");
  return out;
}
/** Replace the rules of one scope. channelId "" = server level; channel rules must be a subset of the server rules. */
export async function replaceGitScopes(tenantId: string, botId: string, guildId: string, channelId: string, rules: GitScopeRule[]) {
  const attached = new Set((await db.select({ id: botGitAccounts.gitAccountId }).from(botGitAccounts).where(eq(botGitAccounts.botId, botId))).map((r: any) => r.id));
  const seen = new Set<string>();
  const clean = rules.map((r) => {
    if (!attached.has(r.gitAccountId)) throw new Error("Git account is not attached to this bot");
    if (seen.has(r.gitAccountId)) throw new Error("Duplicate git account in rules");
    seen.add(r.gitAccountId);
    return { gitAccountId: r.gitAccountId, repoPatterns: cleanPatterns(r.repoPatterns) };
  });
  if (channelId) {
    const server = new Map<string, string[]>((await listGitScopes(botId, guildId)).filter((r: any) => r.channelId === "").map((r: any) => [r.gitAccountId, r.repoPatterns as string[]]));
    for (const r of clean) {
      const parent = server.get(r.gitAccountId);
      if (!parent) throw new Error("Channel rule needs the account enabled on the server first");
      // Every channel pattern must be covered by a server pattern ("*" or identical, or "org/*" covering "org/x").
      for (const pat of r.repoPatterns) if (!parent.some((sp) => patternCovers(sp, pat))) throw new Error(`Pattern "${pat}" is wider than the server rule`);
    }
  }
  await db.delete(gitScopes).where(and(eq(gitScopes.botId, botId), eq(gitScopes.guildId, guildId), eq(gitScopes.channelId, channelId)));
  if (clean.length) await db.insert(gitScopes).values(clean.map((r) => ({ tenantId, botId, guildId, channelId, ...r, updatedAt: new Date() })));
  if (!channelId) {
    // Narrowing a server rule must not leave channel rules wider than it.
    const keep = new Map(clean.map((r) => [r.gitAccountId, r.repoPatterns]));
    const chans = (await listGitScopes(botId, guildId)).filter((r: any) => r.channelId !== "");
    for (const c of chans) {
      const parent = keep.get(c.gitAccountId);
      if (!parent) await db.delete(gitScopes).where(eq(gitScopes.id, c.id));
      else {
        const narrowed = (c.repoPatterns as string[]).filter((pat) => parent.some((sp) => patternCovers(sp, pat)));
        if (narrowed.length !== c.repoPatterns.length) {
          if (narrowed.length) await db.update(gitScopes).set({ repoPatterns: narrowed }).where(eq(gitScopes.id, c.id));
          else await db.delete(gitScopes).where(eq(gitScopes.id, c.id));
        }
      }
    }
  }
}
/** True when every repo matched by `sub` is also matched by `sup`. "*" is the only wildcard; a `*` inside `sub` only fits a wildcard of `sup`. */
export function patternCovers(sup: string, sub: string): boolean {
  if (sup === "*" || sup === sub) return true;
  const re = new RegExp("^" + sup.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(sub);
}
