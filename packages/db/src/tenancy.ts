import { eq, and, ne } from "drizzle-orm";
import { db, repositories, tenants, bots, guildConfigs, availabilityRules, type DigestChannel } from "./index.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

export async function createBot(input: { tenantId: string; name?: string; platform?: string; token: string; clientId?: string; guildIds?: string[]; profileId?: string | null; isEnabled?: boolean }) {
  if (!await repositories().tenants.get(input.tenantId)) throw new Error("Tenant not found");
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

export type GuildConfigInput = { systemPrompt?: string | null; useThreads?: boolean; alwaysChannelIds?: string[]; timezone?: string | null; language?: "id" | "en" | null; digestChannels?: DigestChannel[] };
export async function getGuildConfig(botId: string, guildId: string) {
  return (await db.select().from(guildConfigs).where(and(eq(guildConfigs.botId, botId), eq(guildConfigs.guildId, guildId))).limit(1))[0] || null;
}
export async function upsertGuildConfig(tenantId: string, botId: string, guildId: string, input: GuildConfigInput) {
  const values = { ...input, updatedAt: new Date() };
  const existing = await getGuildConfig(botId, guildId);
  if (existing) return (await db.update(guildConfigs).set(values).where(eq(guildConfigs.id, existing.id)).returning())[0];
  return (await db.insert(guildConfigs).values({ tenantId, botId, guildId, ...values }).returning())[0];
}
