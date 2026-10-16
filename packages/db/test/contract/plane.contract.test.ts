import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

contract("Plane accounts and Plane scopes", (use) => {
  const tenant = (slug: string) => use().repos.tenants.create({ name: slug, slug });
  const account = (tenantId: string, name: string, extra: Record<string, any> = {}) =>
    use().repos.plane.createAccount({ tenantId, name, workspaceSlug: "acme", apiKeyEncrypted: "enc", planeUserId: "u-1", planeUserName: "Pachi Bot", ...extra });
  const newBot = async (tenantId: string, name = "Bot") => (await use().repos.bots.create({ tenantId, name, token: "x" })).id;

  test("a new Plane account can be read back, on Plane's cloud unless a base URL is given", async () => {
    const { plane } = use().repos;
    const t = await tenant("acme");
    const cloud = await account(t.id, "cloud");
    expect(cloud).toMatchObject({ tenantId: t.id, name: "cloud", baseUrl: null, workspaceSlug: "acme", apiKeyEncrypted: "enc", planeUserId: "u-1", planeUserName: "Pachi Bot" });
    expect(cloud.id).toMatch(UUID);
    expect(cloud.createdAt).toBeInstanceOf(Date);
    expect(await plane.getAccount(cloud.id)).toEqual(cloud);
    const own = await account(t.id, "own", { baseUrl: "https://plane.corp.example" });
    expect(own.baseUrl).toBe("https://plane.corp.example");
    expect(await plane.getAccount("missing")).toBeNull();
  });

  test("linking a Plane account switches the plane skill on for the tenant, and only for that tenant", async () => {
    const { plane, skills } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const main = await account(a.id, "main");
    const bot = await newBot(a.id);
    await plane.setBotAccounts(a.id, bot, []);
    expect((await skills.getForTenant(a.id, "plane"))?.isEnabled).toBe(false);
    await plane.setBotAccounts(a.id, bot, [main.id]);
    expect((await skills.getForTenant(a.id, "plane"))?.isEnabled).toBe(true);
    expect((await skills.getForTenant(b.id, "plane"))?.isEnabled).toBe(false);
  });

  test("linking another account to a bot that already has one leaves a switched-off plane skill off", async () => {
    const { plane, skills } = use().repos;
    const t = await tenant("acme");
    const [first, second] = [await account(t.id, "first"), await account(t.id, "second")];
    const bot = await newBot(t.id);
    await plane.setBotAccounts(t.id, bot, [first.id]);
    await skills.setEnabled(t.id, "plane", false);
    await plane.setBotAccounts(t.id, bot, [first.id, second.id]);
    expect((await skills.getForTenant(t.id, "plane"))?.isEnabled).toBe(false);
  });

  test("an account name is unique within its tenant only, and accounts are listed newest first", async () => {
    const { plane } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    await account(a.id, "old");
    await expect(account(a.id, "old")).rejects.toThrow();
    await Bun.sleep(2);
    await account(b.id, "old");
    await Bun.sleep(2);
    await account(a.id, "new");
    expect((await plane.listAccounts(a.id)).map((x) => x.name)).toEqual(["new", "old"]);
    expect(await plane.listAccounts("missing")).toEqual([]);
  });

  test("updating an account changes only what is given, and a taken name rejects", async () => {
    const { plane } = use().repos;
    const t = await tenant("acme");
    const taken = await account(t.id, "taken");
    const created = await account(t.id, "main", { baseUrl: "https://plane.corp.example" });
    const updated = await plane.updateAccount(created.id, { apiKeyEncrypted: "enc2", planeUserId: "u-2", planeUserName: "Other" });
    expect(updated).toMatchObject({ id: created.id, name: "main", baseUrl: "https://plane.corp.example", workspaceSlug: "acme", apiKeyEncrypted: "enc2", planeUserId: "u-2", planeUserName: "Other" });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    expect(await plane.getAccount(created.id)).toEqual(updated);
    expect(await plane.updateAccount(created.id, { baseUrl: null, workspaceSlug: "beta" })).toMatchObject({ baseUrl: null, workspaceSlug: "beta" });
    await expect(plane.updateAccount(created.id, { name: taken.name })).rejects.toThrow();
    expect(await plane.updateAccount("missing", { name: "x" })).toBeNull();
  });

  test("a bot holds many accounts, an account serves many bots, and setting the links replaces them", async () => {
    const { plane } = use().repos;
    const t = await tenant("acme");
    const [main, alt] = [await account(t.id, "main"), await account(t.id, "alt")];
    const [b1, b2, idle] = [await newBot(t.id), await newBot(t.id), await newBot(t.id)];
    await plane.setBotAccounts(t.id, b1, [main.id, alt.id, main.id]);
    await plane.setBotAccounts(t.id, b2, [main.id]);
    expect((await plane.listBotAccounts(b1)).map((a) => a.id).sort()).toEqual([main.id, alt.id].sort());
    expect(await plane.listBotAccounts(b2)).toEqual([main]);
    const links = await plane.botAccountIds([b1, b2, idle]);
    expect(links[b1]!.sort()).toEqual([main.id, alt.id].sort());
    expect(links[b2]).toEqual([main.id]);
    expect(links[idle] ?? []).toEqual([]);
    expect(await plane.botAccountIds([])).toEqual({});
    await plane.setBotAccounts(t.id, b1, [alt.id]);
    expect((await plane.listBotAccounts(b1)).map((a) => a.id)).toEqual([alt.id]);
  });

  test("a bot links only accounts of its own tenant, and a rejected set changes nothing", async () => {
    const { plane } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const [mine, theirs] = [await account(a.id, "mine"), await account(b.id, "theirs")];
    const bot = await newBot(a.id);
    await plane.setBotAccounts(a.id, bot, [mine.id]);
    await expect(plane.setBotAccounts(a.id, bot, [theirs.id])).rejects.toThrow("Plane account not found");
    await expect(plane.setBotAccounts(a.id, bot, [mine.id, "missing"])).rejects.toThrow("Plane account not found");
    await expect(plane.setBotAccounts(a.id, await newBot(b.id), [mine.id])).rejects.toThrow("Bot not found");
    expect((await plane.listBotAccounts(bot)).map((x) => x.id)).toEqual([mine.id]);
    expect(await plane.ownsAccounts(a.id, [mine.id, mine.id])).toBe(true);
    expect(await plane.ownsAccounts(a.id, [mine.id, theirs.id])).toBe(false);
    expect(await plane.ownsAccounts(a.id, [])).toBe(true);
  });

  test("the bots using each account leave out deleted bots", async () => {
    const { plane, bots } = use().repos;
    const t = await tenant("a");
    const [main, spare] = [await account(t.id, "main"), await account(t.id, "spare")];
    const [live, gone] = [await newBot(t.id, "live"), await newBot(t.id, "gone")];
    await plane.setBotAccounts(t.id, live, [main.id]);
    await plane.setBotAccounts(t.id, gone, [main.id]);
    await bots.remove(gone);
    const used = await plane.botsByAccount(t.id);
    expect(used[main.id]).toEqual([{ id: live, name: "live" }]);
    expect(used[spare.id] ?? []).toEqual([]);
  });

  const rulesOf = async (botId: string, channelId: string) =>
    (await use().repos.plane.listScopes(botId, "guild")).filter((s) => s.channelId === channelId).map((s) => [s.planeAccountId, s.projectIds]).sort();
  const linkedBot = async () => {
    const t = await tenant("acme");
    const [main, alt] = [await account(t.id, "main"), await account(t.id, "alt")];
    const bot = await newBot(t.id);
    await use().repos.plane.setBotAccounts(t.id, bot, [main.id, alt.id]);
    return { t, main, alt, bot };
  };

  test("guild rules store Plane project ids lowercased, or all projects, and replacing them replaces only that scope", async () => {
    const { plane } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: [P1.toUpperCase(), ` ${P1} `, P2] }, { planeAccountId: alt.id, projectIds: [P3, "*"] }]);
    const [scope] = (await plane.listScopes(bot, "guild")).filter((s) => s.planeAccountId === main.id);
    expect(scope).toMatchObject({ tenantId: t.id, botId: bot, guildId: "guild", channelId: "", planeAccountId: main.id, projectIds: [P1, P2] });
    expect(scope!.id).toMatch(UUID);
    expect(await rulesOf(bot, "")).toEqual([[alt.id, ["*"]], [main.id, [P1, P2]]].sort() as any);
    expect(await plane.listScopes(bot, "other-guild")).toEqual([]);
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: alt.id, projectIds: [P3] }]);
    expect(await rulesOf(bot, "")).toEqual([[alt.id, [P3]]]);
  });

  test("a rule is refused for an unattached account, a repeated account, no projects, or a malformed id", async () => {
    const { plane } = use().repos;
    const { t, main, bot } = await linkedBot();
    const stranger = await account(t.id, "stranger");
    const replace = (rules: { planeAccountId: string; projectIds: string[] }[]) => plane.replaceScopes(t.id, bot, "guild", "", rules);
    await expect(replace([{ planeAccountId: stranger.id, projectIds: ["*"] }])).rejects.toThrow("Plane account is not attached to this bot");
    await expect(replace([{ planeAccountId: main.id, projectIds: ["*"] }, { planeAccountId: main.id, projectIds: [P1] }])).rejects.toThrow("Duplicate Plane account in rules");
    await expect(replace([{ planeAccountId: main.id, projectIds: [" "] }])).rejects.toThrow("projectIds must not be empty");
    await expect(replace([{ planeAccountId: main.id, projectIds: ["ENG"] }])).rejects.toThrow("Invalid Plane project id");
    expect(await plane.listScopes(bot, "guild")).toEqual([]);
  });

  test("a channel rule needs a guild rule and cannot reach an account or Plane project the guild rule does not allow", async () => {
    const { plane } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await expect(plane.replaceScopes(t.id, bot, "guild", "chan", [{ planeAccountId: main.id, projectIds: ["*"] }])).rejects.toThrow("Channel rule needs the Plane account enabled in the guild first");
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: [P1, P2] }, { planeAccountId: alt.id, projectIds: ["*"] }]);
    await plane.replaceScopes(t.id, bot, "guild", "chan", [{ planeAccountId: main.id, projectIds: [P1] }, { planeAccountId: alt.id, projectIds: [P3] }]);
    await expect(plane.replaceScopes(t.id, bot, "guild", "chan2", [{ planeAccountId: main.id, projectIds: [P3] }])).rejects.toThrow("Channel rule reaches a Plane project the guild rule does not allow");
    await expect(plane.replaceScopes(t.id, bot, "guild", "chan2", [{ planeAccountId: main.id, projectIds: ["*"] }])).rejects.toThrow("Channel rule reaches a Plane project the guild rule does not allow");
    expect(await rulesOf(bot, "chan")).toEqual([[alt.id, [P3]], [main.id, [P1]]].sort() as any);
    expect(await rulesOf(bot, "chan2")).toEqual([]);
  });

  test("narrowing a guild rule prunes the channel rules beneath it", async () => {
    const { plane } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: ["*"] }, { planeAccountId: alt.id, projectIds: ["*"] }]);
    await plane.replaceScopes(t.id, bot, "guild", "chan", [{ planeAccountId: main.id, projectIds: [P1, P2] }, { planeAccountId: alt.id, projectIds: [P3] }]);
    await plane.replaceScopes(t.id, bot, "guild", "chan2", [{ planeAccountId: main.id, projectIds: ["*"] }]);
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: [P1, P3] }]);
    expect(await rulesOf(bot, "chan")).toEqual([[main.id, [P1]]]);
    expect(await rulesOf(bot, "chan2")).toEqual([]);
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: [P3] }]);
    expect(await rulesOf(bot, "chan")).toEqual([]);
  });

  test("detaching an account from a bot removes its Plane scopes on that bot", async () => {
    const { plane } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: ["*"] }, { planeAccountId: alt.id, projectIds: ["*"] }]);
    await plane.replaceScopes(t.id, bot, "guild", "chan", [{ planeAccountId: main.id, projectIds: [P1] }]);
    await plane.setBotAccounts(t.id, bot, [alt.id]);
    expect((await plane.listScopes(bot, "guild")).map((s) => s.planeAccountId)).toEqual([alt.id]);
  });

  test("deleting an account removes it once, with its links and scopes, and leaves the bot's other accounts", async () => {
    const { plane, bots } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: ["*"] }, { planeAccountId: alt.id, projectIds: ["*"] }]);
    await plane.replaceScopes(t.id, bot, "guild", "chan", [{ planeAccountId: main.id, projectIds: [P1] }]);
    const gone = await newBot(t.id, "gone");
    await plane.setBotAccounts(t.id, gone, [main.id]);
    await bots.remove(gone);
    expect(await plane.deleteAccount(main.id)).toBe(true);
    expect(await plane.getAccount(main.id)).toBeNull();
    expect(await plane.deleteAccount(main.id)).toBe(false);
    expect(await plane.listBotAccounts(bot)).toEqual([alt]);
    expect(await plane.botAccountIds([bot, gone])).toEqual({ [bot]: [alt.id] });
    expect((await plane.listScopes(bot, "guild")).map((s) => s.planeAccountId)).toEqual([alt.id]);
  });

  test("purging a tenant removes its Plane accounts, links and scopes, and leaves other tenants alone", async () => {
    const { plane, tenants } = use().repos;
    const { t, main, bot } = await linkedBot();
    await plane.replaceScopes(t.id, bot, "guild", "", [{ planeAccountId: main.id, projectIds: ["*"] }]);
    const kept = await tenant("kept");
    const keptAccount = await account(kept.id, "main");
    expect(await tenants.purge(t.id)).toBe(true);
    expect(await use().ownedRecords(t.id)).toBe(0);
    expect(await plane.getAccount(main.id)).toBeNull();
    expect(await plane.botAccountIds([bot])).toEqual({});
    expect(await plane.listScopes(bot, "guild")).toEqual([]);
    expect(await plane.getAccount(keptAccount.id)).toEqual(keptAccount);
  });
});
