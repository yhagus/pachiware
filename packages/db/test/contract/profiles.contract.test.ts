import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

contract("Profiles", (use) => {
  test("a new profile takes the defaults it was not given and can be read back", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const created = await profiles.create(tenant.id, { name: "Fast", provider: "openai", model: "gpt-mini" });
    expect(created).toMatchObject({ tenantId: tenant.id, name: "Fast", provider: "openai", model: "gpt-mini", baseUrl: null, apiKeyEncrypted: null, acceptsImages: false, apiFormat: "chat_completions", fallbackModels: [] });
    expect(created.id).toMatch(UUID);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await profiles.get(created.id)).toEqual(created);
    expect(await profiles.get("missing")).toBeNull();

    const full = await profiles.create(tenant.id, { name: "Own", provider: "custom", model: "m", baseUrl: "https://llm.example", apiKeyEncrypted: "secret", acceptsImages: true, apiFormat: "messages" });
    expect(full).toMatchObject({ baseUrl: "https://llm.example", apiKeyEncrypted: "secret", acceptsImages: true, apiFormat: "messages" });
  });

  test("a tenant lists only its own profiles, newest first, and reads only its own", async () => {
    const { tenants, profiles } = use().repos;
    const [acme, other] = [await tenants.create({ name: "Acme", slug: "acme" }), await tenants.create({ name: "Other", slug: "other" })];
    const first = await profiles.create(acme.id, { name: "First", provider: "openai", model: "a" });
    await Bun.sleep(2);
    const second = await profiles.create(acme.id, { name: "Second", provider: "openai", model: "b" });
    const foreign = await profiles.create(other.id, { name: "Foreign", provider: "openai", model: "c" });
    expect((await profiles.listForTenant(acme.id)).map((p) => p.name)).toEqual(["Second", "First"]);
    expect(await profiles.getForTenant(acme.id, first.id)).toEqual(first);
    expect(await profiles.getForTenant(acme.id, foreign.id)).toBeNull();
    expect(await profiles.getForTenant(other.id, second.id)).toBeNull();
  });

  test("updating changes only the fields given, and a missing profile reads null", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const created = await profiles.create(tenant.id, { name: "Fast", provider: "openai", model: "gpt-mini", apiKeyEncrypted: "k" });
    const updated = await profiles.update(created.id, { model: "gpt-max", acceptsImages: true, baseUrl: null });
    expect(updated).toMatchObject({ id: created.id, name: "Fast", provider: "openai", model: "gpt-max", acceptsImages: true, apiKeyEncrypted: "k", baseUrl: null });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    expect(await profiles.get(created.id)).toEqual(updated);
    expect(await profiles.update("missing", { name: "x" })).toBeNull();
  });

  test("a bot answers with its tenant's profile, never another tenant's, and falls back once the profile is removed", async () => {
    const { tenants, profiles } = use().repos;
    const [acme, other] = [await tenants.create({ name: "Acme", slug: "acme" }), await tenants.create({ name: "Other", slug: "other" })];
    const own = await profiles.create(acme.id, { name: "Own", provider: "openai", model: "a" });
    const bot = (await use().repos.bots.create({ tenantId: acme.id, token: "token", profileId: own.id })).id;
    expect(await profiles.getForBot(acme.id, bot)).toEqual(own);
    expect(await profiles.getForBot(other.id, bot)).toBeNull();
    expect(await profiles.getForBot(acme.id, (await use().repos.bots.create({ tenantId: acme.id, token: "token", profileId: null })).id)).toBeNull();

    expect(await profiles.remove(own.id)).toBe(true);
    expect(await profiles.remove(own.id)).toBe(false);
    expect(await profiles.get(own.id)).toBeNull();
    expect(await profiles.getForBot(acme.id, bot)).toBeNull();
  });

  test("a profile keeps its fallback models in the order given; an update replaces the list, and other updates keep it", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const main = await profiles.create(tenant.id, { name: "Main", provider: "openai", model: "gpt-main", fallbackModels: ["gpt-z", "gpt-a"] });
    expect(main.fallbackModels).toEqual(["gpt-z", "gpt-a"]);
    expect((await profiles.get(main.id))!.fallbackModels).toEqual(["gpt-z", "gpt-a"]);

    expect((await profiles.update(main.id, { model: "gpt-main-2" }))!.fallbackModels).toEqual(["gpt-z", "gpt-a"]);
    expect((await profiles.update(main.id, { fallbackModels: ["gpt-a", "gpt-z"] }))!.fallbackModels).toEqual(["gpt-a", "gpt-z"]);
    expect((await profiles.getForTenant(tenant.id, main.id))!.fallbackModels).toEqual(["gpt-a", "gpt-z"]);
    expect((await profiles.update(main.id, { fallbackModels: [] }))!.fallbackModels).toEqual([]);
    expect((await profiles.listForTenant(tenant.id)).map((p) => [p.model, p.fallbackModels])).toEqual([["gpt-main-2", []]]);
  });

  test("purging a tenant removes its profiles", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const profile = await profiles.create(tenant.id, { name: "Fast", provider: "openai", model: "a" });
    await tenants.purge(tenant.id);
    expect(await profiles.get(profile.id)).toBeNull();
  });
});
