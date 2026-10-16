import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

contract("Bots and guild configuration", (use) => {
  const tenant = (slug: string) => use().repos.tenants.create({ name: slug, slug });

  test("a new bot can be read back with its defaults, and its token only through getWithToken", async () => {
    const { bots } = use().repos;
    const acme = await tenant("acme");
    const bot = await bots.create({ tenantId: acme.id, token: "  secret-token  ", guildIds: ["g1"] });
    expect(bot).toMatchObject({ tenantId: acme.id, name: "Discord Bot", platform: "discord", clientId: null, guildIds: ["g1"], isEnabled: true, connectionStatus: "disconnected", profileId: null, hasToken: true, lastConnectedAt: null, lastError: null });
    expect(bot.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(bot.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(bot)).not.toContain("secret-token");
    expect(await bots.get(bot.id)).toEqual(bot);
    expect(await bots.getWithToken(bot.id)).toEqual({ bot, token: "secret-token" });
    expect(await bots.get("missing")).toBeNull();
    expect(await bots.getWithToken("missing")).toBeNull();
  });

  test("a bot without a tenant, a token or on another platform is rejected", async () => {
    const { bots, tenants } = use().repos;
    const acme = await tenant("acme");
    await expect(bots.create({ tenantId: "missing", token: "t" })).rejects.toThrow("Tenant not found");
    await expect(bots.create({ tenantId: acme.id, token: "  " })).rejects.toThrow("Bot token is required");
    await expect(bots.create({ tenantId: acme.id, token: "t", platform: "slack" })).rejects.toThrow("Unsupported bot platform");
    await tenants.remove(acme.id);
    await expect(bots.create({ tenantId: acme.id, token: "t" })).rejects.toThrow("Tenant not found");
  });

  test("a bot naming a profile that does not exist is rejected", async () => {
    const { bots } = use().repos;
    const acme = await tenant("acme");
    await expect(bots.create({ tenantId: acme.id, token: "t", profileId: "missing" })).rejects.toThrow();
    const bot = await bots.create({ tenantId: acme.id, token: "t" });
    await expect(bots.update(bot.id, { profileId: "missing" })).rejects.toThrow();
    expect(await bots.listForTenant(acme.id)).toEqual([bot]);
  });

  test("a bot cannot use a profile of another tenant", async () => {
    const { bots, profiles } = use().repos;
    const [acme, other] = [await tenant("acme"), await tenant("other")];
    const mine = await profiles.create(acme.id, { name: "Mine", provider: "openai", model: "a" });
    const theirs = await profiles.create(other.id, { name: "Theirs", provider: "openai", model: "b" });
    await expect(bots.create({ tenantId: acme.id, token: "t", profileId: theirs.id })).rejects.toThrow("Profile not found");
    expect(await bots.listForTenant(acme.id)).toEqual([]);
    const bot = await bots.create({ tenantId: acme.id, token: "t", profileId: mine.id });
    await expect(bots.update(bot.id, { profileId: theirs.id, name: "Renamed" })).rejects.toThrow("Profile not found");
    expect(await bots.get(bot.id)).toEqual(bot);
    expect((await bots.update(bot.id, { profileId: null }))?.profileId).toBeNull();
  });

  test("a bot is read only within its own tenant when one is named", async () => {
    const { bots } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const bot = await bots.create({ tenantId: a.id, token: "t" });
    expect((await bots.get(bot.id, a.id))?.id).toBe(bot.id);
    expect(await bots.get(bot.id, b.id)).toBeNull();
  });

  test("updating changes the given fields and the token, and leaves the rest", async () => {
    const { bots } = use().repos;
    const acme = await tenant("acme");
    const bot = await bots.create({ tenantId: acme.id, name: "Helper", token: "first", clientId: "c1", guildIds: ["g1"] });
    const seen = new Date("2026-01-02T03:04:05.000Z");
    const updated = await bots.update(bot.id, { name: "Renamed", token: "second", guildIds: ["g1", "g2"], connectionStatus: "connected", lastConnectedAt: seen, lastError: "boom" });
    expect(updated).toMatchObject({ id: bot.id, name: "Renamed", clientId: "c1", guildIds: ["g1", "g2"], connectionStatus: "connected", lastError: "boom", isEnabled: true });
    expect(updated!.lastConnectedAt?.getTime()).toBe(seen.getTime());
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(bot.updatedAt.getTime());
    expect((await bots.getWithToken(bot.id))?.token).toBe("second");
    expect((await bots.update(bot.id, { clientId: null, lastError: null }))).toMatchObject({ clientId: null, lastError: null });
    await expect(bots.update(bot.id, { token: " " })).rejects.toThrow("Bot token is required");
    expect(await bots.update("missing", { name: "x" })).toBeNull();
  });

  test("a removed bot becomes a tombstone that every read leaves out", async () => {
    const { bots } = use().repos;
    const acme = await tenant("acme");
    const gone = await bots.create({ tenantId: acme.id, token: "t" });
    const kept = await bots.create({ tenantId: acme.id, token: "u" });
    const records = await use().ownedRecords(acme.id);
    await bots.remove(gone.id);
    expect(await bots.get(gone.id)).toBeNull();
    expect(await bots.getWithToken(gone.id)).toBeNull();
    expect(await bots.update(gone.id, { connectionStatus: "disconnected" })).toBeNull();
    expect((await bots.listForTenant(acme.id)).map((b) => b.id)).toEqual([kept.id]);
    expect((await bots.listRunnable()).map((r) => r.bot.id)).toEqual([kept.id]);
    expect(await bots.count()).toBe(1);
    expect((await bots.search(acme.id, { page: 1, pageSize: 10 })).total).toBe(1);
    // The tombstone keeps its row.
    expect(await use().ownedRecords(acme.id)).toBe(records);
  });

  test("a tenant's bots are listed oldest first, and the count spans every tenant", async () => {
    const { bots } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const first = await bots.create({ tenantId: a.id, name: "First", token: "t" });
    await Bun.sleep(2);
    const second = await bots.create({ tenantId: a.id, name: "Second", token: "t" });
    await bots.create({ tenantId: b.id, token: "t" });
    expect((await bots.listForTenant(a.id)).map((x) => x.id)).toEqual([first.id, second.id]);
    expect(await bots.count()).toBe(3);
  });

  test("searching pages a tenant's bots newest first, by platform and by name ignoring case", async () => {
    const { bots } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    for (const name of ["Alpha Helper", "beta", "HELPER two", "100% sure", "under_score"]) { await bots.create({ tenantId: a.id, name, token: "t" }); await Bun.sleep(2); }
    await bots.create({ tenantId: b.id, name: "helper elsewhere", token: "t" });
    const names = async (filter: Parameters<typeof bots.search>[1]) => { const r = await bots.search(a.id, filter); return [r.total, r.bots.map((x) => x.name)]; };
    expect(await names({ page: 1, pageSize: 10 })).toEqual([5, ["under_score", "100% sure", "HELPER two", "beta", "Alpha Helper"]]);
    expect(await names({ page: 2, pageSize: 2 })).toEqual([5, ["HELPER two", "beta"]]);
    expect(await names({ q: "helper", page: 1, pageSize: 10 })).toEqual([2, ["HELPER two", "Alpha Helper"]]);
    expect(await names({ q: "%", page: 1, pageSize: 10 })).toEqual([1, ["100% sure"]]);
    expect(await names({ q: "_", page: 1, pageSize: 10 })).toEqual([1, ["under_score"]]);
    expect(await names({ platform: "discord", page: 1, pageSize: 1 })).toEqual([5, ["under_score"]]);
    expect(await names({ platform: "slack", page: 1, pageSize: 10 })).toEqual([0, []]);
  });

  test("runnable bots are the enabled ones of active tenants, with their tokens", async () => {
    const { bots, tenants } = use().repos;
    const [live, paused] = [await tenant("live"), await tenant("paused")];
    const on = await bots.create({ tenantId: live.id, token: "on-token" });
    await bots.create({ tenantId: live.id, token: "off-token", isEnabled: false });
    await bots.create({ tenantId: paused.id, token: "paused-token" });
    await tenants.update(paused.id, { status: "suspended" });
    expect(await bots.listRunnable()).toEqual([{ bot: on, token: "on-token" }]);
  });

  test("a guild configuration is created on first save and changed field by field after", async () => {
    const { bots } = use().repos;
    const acme = await tenant("acme");
    const bot = await bots.create({ tenantId: acme.id, token: "t" });
    expect(await bots.getGuildConfig(bot.id, "g1")).toBeNull();
    const created = await bots.saveGuildConfig(acme.id, bot.id, "g1", { systemPrompt: "Be brief", digestChannels: [{ channelId: "c1", hour: 9 }] });
    expect(created).toMatchObject({ tenantId: acme.id, botId: bot.id, guildId: "g1", systemPrompt: "Be brief", useThreads: true, alwaysChannelIds: [], timezone: null, language: null, digestChannels: [{ channelId: "c1", hour: 9 }] });
    expect(created.updatedAt).toBeInstanceOf(Date);
    expect(await bots.getGuildConfig(bot.id, "g1")).toEqual(created);

    const changed = await bots.saveGuildConfig(acme.id, bot.id, "g1", { useThreads: false, alwaysChannelIds: ["c2"], timezone: "Asia/Tokyo", language: "en", systemPrompt: null });
    expect(changed).toMatchObject({ id: created.id, systemPrompt: null, useThreads: false, alwaysChannelIds: ["c2"], timezone: "Asia/Tokyo", language: "en", digestChannels: [{ channelId: "c1", hour: 9 }] });
    expect(await bots.getGuildConfig(bot.id, "g1")).toEqual(changed);
    expect(await bots.getGuildConfig(bot.id, "g2")).toBeNull();
  });

  test("a tenant's guild configurations are listed apart from other tenants'", async () => {
    const { bots } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const [botA, botB] = [await bots.create({ tenantId: a.id, token: "t" }), await bots.create({ tenantId: b.id, token: "t" })];
    await bots.saveGuildConfig(a.id, botA.id, "g1", { timezone: "UTC" });
    await bots.saveGuildConfig(a.id, botA.id, "g2", {});
    await bots.saveGuildConfig(b.id, botB.id, "g1", {});
    expect((await bots.listGuildConfigs(a.id)).map((g) => [g.guildId, g.timezone]).sort()).toEqual([["g1", "UTC"], ["g2", null]]);
    expect((await bots.listGuildConfigs(b.id)).map((g) => g.botId)).toEqual([botB.id]);
  });

  test("purging a tenant deletes its bots and guild configurations", async () => {
    const { bots, tenants } = use().repos;
    const acme = await tenant("acme");
    const bot = await bots.create({ tenantId: acme.id, token: "t" });
    await bots.saveGuildConfig(acme.id, bot.id, "g1", {});
    await tenants.purge(acme.id);
    expect(await bots.get(bot.id)).toBeNull();
    expect(await bots.getGuildConfig(bot.id, "g1")).toBeNull();
    expect(await bots.count()).toBe(0);
  });
});
