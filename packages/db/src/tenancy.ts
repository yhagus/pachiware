import { randomUUID } from "node:crypto";
import { eq, and, isNull, ne } from "drizzle-orm";
import { db, tenants, apiKeys, bots, agentsConfig, skills, tenantSkills, activeDialect } from "./index.js";
import { seedTenant } from "./seed.js";
import { encryptSecret, decryptSecret, hashApiKey, generateApiKey } from "./crypto.js";

export async function getTenantById(id: string) {
  return (await db.select().from(tenants).where(and(eq(tenants.id, id), ne(tenants.status, "deleted"))).limit(1))[0] || null;
}
export async function getTenantBySlug(slug: string) {
  return (await db.select().from(tenants).where(and(eq(tenants.slug, slug), ne(tenants.status, "deleted"))).limit(1))[0] || null;
}
export async function getTenantByApiKey(raw: string, includeSuspended = false) {
  if (!raw || raw.length > 256) return null;
  const [result] = await db.select({ tenant: tenants, apiKey: apiKeys }).from(apiKeys)
    .innerJoin(tenants, eq(apiKeys.tenantId, tenants.id))
    .where(and(eq(apiKeys.keyHash, hashApiKey(raw)), isNull(apiKeys.revokedAt), ne(tenants.status, "deleted"))).limit(1);
  if (!result || (!includeSuspended && result.tenant.status !== "active")) return null;
  return result;
}
export async function issueApiKey(tenantId: string, name = "API Key", scopes: string[] = []) {
  if (!await getTenantById(tenantId)) throw new Error("Tenant not found");
  const key = generateApiKey();
  const [row] = await db.insert(apiKeys).values({ tenantId, name, scopes, keyPrefix: key.keyPrefix, keyHash: hashApiKey(key.raw) }).returning();
  return { ...key, keyId: row.id };
}
export async function revokeApiKey(keyId: string) {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, keyId));
}
export async function touchApiKeyLastUsed(keyId: string) {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyId));
}
export async function createTenant(input: { name: string; slug?: string; metadata?: Record<string, any> }) {
  const values = { id: randomUUID(), name: input.name, slug: input.slug || randomUUID(), platformMetadata: input.metadata || {} };
  if (activeDialect === "sqlite") {
    // Bun SQLite transactions must stay synchronous to retain rollback semantics.
    return db.transaction((tx: any) => {
      const row = tx.insert(tenants).values(values).returning().get();
      tx.insert(agentsConfig).values({ tenantId: row.id, settings: { maxReActIterations: 8 } }).run();
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
export async function listApiKeysForTenant(tenantId: string) {
  return db.select({ id: apiKeys.id, tenantId: apiKeys.tenantId, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, scopes: apiKeys.scopes, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt }).from(apiKeys).where(eq(apiKeys.tenantId, tenantId));
}
export async function createBot(input: { tenantId: string; name?: string; platform?: string; token: string; clientId?: string; guildIds?: string[]; isEnabled?: boolean }) {
  if (!await getTenantById(input.tenantId)) throw new Error("Tenant not found");
  if (!input.token?.trim()) throw new Error("Bot token is required");
  if (input.platform && input.platform !== "discord") throw new Error("Unsupported bot platform");
  const { token, ...values } = input;
  return (await db.insert(bots).values({ ...values, tokenEncrypted: encryptSecret(token.trim()) }).returning())[0];
}
export async function updateBot(id: string, input: { name?: string; token?: string; clientId?: string | null; guildIds?: string[]; isEnabled?: boolean; connectionStatus?: string; lastError?: string | null; lastConnectedAt?: Date }) {
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
}
