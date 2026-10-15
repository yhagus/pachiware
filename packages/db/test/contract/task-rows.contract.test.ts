import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

contract("Task rows", (use) => {
  test("a row keeps what it was given, takes defaults for the rest, and lists oldest first, for everyone or one tenant", async () => {
    const { taskRows, tenants } = use().repos;
    const alpha = await tenants.create({ name: "Alpha", slug: "alpha" }), beta = await tenants.create({ name: "Beta", slug: "beta" });
    const first = await taskRows.create({ tenantId: alpha.id, title: "Channel task", description: "body", status: "in_progress", priority: "high", assignedTo: "dewi", discordGuildId: "g1", discordChannelId: "c1", metadata: { source: "web" } });
    expect(first).toMatchObject({ tenantId: alpha.id, title: "Channel task", description: "body", status: "in_progress", priority: "high", assignedTo: "dewi", discordGuildId: "g1", discordChannelId: "c1", metadata: { source: "web" } });
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.updatedAt).toBeInstanceOf(Date);
    await Bun.sleep(2);
    const second = await taskRows.create({ tenantId: beta.id, title: "Other tenant" });
    expect(second).toMatchObject({ description: null, status: "pending", priority: "medium", assignedTo: null, discordGuildId: null, discordChannelId: null, metadata: {} });
    await Bun.sleep(2);
    await taskRows.create({ tenantId: alpha.id, title: "No place" });

    expect((await taskRows.list()).map((r) => r.title)).toEqual(["Channel task", "Other tenant", "No place"]);
    expect((await taskRows.list(alpha.id)).map((r) => r.title)).toEqual(["Channel task", "No place"]);
    expect((await taskRows.list())[0]).toEqual(first);
    expect(await taskRows.list("missing")).toEqual([]);
  });

  test("purging a tenant removes its rows and keeps everyone else's", async () => {
    const { taskRows, tenants } = use().repos;
    const doomed = await tenants.create({ name: "Doomed", slug: "doomed" }), kept = await tenants.create({ name: "Kept", slug: "kept" });
    await taskRows.create({ tenantId: doomed.id, title: "gone" });
    await taskRows.create({ tenantId: kept.id, title: "stays" });
    await tenants.purge(doomed.id);
    expect((await taskRows.list()).map((r) => r.title)).toEqual(["stays"]);
  });
});
