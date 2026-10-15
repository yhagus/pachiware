import { afterAll, beforeAll, expect, test } from "bun:test";
import { contract } from "./engines.ts";

// The suite links accounts to bots, whose tokens are encrypted at rest; the key a developer set is kept.
const savedKey = process.env.PLATFORM_ENCRYPTION_KEY;
beforeAll(() => { process.env.PLATFORM_ENCRYPTION_KEY ||= Buffer.alloc(32, 4).toString("base64"); });
afterAll(() => { if (savedKey === undefined) delete process.env.PLATFORM_ENCRYPTION_KEY; else process.env.PLATFORM_ENCRYPTION_KEY = savedKey; });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

contract("Git accounts, scopes and OAuth apps", (use) => {
  const tenant = (slug: string) => use().repos.tenants.create({ name: slug, slug });
  const account = (tenantId: string, name: string, extra: Record<string, any> = {}) =>
    use().repos.git.createAccount({ tenantId, name, provider: "github", username: "octo", tokenEncrypted: "enc", ...extra });
  const newBot = async (tenantId: string, name = "Bot") => (await use().repos.bots.create({ tenantId, name, token: "x" })).id;

  test("a new git account can be read back, with its token kept as given", async () => {
    const { git } = use().repos;
    const t = await tenant("acme");
    const created = await account(t.id, "main", { provider: "gitlab", baseUrl: "https://gitlab.corp.example" });
    expect(created).toMatchObject({ tenantId: t.id, name: "main", provider: "gitlab", baseUrl: "https://gitlab.corp.example", username: "octo", authType: "token", tokenEncrypted: "enc", refreshTokenEncrypted: null, tokenExpiresAt: null });
    expect(created.id).toMatch(UUID);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await git.getAccount(created.id)).toEqual(created);
    expect(await git.getAccount("missing")).toBeNull();
  });

  test("an account name is unique within its tenant only", async () => {
    const { git } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    await account(a.id, "main");
    await expect(account(a.id, "main")).rejects.toThrow();
    expect((await account(b.id, "main")).tenantId).toBe(b.id);
    expect((await git.listAccounts(a.id)).map((x) => x.name)).toEqual(["main"]);
  });

  test("a tenant's accounts are listed newest first, without other tenants' accounts", async () => {
    const { git } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    await account(a.id, "old");
    await Bun.sleep(2);
    await account(b.id, "foreign");
    await Bun.sleep(2);
    await account(a.id, "new");
    expect((await git.listAccounts(a.id)).map((x) => x.name)).toEqual(["new", "old"]);
    expect(await git.listAccounts("missing")).toEqual([]);
  });

  test("updating an account changes only what is given, and a taken name rejects", async () => {
    const { git } = use().repos;
    const t = await tenant("acme");
    const taken = await account(t.id, "taken");
    const created = await account(t.id, "main", { authType: "oauth", refreshTokenEncrypted: "r", tokenExpiresAt: new Date(1_900_000_000_000) });
    const expiry = new Date(2_000_000_000_000);
    const updated = await git.updateAccount(created.id, { tokenEncrypted: "enc2", tokenExpiresAt: expiry });
    expect(updated).toMatchObject({ id: created.id, name: "main", authType: "oauth", refreshTokenEncrypted: "r", tokenEncrypted: "enc2", tokenExpiresAt: expiry });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    expect(await git.getAccount(created.id)).toEqual(updated);

    const reset = await git.updateAccount(created.id, { name: "renamed", baseUrl: "https://gitlab.corp.example", authType: "token", refreshTokenEncrypted: null, tokenExpiresAt: null });
    expect(reset).toMatchObject({ name: "renamed", baseUrl: "https://gitlab.corp.example", authType: "token", refreshTokenEncrypted: null, tokenExpiresAt: null });
    await expect(git.updateAccount(created.id, { name: taken.name })).rejects.toThrow();
    expect(await git.updateAccount("missing", { name: "x" })).toBeNull();
  });

  test("deleting an account removes it once", async () => {
    const { git } = use().repos;
    const t = await tenant("acme");
    const created = await account(t.id, "main");
    expect(await git.deleteAccount(created.id)).toBe(true);
    expect(await git.getAccount(created.id)).toBeNull();
    expect(await git.deleteAccount(created.id)).toBe(false);
  });

  test("a bot holds many accounts, an account serves many bots, and setting the links replaces them", async () => {
    const { git } = use().repos;
    const t = await tenant("acme");
    const [main, alt] = [await account(t.id, "main"), await account(t.id, "alt")];
    const [b1, b2, idle] = [await newBot(t.id), await newBot(t.id), await newBot(t.id)];
    await git.setBotAccounts(t.id, b1, [main.id, alt.id, main.id]);
    await git.setBotAccounts(t.id, b2, [main.id]);
    expect((await git.listBotAccounts(b1)).map((a) => a.id).sort()).toEqual([main.id, alt.id].sort());
    expect(await git.listBotAccounts(b2)).toEqual([main]);

    const links = await git.botAccountIds([b1, b2, idle]);
    expect(links[b1]!.sort()).toEqual([main.id, alt.id].sort());
    expect(links[b2]).toEqual([main.id]);
    expect(links[idle] ?? []).toEqual([]);
    expect(await git.botAccountIds([])).toEqual({});

    await git.setBotAccounts(t.id, b1, [alt.id]);
    expect((await git.listBotAccounts(b1)).map((a) => a.id)).toEqual([alt.id]);
    await git.setBotAccounts(t.id, b1, []);
    expect(await git.listBotAccounts(b1)).toEqual([]);
  });

  test("linking an account switches the git skill on for the tenant, and only for that tenant", async () => {
    const { git, skills } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const main = await account(a.id, "main");
    const bot = await newBot(a.id);
    await git.setBotAccounts(a.id, bot, []);
    expect((await skills.getForTenant(a.id, "git_repositories"))?.isEnabled).toBe(false);
    await git.setBotAccounts(a.id, bot, [main.id]);
    expect((await skills.getForTenant(a.id, "git_repositories"))?.isEnabled).toBe(true);
    expect((await skills.getForTenant(b.id, "git_repositories"))?.isEnabled).toBe(false);
  });

  test("a bot cannot link an account of another tenant, and a rejected set changes nothing", async () => {
    const { git } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const [mine, theirs] = [await account(a.id, "mine"), await account(b.id, "theirs")];
    const bot = await newBot(a.id);
    await git.setBotAccounts(a.id, bot, [mine.id]);
    await expect(git.setBotAccounts(a.id, bot, [theirs.id])).rejects.toThrow("Git account not found");
    await expect(git.setBotAccounts(a.id, bot, [mine.id, "missing"])).rejects.toThrow("Git account not found");
    expect((await git.listBotAccounts(bot)).map((x) => x.id)).toEqual([mine.id]);

    expect(await git.ownsAccounts(a.id, [mine.id, mine.id])).toBe(true);
    expect(await git.ownsAccounts(a.id, [mine.id, theirs.id])).toBe(false);
    expect(await git.ownsAccounts(a.id, [])).toBe(true);
  });

  test("the bots using each account leave out deleted bots and other tenants", async () => {
    const { git } = use().repos;
    const [a, b] = [await tenant("a"), await tenant("b")];
    const [main, spare, foreign] = [await account(a.id, "main"), await account(a.id, "spare"), await account(b.id, "foreign")];
    const live = await newBot(a.id, "live");
    const gone = await newBot(a.id, "gone");
    const other = await newBot(b.id, "other");
    await git.setBotAccounts(a.id, live, [main.id]);
    await git.setBotAccounts(a.id, gone, [main.id]);
    await git.setBotAccounts(b.id, other, [foreign.id]);
    await use().repos.bots.remove(gone);
    const used = await git.botsByAccount(a.id);
    expect(used[main.id]).toEqual([{ id: live, name: "live" }]);
    expect(used[spare.id] ?? []).toEqual([]);
    expect(used[foreign.id]).toBeUndefined();
  });

  const rulesOf = async (botId: string, channelId: string) =>
    (await use().repos.git.listScopes(botId, "guild")).filter((s) => s.channelId === channelId).map((s) => [s.gitAccountId, s.repoPatterns]).sort();
  const linkedBot = async () => {
    const t = await tenant("acme");
    const [main, alt] = [await account(t.id, "main"), await account(t.id, "alt")];
    const bot = await newBot(t.id);
    await use().repos.git.setBotAccounts(t.id, bot, [main.id, alt.id]);
    return { t, main, alt, bot };
  };

  test("server rules are stored lowercased and deduplicated, and replacing them replaces only that scope", async () => {
    const { git } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["Org/*", " org/* ", ""] }, { gitAccountId: alt.id, repoPatterns: ["*"] }]);
    const [scope] = (await git.listScopes(bot, "guild")).filter((s) => s.gitAccountId === main.id);
    expect(scope).toMatchObject({ tenantId: t.id, botId: bot, guildId: "guild", channelId: "", gitAccountId: main.id, repoPatterns: ["org/*"] });
    expect(scope!.id).toMatch(UUID);
    expect(scope!.updatedAt).toBeInstanceOf(Date);
    expect(await git.listScopes(bot, "other-guild")).toEqual([]);

    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: alt.id, repoPatterns: ["acme/api"] }]);
    expect(await rulesOf(bot, "")).toEqual([[alt.id, ["acme/api"]]]);
  });

  test("a rule is rejected for an unlinked account, a repeated account, no patterns, or a bad pattern", async () => {
    const { git } = use().repos;
    const { t, main, bot } = await linkedBot();
    const stranger = await account(t.id, "stranger");
    const replace = (rules: { gitAccountId: string; repoPatterns: string[] }[]) => git.replaceScopes(t.id, bot, "guild", "", rules);
    await expect(replace([{ gitAccountId: stranger.id, repoPatterns: ["*"] }])).rejects.toThrow("Git account is not attached to this bot");
    await expect(replace([{ gitAccountId: main.id, repoPatterns: ["*"] }, { gitAccountId: main.id, repoPatterns: ["a/b"] }])).rejects.toThrow("Duplicate git account in rules");
    await expect(replace([{ gitAccountId: main.id, repoPatterns: [" "] }])).rejects.toThrow("repoPatterns must not be empty");
    await expect(replace([{ gitAccountId: main.id, repoPatterns: ["a b"] }])).rejects.toThrow("Invalid repo pattern");
    expect(await git.listScopes(bot, "guild")).toEqual([]);
  });

  test("a channel rule needs a server rule and may only narrow it", async () => {
    const { git } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await expect(git.replaceScopes(t.id, bot, "guild", "chan", [{ gitAccountId: main.id, repoPatterns: ["*"] }])).rejects.toThrow("Channel rule needs the account enabled on the server first");
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["org/*"] }, { gitAccountId: alt.id, repoPatterns: ["*"] }]);
    await git.replaceScopes(t.id, bot, "guild", "chan", [{ gitAccountId: main.id, repoPatterns: ["org/api"] }]);
    await expect(git.replaceScopes(t.id, bot, "guild", "chan2", [{ gitAccountId: main.id, repoPatterns: ["*"] }])).rejects.toThrow('Pattern "*" is wider than the server rule');
    expect(await rulesOf(bot, "chan")).toEqual([[main.id, ["org/api"]]]);
    expect(await rulesOf(bot, "chan2")).toEqual([]);
  });

  test("narrowing a server rule narrows or drops the channel rules beneath it", async () => {
    const { git } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["*"] }, { gitAccountId: alt.id, repoPatterns: ["*"] }]);
    await git.replaceScopes(t.id, bot, "guild", "chan", [{ gitAccountId: main.id, repoPatterns: ["acme/api", "other/web"] }, { gitAccountId: alt.id, repoPatterns: ["x/y"] }]);
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["acme/*"] }]);
    expect(await rulesOf(bot, "chan")).toEqual([[main.id, ["acme/api"]]]);
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["zeta/*"] }]);
    expect(await rulesOf(bot, "chan")).toEqual([]);
  });

  test("unlinking an account from a bot removes its scopes on that bot", async () => {
    const { git } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["*"] }, { gitAccountId: alt.id, repoPatterns: ["*"] }]);
    await git.replaceScopes(t.id, bot, "guild", "chan", [{ gitAccountId: main.id, repoPatterns: ["a/b"] }]);
    await git.setBotAccounts(t.id, bot, [alt.id]);
    expect((await git.listScopes(bot, "guild")).map((s) => s.gitAccountId)).toEqual([alt.id]);
  });

  test("deleting an account removes its links and scopes, and leaves the bot's other accounts", async () => {
    const { git, bots } = use().repos;
    const { t, main, alt, bot } = await linkedBot();
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["*"] }, { gitAccountId: alt.id, repoPatterns: ["*"] }]);
    await git.replaceScopes(t.id, bot, "guild", "chan", [{ gitAccountId: main.id, repoPatterns: ["a/b"] }]);
    const gone = await newBot(t.id, "gone");
    await git.setBotAccounts(t.id, gone, [main.id]);
    await bots.remove(gone);

    expect(await git.deleteAccount(main.id)).toBe(true);
    expect(await git.listBotAccounts(bot)).toEqual([alt]);
    expect(await git.botAccountIds([bot, gone])).toEqual({ [bot]: [alt.id] });
    expect((await git.listScopes(bot, "guild")).map((s) => s.gitAccountId)).toEqual([alt.id]);
  });

  test("purging a tenant removes its accounts, links and scopes, and leaves other tenants alone", async () => {
    const { git, tenants } = use().repos;
    const { t, main, bot } = await linkedBot();
    await git.replaceScopes(t.id, bot, "guild", "", [{ gitAccountId: main.id, repoPatterns: ["*"] }]);
    const kept = await tenant("kept");
    const keptAccount = await account(kept.id, "main");
    expect(await tenants.purge(t.id)).toBe(true);
    expect(await git.getAccount(main.id)).toBeNull();
    expect(await git.listAccounts(t.id)).toEqual([]);
    expect(await git.botAccountIds([bot])).toEqual({});
    expect(await git.listScopes(bot, "guild")).toEqual([]);
    expect(await git.getAccount(keptAccount.id)).toEqual(keptAccount);
  });

  test("an OAuth app is found by provider and host, where no host means the public one", async () => {
    const { git } = use().repos;
    const hub = await git.createOAuthApp({ provider: "github", baseUrl: "", clientId: "cid", clientSecretEncrypted: "enc" });
    expect(hub).toMatchObject({ provider: "github", baseUrl: "", clientId: "cid", clientSecretEncrypted: "enc" });
    expect(hub.id).toMatch(UUID);
    expect(hub.createdAt).toBeInstanceOf(Date);
    const corp = await git.createOAuthApp({ provider: "gitlab", baseUrl: "https://gitlab.corp.example", clientId: "gid", clientSecretEncrypted: "enc" });
    expect(await git.findOAuthApp("github", null)).toEqual(hub);
    expect(await git.findOAuthApp("gitlab", "https://gitlab.corp.example")).toEqual(corp);
    expect(await git.findOAuthApp("gitlab", null)).toBeNull();
    expect(await git.findOAuthApp("github", "https://gitlab.corp.example")).toBeNull();
  });

  test("one OAuth app per provider and host; apps are listed newest first and deleted once", async () => {
    const { git } = use().repos;
    const old = await git.createOAuthApp({ provider: "github", baseUrl: "", clientId: "a", clientSecretEncrypted: "enc" });
    await expect(git.createOAuthApp({ provider: "github", baseUrl: "", clientId: "b", clientSecretEncrypted: "enc" })).rejects.toThrow();
    await Bun.sleep(2);
    const fresh = await git.createOAuthApp({ provider: "gitlab", baseUrl: "", clientId: "c", clientSecretEncrypted: "enc" });
    expect((await git.listOAuthApps()).map((a) => a.id)).toEqual([fresh.id, old.id]);
    expect(await git.deleteOAuthApp(old.id)).toBe(true);
    expect(await git.deleteOAuthApp(old.id)).toBe(false);
    expect(await git.listOAuthApps()).toEqual([fresh]);
  });
});
