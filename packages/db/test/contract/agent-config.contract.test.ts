import { expect, test } from "bun:test";
import { DEFAULT_SYSTEM_PROMPT } from "../../src/persona.ts";
import { contract } from "./engines.ts";

contract("Agent configuration", (use) => {
  test("a new tenant starts from the default configuration", async () => {
    const { tenants, agentConfig } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const config = await agentConfig.get(tenant.id);
    expect(config).toEqual({
      tenantId: tenant.id, name: "Pachiware Agent", systemPrompt: DEFAULT_SYSTEM_PROMPT, defaultProvider: "openai", defaultModel: "gpt-4o", temperature: 0.2, maxTokens: 4096,
      openaiApiKeyEncrypted: null, openaiBaseUrl: null, openaiModel: null, anthropicApiKeyEncrypted: null, anthropicBaseUrl: null, anthropicModel: null,
      customBaseUrl: null, customApiKeyEncrypted: null, customModel: null, timezone: "Asia/Jakarta", language: "id", settings: { maxReActIterations: 32 },
      updatedAt: expect.any(Date),
    });
    expect(await agentConfig.get("missing")).toBeNull();
  });

  test("updating changes only the fields given and keeps settings as an object", async () => {
    const { tenants, agentConfig } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const before = await agentConfig.get(tenant.id);
    const updated = await agentConfig.update(tenant.id, { defaultProvider: "anthropic", anthropicApiKeyEncrypted: "secret", temperature: 0.7, language: "en", settings: { maxReActIterations: 8, nested: { on: true } } });
    expect(updated).toMatchObject({ tenantId: tenant.id, name: "Pachiware Agent", defaultProvider: "anthropic", anthropicApiKeyEncrypted: "secret", temperature: 0.7, language: "en", timezone: "Asia/Jakarta", settings: { maxReActIterations: 8, nested: { on: true } } });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
    expect(await agentConfig.get(tenant.id)).toEqual(updated);
    expect((await agentConfig.update(tenant.id, { anthropicApiKeyEncrypted: null }))?.anthropicApiKeyEncrypted).toBeNull();
    expect(await agentConfig.update("missing", { name: "x" })).toBeNull();
  });

  test("purging a tenant removes its configuration", async () => {
    const { tenants, agentConfig } = use().repos;
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    await tenants.purge(tenant.id);
    expect(await agentConfig.get(tenant.id)).toBeNull();
  });
});
