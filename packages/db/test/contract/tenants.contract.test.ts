import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

contract("Tenants and API keys", (use) => {
  test("a new tenant is active and can be read back by id and by slug", async () => {
    const { tenants } = use().repos;
    const created = await tenants.create({ name: "Acme", slug: "acme", metadata: { plan: "team" } });
    expect(created).toMatchObject({ name: "Acme", slug: "acme", status: "active", apiKeyId: null, platformMetadata: { plan: "team" } });
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await tenants.get(created.id)).toEqual(created);
    expect(await tenants.getBySlug("acme")).toEqual(created);
    expect(await tenants.get("missing")).toBeNull();
  });

  test("a second tenant with a slug already in use is rejected", async () => {
    const { tenants } = use().repos;
    await tenants.create({ name: "Acme", slug: "acme" });
    await expect(tenants.create({ name: "Other", slug: "acme" })).rejects.toThrow();
    expect(await tenants.count()).toBe(1);
  });

  test("a tenant without a slug gets a unique one", async () => {
    const { tenants } = use().repos;
    const [a, b] = [await tenants.create({ name: "A" }), await tenants.create({ name: "B" })];
    expect(a.slug).not.toBe(b.slug);
  });

  test("updating changes name, status and metadata, and rejects an unknown status", async () => {
    const { tenants } = use().repos;
    const created = await tenants.create({ name: "Acme", slug: "acme" });
    const updated = await tenants.update(created.id, { name: "Acme Inc", status: "suspended", metadata: { tier: 2 } });
    expect(updated).toMatchObject({ id: created.id, name: "Acme Inc", slug: "acme", status: "suspended", platformMetadata: { tier: 2 } });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    expect(await tenants.get(created.id)).toEqual(updated);
    await expect(tenants.update(created.id, { status: "archived" })).rejects.toThrow("Invalid tenant status");
    expect(await tenants.update("missing", { name: "x" })).toBeNull();
  });

  test("listing returns tenants oldest first and leaves out removed ones, as does the count", async () => {
    const { tenants } = use().repos;
    const first = await tenants.create({ name: "First", slug: "first" });
    await Bun.sleep(2);
    const second = await tenants.create({ name: "Second", slug: "second" });
    await Bun.sleep(2);
    const third = await tenants.create({ name: "Third", slug: "third" });
    expect((await tenants.list()).map((t) => t.slug)).toEqual(["first", "second", "third"]);
    expect(await tenants.count()).toBe(3);

    expect((await tenants.remove(second.id))?.status).toBe("deleted");
    expect((await tenants.list()).map((t) => t.id)).toEqual([first.id, third.id]);
    expect(await tenants.count()).toBe(2);
  });

  test("a removed tenant disappears from every read but keeps its slug and its records", async () => {
    const { tenants } = use().repos;
    const removed = await tenants.create({ name: "Gone", slug: "gone" });
    const owned = await use().ownedRecords(removed.id);
    await tenants.remove(removed.id);
    expect(await tenants.get(removed.id)).toBeNull();
    expect(await tenants.getBySlug("gone")).toBeNull();
    expect(await tenants.update(removed.id, { name: "Back" })).toBeNull();
    expect(await tenants.remove(removed.id)).toBeNull();
    expect(await use().ownedRecords(removed.id)).toBe(owned);
    await expect(tenants.create({ name: "Again", slug: "gone" })).rejects.toThrow();
  });

  test("a new tenant gets its default records, and seeding again adds no duplicates", async () => {
    const { tenants } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const defaults = await use().ownedRecords(tenant.id);
    expect(defaults).toBeGreaterThan(1);
    await tenants.seedDefaults();
    expect(await use().ownedRecords(tenant.id)).toBe(defaults);
  });

  test("purging a tenant deletes it and everything it owns, and frees its slug", async () => {
    const { tenants } = use().repos;
    const key = await tenants.issueApiKey("deploy");
    const doomed = await tenants.create({ name: "Doomed", slug: "doomed", apiKeyId: key.keyId });
    const kept = await tenants.create({ name: "Kept", slug: "kept", apiKeyId: key.keyId });
    const keptRecords = await use().ownedRecords(kept.id);
    expect(await use().ownedRecords(doomed.id)).toBeGreaterThan(0);

    expect(await tenants.purge(doomed.id)).toBe(true);
    expect(await use().ownedRecords(doomed.id)).toBe(0);
    expect(await tenants.get(doomed.id)).toBeNull();
    expect((await tenants.listForApiKey(key.keyId)).map((t) => t.slug)).toEqual(["kept"]);
    expect(await use().ownedRecords(kept.id)).toBe(keptRecords);
    expect(await tenants.getApiKey(key.keyId)).not.toBeNull();
    expect((await tenants.create({ name: "Reborn", slug: "doomed" })).slug).toBe("doomed");
    expect(await tenants.purge(doomed.id)).toBe(false);
  });

  test("an issued key resolves from its raw value, is stored without it, and stops resolving once revoked", async () => {
    const { tenants } = use().repos;
    const issued = await tenants.issueApiKey("deploy");
    expect(issued.raw.startsWith(issued.keyPrefix)).toBe(true);
    const resolved = await tenants.resolveApiKey(issued.raw);
    expect(resolved).toMatchObject({ id: issued.keyId, name: "deploy", keyPrefix: issued.keyPrefix, scopes: ["*"], lastUsedAt: null, revokedAt: null });
    expect(JSON.stringify(resolved)).not.toContain(issued.raw);
    expect(await tenants.resolveApiKey("pk_live_unknown")).toBeNull();
    expect(await tenants.resolveApiKey("")).toBeNull();
    expect(await tenants.resolveApiKey("x".repeat(257))).toBeNull();

    await tenants.touchApiKey(issued.keyId);
    expect((await tenants.getApiKey(issued.keyId))?.lastUsedAt).toBeInstanceOf(Date);

    await tenants.revokeApiKey(issued.keyId);
    expect(await tenants.resolveApiKey(issued.raw)).toBeNull();
    expect((await tenants.getApiKey(issued.keyId))?.revokedAt).toBeInstanceOf(Date);
    expect(await tenants.getApiKey("missing")).toBeNull();
  });

  test("a key reaches only the tenants created under or linked to it, by id or slug", async () => {
    const { tenants } = use().repos;
    const key = await tenants.issueApiKey("one"), other = await tenants.issueApiKey("two");
    const owned = await tenants.create({ name: "Acme", slug: "acme", apiKeyId: key.keyId });
    await Bun.sleep(2);
    const loose = await tenants.create({ name: "Loose", slug: "loose" });
    expect((await tenants.getForApiKey(key.keyId, "acme"))?.id).toBe(owned.id);
    expect((await tenants.getForApiKey(key.keyId, owned.id))?.id).toBe(owned.id);
    expect(await tenants.getForApiKey(other.keyId, "acme")).toBeNull();
    expect(await tenants.getForApiKey(key.keyId, "loose")).toBeNull();

    expect((await tenants.linkApiKey(loose.id, key.keyId))?.apiKeyId).toBe(key.keyId);
    expect((await tenants.listForApiKey(key.keyId)).map((t) => t.slug)).toEqual(["acme", "loose"]);
    expect((await tenants.linkApiKey(loose.id, null))?.apiKeyId).toBeNull();
    expect((await tenants.listForApiKey(key.keyId)).map((t) => t.slug)).toEqual(["acme"]);

    await tenants.remove(owned.id);
    expect(await tenants.getForApiKey(key.keyId, "acme")).toBeNull();
    expect(await tenants.listForApiKey(key.keyId)).toEqual([]);
  });

  test("listing keys counts the tenants each one holds, leaving out removed tenants", async () => {
    const { tenants } = use().repos;
    const busy = await tenants.issueApiKey("busy");
    await Bun.sleep(2);
    const idle = await tenants.issueApiKey("idle");
    await tenants.create({ name: "A", slug: "a", apiKeyId: busy.keyId });
    const b = await tenants.create({ name: "B", slug: "b", apiKeyId: busy.keyId });
    await tenants.create({ name: "C", slug: "c", apiKeyId: busy.keyId });
    await tenants.remove(b.id);
    await tenants.revokeApiKey(idle.keyId);
    const listed = await tenants.listApiKeys();
    expect(listed.map((k) => [k.name, k.tenantCount, k.revokedAt === null])).toEqual([["busy", 2, true], ["idle", 0, false]]);
    expect(JSON.stringify(listed)).not.toContain(busy.raw);
  });
});
