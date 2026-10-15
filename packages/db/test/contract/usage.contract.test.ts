import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

contract("Usage events", (use) => {
  test("a recorded event can be listed back with its defaults", async () => {
    const { tenants, usage } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    await usage.record({ tenantId: tenant.id, type: "tool_call", metadata: { name: "createTask", success: true } });
    const [event] = await usage.list({ tenantId: tenant.id });
    expect(event).toMatchObject({ tenantId: tenant.id, botId: null, type: "tool_call", provider: null, model: null, promptTokens: 0, completionTokens: 0, metadata: { name: "createTask", success: true } });
    expect(event!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event!.createdAt).toBeInstanceOf(Date);
  });

  test("listing filters by tenant and type, oldest first", async () => {
    const { tenants, usage } = use().repos;
    const [acme, other] = [await tenants.create({ name: "Acme", slug: "acme" }), await tenants.create({ name: "Other", slug: "other" })];
    await usage.record({ tenantId: acme.id, type: "llm_tokens", promptTokens: 1 });
    await Bun.sleep(2);
    await usage.record({ tenantId: acme.id, type: "tool_call" });
    await Bun.sleep(2);
    await usage.record({ tenantId: acme.id, type: "llm_tokens", promptTokens: 2 });
    await usage.record({ tenantId: other.id, type: "llm_tokens", promptTokens: 3 });
    expect((await usage.list({ tenantId: acme.id })).map((e) => e.type)).toEqual(["llm_tokens", "tool_call", "llm_tokens"]);
    expect((await usage.list({ tenantId: acme.id, type: "llm_tokens" })).map((e) => e.promptTokens)).toEqual([1, 2]);
    expect((await usage.list({ type: "llm_tokens" })).length).toBe(3);
    expect((await usage.list()).length).toBe(4);
  });

  test("an event naming a bot of another tenant is rejected", async () => {
    const { tenants, usage } = use().repos;
    const [acme, other] = [await tenants.create({ name: "Acme", slug: "acme" }), await tenants.create({ name: "Other", slug: "other" })];
    const bot = await use().addBot(acme.id, null);
    await usage.record({ tenantId: acme.id, botId: bot, type: "discord_message" });
    await expect(usage.record({ tenantId: other.id, botId: bot, type: "discord_message" })).rejects.toThrow();
    expect((await usage.list({ tenantId: acme.id }))[0]?.botId).toBe(bot);
    expect(await usage.list({ tenantId: other.id })).toEqual([]);
  });

  test("totals add up events per tenant, type, provider and model, cached tokens included", async () => {
    const { tenants, usage } = use().repos;
    const [acme, other] = [await tenants.create({ name: "Acme", slug: "acme" }), await tenants.create({ name: "Other", slug: "other" })];
    await usage.record({ tenantId: acme.id, type: "llm_tokens", provider: "openai", model: "gpt", promptTokens: 100, completionTokens: 10, metadata: { cachedTokens: 40, latencyMs: 5 } });
    await usage.record({ tenantId: acme.id, type: "llm_tokens", provider: "openai", model: "gpt", promptTokens: 50, completionTokens: 5, metadata: { cachedTokens: 0 } });
    await usage.record({ tenantId: acme.id, type: "llm_tokens", provider: "anthropic", model: "claude", promptTokens: 7, completionTokens: 3 });
    await usage.record({ tenantId: acme.id, type: "tool_call", metadata: { name: "x" } });
    await usage.record({ tenantId: acme.id, type: "tool_call" });
    await usage.record({ tenantId: other.id, type: "llm_tokens", provider: "openai", model: "gpt", promptTokens: 1, completionTokens: 1, metadata: { cachedTokens: 1 } });

    const byKey = (rows: Awaited<ReturnType<typeof usage.totals>>) => Object.fromEntries(rows.map((r) => [`${r.tenantId === acme.id ? "acme" : "other"}/${r.type}/${r.provider}/${r.model}`, [r.events, r.promptTokens, r.completionTokens, r.cachedTokens]]));
    expect(byKey(await usage.totals({ tenantId: acme.id }))).toEqual({
      "acme/llm_tokens/openai/gpt": [2, 150, 15, 40],
      "acme/llm_tokens/anthropic/claude": [1, 7, 3, 0],
      "acme/tool_call/null/null": [2, 0, 0, 0],
    });
    expect(Object.keys(byKey(await usage.totals())).sort()).toEqual(["acme/llm_tokens/anthropic/claude", "acme/llm_tokens/openai/gpt", "acme/tool_call/null/null", "other/llm_tokens/openai/gpt"]);
  });

  test("totals keep only events within the dates given", async () => {
    const { tenants, usage } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    await usage.record({ tenantId: tenant.id, type: "tool_call" });
    const recorded = (await usage.list({ tenantId: tenant.id }))[0]!.createdAt;
    const at = (ms: number) => new Date(recorded.getTime() + ms);
    expect((await usage.totals({ tenantId: tenant.id, from: at(-60_000), to: at(60_000) }))[0]?.events).toBe(1);
    expect(await usage.totals({ tenantId: tenant.id, from: at(60_000) })).toEqual([]);
    expect(await usage.totals({ tenantId: tenant.id, to: at(-60_000) })).toEqual([]);
  });

  test("purging a tenant removes its usage", async () => {
    const { tenants, usage } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    await usage.record({ tenantId: tenant.id, type: "tool_call" });
    await tenants.purge(tenant.id);
    expect(await usage.list({ tenantId: tenant.id })).toEqual([]);
  });
});
