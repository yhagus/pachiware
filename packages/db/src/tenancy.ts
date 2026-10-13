import { randomUUID } from "node:crypto";
import { eq, and, or, isNull, ne, sql, inArray } from "drizzle-orm";
import { db, tenants, apiKeys, bots, guildConfigs, gitAccounts, botGitAccounts, gitScopes, availabilityRules, agentsConfig, skills, tenantSkills, activeDialect } from "./index.js";
import { seedTenant } from "./seed.js";
import { encryptSecret, decryptSecret, hashApiKey, generateApiKey } from "./crypto.js";

export async function getTenantById(id: string) {
  return (await db.select().from(tenants).where(and(eq(tenants.id, id), ne(tenants.status, "deleted"))).limit(1))[0] || null;
}
export async function getTenantBySlug(slug: string) {
  return (await db.select().from(tenants).where(and(eq(tenants.slug, slug), ne(tenants.status, "deleted"))).limit(1))[0] || null;
}
export async function getApiKeyByRaw(raw: string) {
  if (!raw || raw.length > 256) return null;
  return (await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hashApiKey(raw)), isNull(apiKeys.revokedAt))).limit(1))[0] || null;
}
// A key only reaches tenants created under it; `ref` is a tenant id or slug.
export async function getTenantForApiKey(apiKeyId: string, ref: string) {
  return (await db.select().from(tenants).where(and(eq(tenants.apiKeyId, apiKeyId), or(eq(tenants.id, ref), eq(tenants.slug, ref)), ne(tenants.status, "deleted"))).limit(1))[0] || null;
}
export async function listTenantsForApiKey(apiKeyId: string) {
  return db.select().from(tenants).where(and(eq(tenants.apiKeyId, apiKeyId), ne(tenants.status, "deleted")));
}
export async function issueApiKey(name = "API Key", scopes: string[] = ["*"]) {
  const key = generateApiKey();
  const [row] = await db.insert(apiKeys).values({ name, scopes, keyPrefix: key.keyPrefix, keyHash: hashApiKey(key.raw) }).returning();
  return { ...key, keyId: row.id };
}
export async function revokeApiKey(keyId: string) {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
}
export async function touchApiKeyLastUsed(keyId: string) {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
}
export async function createTenant(input: { name: string; slug?: string; apiKeyId?: string; metadata?: Record<string, any> }) {
  const values = { id: randomUUID(), name: input.name, slug: input.slug || randomUUID(), apiKeyId: input.apiKeyId ?? null, platformMetadata: input.metadata || {} };
  if (activeDialect === "sqlite") {
    // Bun SQLite transactions must stay synchronous to retain rollback semantics.
    return db.transaction((tx: any) => {
      const row = tx.insert(tenants).values(values).returning().get();
      tx.insert(agentsConfig).values({ tenantId: row.id, timezone: "Asia/Jakarta", language: "id", temperature: 0.2, settings: { maxReActIterations: 32 } }).run();
      for (const skill of tx.select().from(skills).all()) {
        tx.insert(tenantSkills).values({ tenantId: row.id, skillId: skill.id, isEnabled: skill.defaultEnabled, config: skill.config }).run();
      }
      return row;
    });
  }
  return db.transaction(async (tx: any) => {
    const [row] = await tx.insert(tenants).values(values).returning();
    await seedTenant(row.id, tx);
    return row;
  });
}
export async function updateTenant(id: string, input: { name?: string; status?: string; metadata?: Record<string, any> }) {
  const update: Record<string, any> = { updatedAt: new Date() };
  if (input.name !== undefined) update.name = input.name;
  if (input.status !== undefined) {
    if (!["active", "suspended", "deleted"].includes(input.status)) throw new Error("Invalid tenant status");
    update.status = input.status;
  }
  if (input.metadata !== undefined) update.platformMetadata = input.metadata;
  return (await db.update(tenants).set(update).where(and(eq(tenants.id, id), ne(tenants.status, "deleted"))).returning())[0] || null;
}
export async function deleteTenant(id: string) { return updateTenant(id, { status: "deleted" }); }
export async function listApiKeys() {
  const keys = await db.select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt }).from(apiKeys);
  const counts = await db.select({ id: tenants.apiKeyId, n: sql<number>`count(*)` }).from(tenants).where(ne(tenants.status, "deleted")).groupBy(tenants.apiKeyId);
  const byKey = new Map(counts.map((c: any) => [c.id, Number(c.n)]));
  return keys.map((k: any) => ({ ...k, tenantCount: byKey.get(k.id) ?? 0 }));
}
export async function createBot(input: { tenantId: string; name?: string; platform?: string; token: string; clientId?: string; guildIds?: string[]; profileId?: string | null; isEnabled?: boolean }) {
  if (!await getTenantById(input.tenantId)) throw new Error("Tenant not found");
  if (!input.token?.trim()) throw new Error("Bot token is required");
  if (input.platform && input.platform !== "discord") throw new Error("Unsupported bot platform");
  const { token, ...values } = input;
  return (await db.insert(bots).values({ ...values, tokenEncrypted: encryptSecret(token.trim()) }).returning())[0];
}
export async function updateBot(id: string, input: { name?: string; token?: string; clientId?: string | null; guildIds?: string[]; profileId?: string | null; isEnabled?: boolean; connectionStatus?: string; lastError?: string | null; lastConnectedAt?: Date }) {
  const { token, ...values } = input;
  const update: Record<string, any> = { ...values, updatedAt: new Date() };
  if (token !== undefined) {
    if (!token.trim()) throw new Error("Bot token is required");
    update.tokenEncrypted = encryptSecret(token.trim());
  }
  return (await db.update(bots).set(update).where(eq(bots.id, id)).returning())[0] || null;
}
export async function getBotDecrypted(id: string) {
  const [bot] = await db.select().from(bots).where(and(eq(bots.id, id), ne(bots.connectionStatus, "deleted"))).limit(1);
  return bot ? { bot, token: decryptSecret(bot.tokenEncrypted) } : null;
}
export async function listBotsForTenant(tenantId: string) { return db.select().from(bots).where(and(eq(bots.tenantId, tenantId), ne(bots.connectionStatus, "deleted"))); }
export async function listAllActiveBots() {
  const rows = await db.select({ bot: bots }).from(bots).innerJoin(tenants, eq(bots.tenantId, tenants.id)).where(and(eq(bots.isEnabled, true), eq(tenants.status, "active")));
  const resolved = await Promise.all(rows.map(async ({ bot }: any) => {
    try { return { bot, token: decryptSecret(bot.tokenEncrypted) }; }
    catch { await updateBot(bot.id, { connectionStatus: "error", lastError: "Unable to decrypt bot token; verify platform encryption configuration." }); return null; }
  }));
  return resolved.filter((row): row is NonNullable<typeof row> => row !== null);
}
export async function deleteBot(id: string) {
  // Keep historical usage/conversation linkage; disabled bots are retained as tombstones.
  await db.update(bots).set({ isEnabled: false, connectionStatus: "deleted", tokenEncrypted: "", updatedAt: new Date() }).where(eq(bots.id, id));
  // The tombstone keeps the row, so the foreign-key cascade never fires; its availability rules go here.
  await db.delete(availabilityRules).where(eq(availabilityRules.botId, id));
}

export type GuildConfigInput = { systemPrompt?: string | null; useThreads?: boolean; alwaysChannelIds?: string[]; timezone?: string | null; language?: "id" | "en" | null };
export async function getGuildConfig(botId: string, guildId: string) {
  return (await db.select().from(guildConfigs).where(and(eq(guildConfigs.botId, botId), eq(guildConfigs.guildId, guildId))).limit(1))[0] || null;
}
export async function upsertGuildConfig(tenantId: string, botId: string, guildId: string, input: GuildConfigInput) {
  const values = { ...input, updatedAt: new Date() };
  const existing = await getGuildConfig(botId, guildId);
  if (existing) return (await db.update(guildConfigs).set(values).where(eq(guildConfigs.id, existing.id)).returning())[0];
  return (await db.insert(guildConfigs).values({ tenantId, botId, guildId, ...values }).returning())[0];
}

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
