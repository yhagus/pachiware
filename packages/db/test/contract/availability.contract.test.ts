import { afterAll, beforeAll, expect, test } from "bun:test";
import { contract } from "./engines.ts";
import type { RuleScope } from "../../src/repositories/index.ts";

// Rules hang off bots, whose tokens are encrypted at rest, so this suite needs a platform key; the one a developer set is kept.
const savedKey = process.env.PLATFORM_ENCRYPTION_KEY;
beforeAll(() => { process.env.PLATFORM_ENCRYPTION_KEY ||= Buffer.alloc(32, 4).toString("base64"); });
afterAll(() => { if (savedKey === undefined) delete process.env.PLATFORM_ENCRYPTION_KEY; else process.env.PLATFORM_ENCRYPTION_KEY = savedKey; });

const tenantScope = (tenantId: string): RuleScope => ({ tenantId, level: "tenant", botId: null, guildId: "", channelId: "" });
const botScope = (tenantId: string, botId: string): RuleScope => ({ tenantId, level: "bot", botId, guildId: "", channelId: "" });
const guildScope = (tenantId: string, botId: string, guildId: string): RuleScope => ({ tenantId, level: "guild", botId, guildId, channelId: "" });
const channelScope = (tenantId: string, botId: string, guildId: string, channelId: string): RuleScope => ({ tenantId, level: "channel", botId, guildId, channelId });

contract("Availability rules", (use) => {
  const addBot = async (tenantId: string) => (await use().repos.bots.create({ tenantId, token: "x" })).id;

  test("a rule is kept at its scope only, and writing it again replaces its value", async () => {
    const { tenants, availability } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const bot = await addBot(tenant.id);
    await availability.set(tenantScope(tenant.id), { kind: "tool", name: "createTask" }, "off");
    await availability.set(guildScope(tenant.id, bot, "g1"), { kind: "skill", name: "workspace" }, "opt_in");
    await availability.set(guildScope(tenant.id, bot, "g1"), { kind: "effect", name: "write" }, "off");
    await availability.set(guildScope(tenant.id, bot, "g1"), { kind: "effect", name: "write" }, "opt_in");

    const atGuild = await availability.list(guildScope(tenant.id, bot, "g1"));
    expect(atGuild.map((r) => [r.kind, r.name, r.value])).toEqual([["effect", "write", "opt_in"], ["skill", "workspace", "opt_in"]]);
    expect(atGuild[0]).toMatchObject({ tenantId: tenant.id, level: "guild", botId: bot, guildId: "g1", channelId: "" });
    expect(atGuild[0]!.updatedAt).toBeInstanceOf(Date);
    expect(await availability.list(tenantScope(tenant.id))).toMatchObject([{ kind: "tool", name: "createTask", value: "off", botId: null }]);
    expect(await availability.list(botScope(tenant.id, bot))).toEqual([]);
    expect(await availability.list(guildScope(tenant.id, bot, "g2"))).toEqual([]);
  });

  test("the rules for a bot are the tenant's and that bot's own, at every level", async () => {
    const { tenants, availability } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const other = await tenants.create({ name: "Other", slug: "other" });
    const [bot, sibling] = [await addBot(tenant.id), await addBot(tenant.id)];
    await availability.set(tenantScope(tenant.id), { kind: "effect", name: "delete" }, "off");
    await availability.set(botScope(tenant.id, bot), { kind: "skill", name: "workspace" }, "opt_in");
    await availability.set(channelScope(tenant.id, bot, "g1", "c1"), { kind: "skill", name: "workspace" }, "on");
    await availability.set(botScope(tenant.id, sibling), { kind: "skill", name: "reminders" }, "off");
    await availability.set(tenantScope(other.id), { kind: "effect", name: "write" }, "off");

    const names = async (botId?: string) => (await availability.listForBot(tenant.id, botId)).map((r) => `${r.level}:${r.name}:${r.value}`).sort();
    expect(await names(bot)).toEqual(["bot:workspace:opt_in", "channel:workspace:on", "tenant:delete:off"]);
    expect(await names(sibling)).toEqual(["bot:reminders:off", "tenant:delete:off"]);
    expect(await names()).toEqual(["tenant:delete:off"]);
  });

  test("clearing removes one target at one scope, and says whether there was a rule", async () => {
    const { tenants, availability } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const bot = await addBot(tenant.id);
    await availability.set(botScope(tenant.id, bot), { kind: "tool", name: "createTask" }, "off");
    await availability.set(botScope(tenant.id, bot), { kind: "tool", name: "listTasks" }, "off");
    await availability.set(guildScope(tenant.id, bot, "g1"), { kind: "tool", name: "createTask" }, "off");

    expect(await availability.clear(botScope(tenant.id, bot), { kind: "tool", name: "createTask" })).toBe(true);
    expect(await availability.clear(botScope(tenant.id, bot), { kind: "tool", name: "createTask" })).toBe(false);
    expect((await availability.list(botScope(tenant.id, bot))).map((r) => r.name)).toEqual(["listTasks"]);
    expect((await availability.list(guildScope(tenant.id, bot, "g1"))).map((r) => r.name)).toEqual(["createTask"]);
  });

  test("removing a bot's rules leaves the tenant's and other bots' rules", async () => {
    const { tenants, availability } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const [bot, sibling] = [await addBot(tenant.id), await addBot(tenant.id)];
    await availability.set(tenantScope(tenant.id), { kind: "effect", name: "delete" }, "off");
    await availability.set(botScope(tenant.id, bot), { kind: "skill", name: "workspace" }, "off");
    await availability.set(channelScope(tenant.id, bot, "g1", "c1"), { kind: "tool", name: "createTask" }, "off");
    await availability.set(botScope(tenant.id, sibling), { kind: "skill", name: "workspace" }, "off");

    await availability.removeForBot(bot);
    expect((await availability.listForBot(tenant.id, bot)).map((r) => r.level)).toEqual(["tenant"]);
    expect(await availability.list(botScope(tenant.id, sibling))).toHaveLength(1);
  });

  test("purging a tenant removes its rules", async () => {
    const { tenants, availability } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const bot = await addBot(tenant.id);
    await availability.set(tenantScope(tenant.id), { kind: "effect", name: "delete" }, "off");
    await availability.set(botScope(tenant.id, bot), { kind: "skill", name: "workspace" }, "off");
    await tenants.purge(tenant.id);
    expect(await availability.listForBot(tenant.id, bot)).toEqual([]);
  });
});
