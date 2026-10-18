import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

contract("Profiles", (use) => {
  test("a new profile takes the defaults it was not given and can be read back", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const created = await profiles.create(tenant.id, { name: "Fast", provider: "openai", model: "gpt-mini" });
    expect(created).toMatchObject({ tenantId: tenant.id, name: "Fast", provider: "openai", model: "gpt-mini", baseUrl: null, apiKeyEncrypted: null, acceptsImages: false, apiFormat: "chat_completions", fallbackProfileId: null });
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

  test("a profile names a fallback of its tenant, which can be cleared and is read back", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const backup = await profiles.create(tenant.id, { name: "Backup", provider: "openai", model: "b" });
    expect(backup.fallbackProfileId).toBeNull();
    const main = await profiles.create(tenant.id, { name: "Main", provider: "anthropic", model: "a", fallbackProfileId: backup.id });
    expect(main.fallbackProfileId).toBe(backup.id);
    expect((await profiles.get(main.id))!.fallbackProfileId).toBe(backup.id);

    expect((await profiles.update(main.id, { model: "a2" }))!.fallbackProfileId).toBe(backup.id);
    expect((await profiles.update(main.id, { fallbackProfileId: null }))!.fallbackProfileId).toBeNull();
    expect((await profiles.update(main.id, { fallbackProfileId: backup.id }))!.fallbackProfileId).toBe(backup.id);
    expect((await profiles.getForTenant(tenant.id, main.id))!.fallbackProfileId).toBe(backup.id);
  });

  test("a fallback of another tenant, the profile itself, or a chain that loops is refused", async () => {
    const { tenants, profiles } = use().repos;
    const [acme, other] = [await tenants.create({ name: "Acme", slug: "acme" }), await tenants.create({ name: "Other", slug: "other" })];
    const foreign = await profiles.create(other.id, { name: "Foreign", provider: "openai", model: "f" });
    await expect(profiles.create(acme.id, { name: "A", provider: "openai", model: "a", fallbackProfileId: foreign.id })).rejects.toThrow("Fallback profile not found");
    expect(await profiles.listForTenant(acme.id)).toEqual([]);

    const a = await profiles.create(acme.id, { name: "A", provider: "openai", model: "a" });
    await expect(profiles.update(a.id, { fallbackProfileId: foreign.id })).rejects.toThrow("Fallback profile not found");
    await expect(profiles.update(a.id, { fallbackProfileId: a.id })).rejects.toThrow("A profile cannot fall back to itself");

    const b = await profiles.create(acme.id, { name: "B", provider: "openai", model: "b", fallbackProfileId: a.id });
    await expect(profiles.update(a.id, { fallbackProfileId: b.id })).rejects.toThrow("Fallback chain would loop");
    const c = await profiles.create(acme.id, { name: "C", provider: "openai", model: "c", fallbackProfileId: b.id });
    await expect(profiles.update(a.id, { fallbackProfileId: c.id, model: "changed" })).rejects.toThrow("Fallback chain would loop");
    expect(await profiles.get(a.id)).toMatchObject({ model: "a", fallbackProfileId: null });
  });

  test("deleting a profile clears it as anyone's fallback", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const b = await profiles.create(tenant.id, { name: "B", provider: "openai", model: "b" });
    const a = await profiles.create(tenant.id, { name: "A", provider: "openai", model: "a", fallbackProfileId: b.id });
    expect(await profiles.remove(b.id)).toBe(true);
    expect((await profiles.get(a.id))!.fallbackProfileId).toBeNull();
  });

  test("purging a tenant removes its profiles", async () => {
    const { tenants, profiles } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const profile = await profiles.create(tenant.id, { name: "Fast", provider: "openai", model: "a" });
    await tenants.purge(tenant.id);
    expect(await profiles.get(profile.id)).toBeNull();
  });
});
