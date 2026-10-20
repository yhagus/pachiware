import { expect, test } from "bun:test";
import { contract, type EngineUnderTest } from "./engines.ts";

async function setup(engine: EngineUnderTest) {
  const tenant = await engine.repos.tenants.create({ name: "Acme", slug: "acme" });
  return { tenantId: tenant.id, botId: (await engine.repos.bots.create({ tenantId: tenant.id, token: crypto.randomUUID() })).id };
}

contract("Schedules", (use) => {
  test("a new Reminder keeps what it was given, takes defaults for the rest, and reads back by id", async () => {
    const { schedules } = use().repos;
    const { tenantId, botId } = await setup(use());
    const created = await schedules.create({
      tenantId, botId, guildId: "g1", channelId: "c1", ownerId: "u-alice", ownerName: "Alice", text: "send the invoice", withTasks: true,
      mentions: ["u-bob"], recurrence: "weekly", weekdays: [1, 3], timeOfDay: "09:00", timezone: "Asia/Jakarta",
      until: new Date("2026-12-31T16:59:59Z"), nextAt: new Date("2026-03-09T02:00:00Z"),
    });
    expect(created).toMatchObject({
      tenantId, botId, kind: "reminder", guildId: "g1", channelId: "c1", ownerId: "u-alice", ownerName: "Alice", text: "send the invoice", withTasks: true,
      mentions: ["u-bob"], recurrence: "weekly", weekdays: [1, 3], dayOfMonth: null, timeOfDay: "09:00", timezone: "Asia/Jakarta",
      until: new Date("2026-12-31T16:59:59Z"), nextAt: new Date("2026-03-09T02:00:00Z"), lastFiredAt: null, status: "active", attempts: 0, error: null,
    });
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await schedules.get(created.id)).toEqual(created);
    expect(await schedules.get("missing")).toBeNull();

    const digest = await schedules.create({ tenantId, botId, kind: "digest", guildId: "g1", channelId: "c2", recurrence: "daily", timeOfDay: "08:00", timezone: "UTC", nextAt: new Date("2026-03-07T08:00:00Z") });
    expect(digest).toMatchObject({ kind: "digest", ownerId: null, ownerName: null, text: "", withTasks: false, mentions: [], weekdays: [], until: null });
  });

  test("everything active and due at or before a given time is found, soonest first", async () => {
    const { schedules } = use().repos;
    const { tenantId, botId } = await setup(use());
    const at = (iso: string, extra = {}) => schedules.create({ tenantId, botId, channelId: "c1", text: iso, timezone: "UTC", nextAt: new Date(iso), ...extra });
    await at("2026-03-06T10:00:00Z");
    await at("2026-03-06T08:00:00Z");
    await at("2026-03-06T09:00:00Z", { status: "cancelled" });
    await at("2026-03-06T07:00:00Z", { status: "done" });
    await at("2026-03-06T12:00:00Z");
    await at("2026-03-06T10:00:01Z");
    expect((await schedules.due(new Date("2026-03-06T10:00:00Z"))).map((s) => s.text)).toEqual(["2026-03-06T08:00:00Z", "2026-03-06T10:00:00Z"]);
    expect(await schedules.due(new Date("2026-03-06T07:59:59Z"))).toEqual([]);
  });

  test("listing and counting match every field given, soonest first", async () => {
    const { schedules } = use().repos;
    const { tenantId, botId } = await setup(use());
    const otherBot = (await use().repos.bots.create({ tenantId, token: "other" })).id;
    const other = await setup2(use());
    const add = (text: string, nextAt: string, extra = {}) => schedules.create({ tenantId, botId, guildId: "g1", channelId: "c1", ownerId: "u-alice", text, timezone: "UTC", nextAt: new Date(nextAt), ...extra });
    await add("late", "2026-03-06T12:00:00Z");
    await add("early", "2026-03-06T08:00:00Z");
    await add("bob's", "2026-03-06T09:00:00Z", { ownerId: "u-bob" });
    await add("bob's in a DM", "2026-03-06T09:30:00Z", { ownerId: "u-bob", guildId: null });
    await add("cancelled", "2026-03-06T07:00:00Z", { status: "cancelled" });
    await add("digest", "2026-03-06T10:00:00Z", { kind: "digest", ownerId: null, channelId: "c2" });
    await add("other bot", "2026-03-06T11:00:00Z", { botId: otherBot, guildId: "g2" });
    await schedules.create({ tenantId: other.tenantId, botId: other.botId, guildId: "g1", channelId: "c1", ownerId: "u-alice", text: "other tenant", timezone: "UTC", nextAt: new Date("2026-03-06T06:00:00Z") });
    const texts = async (filter: Parameters<typeof schedules.list>[0]) => (await schedules.list(filter)).map((s) => s.text);

    expect(await texts({ tenantId, kind: "reminder", status: "active" })).toEqual(["early", "bob's", "bob's in a DM", "other bot", "late"]);
    expect(await texts({ tenantId, kind: "reminder", status: "active", ownerId: "u-alice" })).toEqual(["early", "other bot", "late"]);
    expect(await texts({ tenantId, kind: "reminder", status: "active", visibleTo: { ownerId: "u-alice" } })).toEqual(["early", "other bot", "late"]);
    expect(await texts({ tenantId, kind: "reminder", status: "active", visibleTo: { ownerId: "u-alice", guildId: "g1" } })).toEqual(["early", "bob's", "other bot", "late"]);
    expect(await texts({ botId, guildId: "g1", kind: "digest", status: "active" })).toEqual(["digest"]);
    expect(await texts({ botId: otherBot })).toEqual(["other bot"]);
    expect(await texts({ tenantId })).toHaveLength(7);
    expect(await texts({})).toHaveLength(8);
    expect(await texts(undefined)).toHaveLength(8);
    const [early] = await schedules.list({ tenantId, ownerId: "u-alice", status: "active" });
    expect(await texts({ botId, id: early!.id, status: "active" })).toEqual(["early"]);
    expect(await texts({ botId: otherBot, id: early!.id })).toEqual([]);

    expect(await schedules.count({ tenantId, kind: "reminder", status: "active" })).toBe(5);
    expect(await schedules.count({ tenantId, kind: "reminder", status: "active", ownerId: "u-bob" })).toBe(2);
    expect(await schedules.count({ tenantId: "missing" })).toBe(0);
    expect(await schedules.count()).toBe(8);
  });

  test("a Routine is a kind of its own, and a list of kinds matches any of them in listing and counting", async () => {
    const { schedules } = use().repos;
    const { tenantId, botId } = await setup(use());
    const add = (text: string, nextAt: string, extra = {}) => schedules.create({ tenantId, botId, guildId: "g1", channelId: "c1", ownerId: "u-alice", text, timezone: "UTC", nextAt: new Date(nextAt), ...extra });
    await add("reminder", "2026-03-06T09:00:00Z");
    await add("routine", "2026-03-06T08:00:00Z", { kind: "routine", recurrence: "daily", timeOfDay: "08:00" });
    await add("digest", "2026-03-06T07:00:00Z", { kind: "digest", ownerId: null });
    const texts = async (filter: Parameters<typeof schedules.list>[0]) => (await schedules.list(filter)).map((s) => s.text);

    expect(await texts({ tenantId, kind: "routine" })).toEqual(["routine"]);
    expect(await texts({ tenantId, kind: ["reminder", "routine"] })).toEqual(["routine", "reminder"]);
    expect(await texts({ tenantId, kind: ["reminder", "routine"], ownerId: "u-alice", status: "active" })).toEqual(["routine", "reminder"]);
    expect(await texts({ tenantId, kind: [] })).toEqual([]);
    expect(await schedules.count({ tenantId, kind: ["reminder", "routine"] })).toBe(2);
    expect(await schedules.count({ tenantId, kind: ["digest"] })).toBe(1);
  });

  test("an update changes only the fields given and returns the schedule; an unknown id gives null", async () => {
    const { schedules } = use().repos;
    const { tenantId, botId } = await setup(use());
    const created = await schedules.create({ tenantId, botId, kind: "digest", guildId: "g1", channelId: "c1", recurrence: "daily", timeOfDay: "08:00", timezone: "UTC", nextAt: new Date("2026-03-06T08:00:00Z") });
    const failed = await schedules.update(created.id, { attempts: 2, error: "Could not post" });
    expect(failed).toEqual({ ...created, attempts: 2, error: "Could not post" });
    const moved = await schedules.update(created.id, { timeOfDay: "09:00", timezone: "Asia/Jakarta", nextAt: new Date("2026-03-07T02:00:00Z"), lastFiredAt: new Date("2026-03-06T08:00:05Z"), attempts: 0, error: null });
    expect(moved).toEqual({ ...created, timeOfDay: "09:00", timezone: "Asia/Jakarta", nextAt: new Date("2026-03-07T02:00:00Z"), lastFiredAt: new Date("2026-03-06T08:00:05Z") });
    expect(await schedules.update(created.id, { text: "Send the invoice to Acme" })).toMatchObject({ text: "Send the invoice to Acme", timeOfDay: "09:00" });
    expect(await schedules.update(created.id, { status: "cancelled" })).toMatchObject({ status: "cancelled", timeOfDay: "09:00" });
    expect(await schedules.get(created.id)).toMatchObject({ status: "cancelled" });
    expect(await schedules.update("missing", { status: "done" })).toBeNull();
  });

  test("a schedule whose bot belongs to another tenant is rejected", async () => {
    const { schedules } = use().repos;
    const mine = await setup(use()), theirs = await setup2(use());
    await expect(schedules.create({ tenantId: mine.tenantId, botId: theirs.botId, channelId: "c1", timezone: "UTC", nextAt: new Date() })).rejects.toThrow();
    expect(await schedules.count()).toBe(0);
  });

  test("purging a tenant removes its schedules and keeps everyone else's", async () => {
    const { schedules, tenants } = use().repos;
    const doomed = await setup(use()), kept = await setup2(use());
    for (const { tenantId, botId } of [doomed, kept]) await schedules.create({ tenantId, botId, channelId: "c1", timezone: "UTC", nextAt: new Date() });
    await tenants.purge(doomed.tenantId);
    expect((await schedules.list()).map((s) => s.tenantId)).toEqual([kept.tenantId]);
  });
});

async function setup2(engine: EngineUnderTest) {
  const tenant = await engine.repos.tenants.create({ name: "Other", slug: "other" });
  return { tenantId: tenant.id, botId: (await engine.repos.bots.create({ tenantId: tenant.id, token: crypto.randomUUID() })).id };
}
