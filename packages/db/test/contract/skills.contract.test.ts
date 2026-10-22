import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

const BUILT_IN = ["discord_management", "git_repositories", "openapi", "plane", "reminders", "task_management", "workspace"];

contract("Skills", (use) => {
  test("registering a skill again refreshes its name, description and tools, and keeps its default", async () => {
    const { skills } = use().repos;
    expect((await skills.list()).map((s) => s.id)).toEqual(BUILT_IN);
    const extra = { id: "extra", name: "Extra", description: "First.", defaultEnabled: false, toolDefinitions: [{ name: "a" }], handlerType: "builtin", config: { mode: "x" } };
    expect(await skills.register(extra)).toBe(true);
    expect(await skills.register({ ...extra, name: "Extra 2", description: "Second.", defaultEnabled: true, toolDefinitions: [{ name: "b" }] })).toBe(false);
    const [stored] = (await skills.list()).filter((s) => s.id === "extra");
    expect(stored).toMatchObject({ id: "extra", name: "Extra 2", description: "Second.", defaultEnabled: false, toolDefinitions: [{ name: "b" }], handlerType: "builtin", config: { mode: "x" } });
    expect(stored!.createdAt).toBeInstanceOf(Date);
  });

  test("a new tenant has a switch for every registered skill, each at the skill's default", async () => {
    const { tenants, skills } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const listed = await skills.listForTenant(tenant.id);
    expect(listed.map((l) => l.skill.id)).toEqual(BUILT_IN);
    for (const { skill, state } of listed) {
      expect(state).toMatchObject({ tenantId: tenant.id, skillId: skill.id, isEnabled: skill.defaultEnabled, config: {} });
      expect(state.updatedAt).toBeInstanceOf(Date);
    }
    expect(listed.find((l) => l.skill.id === "git_repositories")?.state.isEnabled).toBe(false);
    expect(await skills.listForTenant("missing")).toEqual([]);
  });

  test("switching a skill changes only that tenant's switch, and the enabled list follows", async () => {
    const { tenants, skills } = use().repos;
    const acme = await tenants.create({ name: "Acme", slug: "acme" });
    const other = await tenants.create({ name: "Other", slug: "other" });
    expect((await skills.listEnabled(acme.id)).map((s) => s.id)).toEqual(["discord_management", "openapi", "reminders", "task_management", "workspace"]);

    const off = await skills.setEnabled(acme.id, "workspace", false);
    expect(off).toMatchObject({ tenantId: acme.id, skillId: "workspace", isEnabled: false });
    expect(await skills.getForTenant(acme.id, "workspace")).toEqual(off);
    expect((await skills.listEnabled(acme.id)).map((s) => s.id)).toEqual(["discord_management", "openapi", "reminders", "task_management"]);
    expect((await skills.getForTenant(other.id, "workspace"))?.isEnabled).toBe(true);

    expect((await skills.setEnabled(acme.id, "git_repositories", true))?.isEnabled).toBe(true);
    const [git] = await skills.listEnabled(acme.id).then((list) => list.filter((s) => s.id === "git_repositories"));
    expect(git).toMatchObject({ id: "git_repositories", name: "Git Repositories", defaultEnabled: false });

    expect(await skills.setEnabled(acme.id, "unknown", true)).toBeNull();
    expect(await skills.getForTenant(acme.id, "unknown")).toBeNull();
    expect(await skills.listEnabled("missing")).toEqual([]);
  });

  test("a tenant's configuration of a skill is replaced whole and kept as an object", async () => {
    const { tenants, skills } = use().repos;
    const acme = await tenants.create({ name: "Acme", slug: "acme" });
    const first = await skills.setConfig(acme.id, "reminders", { quiet: { from: "22:00" }, channels: ["a", "b"] });
    expect(first?.config).toEqual({ quiet: { from: "22:00" }, channels: ["a", "b"] });
    expect((await skills.setConfig(acme.id, "reminders", { limit: 3 }))?.config).toEqual({ limit: 3 });
    expect((await skills.getForTenant(acme.id, "reminders"))?.config).toEqual({ limit: 3 });
    expect(await skills.setConfig(acme.id, "unknown", {})).toBeNull();
  });

  test("enabling a skill twice leaves one switch, on, and an unregistered skill is refused", async () => {
    const { tenants, skills } = use().repos;
    const acme = await tenants.create({ name: "Acme", slug: "acme" });
    const records = await use().ownedRecords(acme.id);
    expect(await skills.enable(acme.id, "git_repositories")).toBe(true);
    expect(await skills.enable(acme.id, "git_repositories")).toBe(true);
    expect((await skills.getForTenant(acme.id, "git_repositories"))?.isEnabled).toBe(true);
    expect(await use().ownedRecords(acme.id)).toBe(records);
    expect(await skills.enable(acme.id, "unknown")).toBe(false);
    expect(await skills.getForTenant(acme.id, "unknown")).toBeNull();
  });

  test("seeding a tenant gives it only the switches it lacks, and keeps the ones it has", async () => {
    const { tenants, skills } = use().repos;
    const acme = await tenants.create({ name: "Acme", slug: "acme" });
    await skills.setEnabled(acme.id, "workspace", false);
    await skills.register({ id: "extra", name: "Extra", description: "Added later.", defaultEnabled: false, toolDefinitions: [], handlerType: "builtin", config: { mode: "x" } });
    expect(await skills.getForTenant(acme.id, "extra")).toBeNull();

    await skills.seedTenant(acme.id);
    await skills.seedTenant(acme.id);
    const listed = await skills.listForTenant(acme.id);
    expect(listed.map((l) => l.skill.id)).toEqual(["discord_management", "extra", "git_repositories", "openapi", "plane", "reminders", "task_management", "workspace"]);
    expect(listed.find((l) => l.skill.id === "extra")?.state).toMatchObject({ isEnabled: false, config: { mode: "x" } });
    expect((await skills.getForTenant(acme.id, "workspace"))?.isEnabled).toBe(false);
  });
});
