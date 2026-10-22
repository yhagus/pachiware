import { expect, test } from "bun:test";
import { contract, type EngineUnderTest } from "./engines.ts";

async function setup(engine: EngineUnderTest, slug = "acme") {
  const tenant = await engine.repos.tenants.create({ name: slug, slug });
  return { tenantId: tenant.id, botId: (await engine.repos.bots.create({ tenantId: tenant.id, token: crypto.randomUUID() })).id };
}
/** A document with keys in an order a JSON column would not keep, and spacing it would drop. */
const DOCUMENT = '{\n  "openapi": "3.1.2",\n  "info": { "version": "a1b2c3d", "title": "acme/api API changes" },\n  "paths": {}\n}\n';

contract("API previews", (use) => {
  test("a published preview keeps its document exactly as given, and is found by its id alone", async () => {
    const { apiPreviews } = use().repos;
    const { tenantId, botId } = await setup(use());
    const created = await apiPreviews.create({
      tenantId, botId, guildId: "g1", channelId: "c1", sourcePath: "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.json",
      title: "acme/api API changes", version: "a1b2c3d", document: DOCUMENT, createdById: "u-alice", createdByName: "Alice",
    });
    expect(created).toMatchObject({ tenantId, botId, guildId: "g1", channelId: "c1", title: "acme/api API changes", version: "a1b2c3d", document: DOCUMENT, createdById: "u-alice", createdByName: "Alice" });
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await apiPreviews.get(created.id)).toEqual(created);
    expect(await apiPreviews.get("missing")).toBeNull();

    const dm = await apiPreviews.create({ tenantId, botId, channelId: "dm-1", sourcePath: "dm/files/api.json", title: "Mine", document: "{}" });
    expect(dm).toMatchObject({ guildId: null, version: null, createdById: null, createdByName: null });
  });

  test("a tenant's previews are listed newest first without their documents, by bot or by place, and never another tenant's", async () => {
    const { apiPreviews, bots } = use().repos;
    const { tenantId, botId } = await setup(use());
    const other = await setup(use(), "other");
    const second = (await bots.create({ tenantId, token: crypto.randomUUID() })).id;
    const make = (bot: string, channelId: string, title: string, tenant = tenantId) => apiPreviews.create({ tenantId: tenant, botId: bot, channelId, sourcePath: `channel/files/${title}.json`, title, document: DOCUMENT });
    const first = await make(botId, "c1", "first");
    await Bun.sleep(5);
    const middle = await make(second, "c1", "middle");
    await Bun.sleep(5);
    const last = await make(botId, "c2", "last");
    await make(other.botId, "c1", "theirs", other.tenantId);

    const listed = await apiPreviews.list(tenantId);
    expect(listed.map((p) => p.title)).toEqual(["last", "middle", "first"]);
    expect(listed.every((p) => !("document" in p))).toBe(true);
    expect(listed[0]).toEqual((({ document: _, ...rest }) => rest)(last));
    expect((await apiPreviews.list(tenantId, { botId })).map((p) => p.id)).toEqual([last.id, first.id]);
    expect((await apiPreviews.list(tenantId, { botId, channelId: "c1" })).map((p) => p.id)).toEqual([first.id]);
    expect((await apiPreviews.list(tenantId, { channelId: "c1" })).map((p) => p.id)).toEqual([middle.id, first.id]);
  });

  test("a preview whose bot belongs to another tenant is rejected", async () => {
    const { apiPreviews } = use().repos;
    const mine = await setup(use()), theirs = await setup(use(), "other");
    await expect(apiPreviews.create({ tenantId: mine.tenantId, botId: theirs.botId, channelId: "c1", sourcePath: "channel/files/a.json", title: "a", document: "{}" })).rejects.toThrow();
    expect(await apiPreviews.list(mine.tenantId)).toEqual([]);
  });

  test("revoking removes only the tenant's own preview, and a purge takes them all", async () => {
    const { apiPreviews, tenants } = use().repos;
    const { tenantId, botId } = await setup(use());
    const other = await setup(use(), "other");
    const mine = await apiPreviews.create({ tenantId, botId, channelId: "c1", sourcePath: "channel/files/a.json", title: "a", document: "{}" });
    const theirs = await apiPreviews.create({ tenantId: other.tenantId, botId: other.botId, channelId: "c1", sourcePath: "channel/files/b.json", title: "b", document: "{}" });

    expect(await apiPreviews.remove(tenantId, theirs.id)).toBe(false);
    expect(await apiPreviews.get(theirs.id)).not.toBeNull();
    expect(await apiPreviews.remove(tenantId, mine.id)).toBe(true);
    expect(await apiPreviews.get(mine.id)).toBeNull();
    expect(await apiPreviews.remove(tenantId, mine.id)).toBe(false);

    expect(await tenants.purge(other.tenantId)).toBe(true);
    expect(await apiPreviews.get(theirs.id)).toBeNull();
    expect(await use().ownedRecords(other.tenantId)).toBe(0);
  });
});
