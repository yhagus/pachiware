import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { openAIReply } from "./support/images";

const create = (s: Scenario, body: Record<string, unknown>) => s.admin("POST", `/api/admin/tenants/${s.tenant.id}/profiles`, body);

discordScenario("a DeepSeek profile needs no base URL: its models list, its Test and the bot's replies go to api.deepseek.com with a bearer key", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const created = await create(s, { name: "DeepSeek", provider: "deepseek", model: "deepseek-flash", fallbackModels: ["deepseek-v4-pro"], apiKey: "ds-key" });
  expect(created.status).toBe(201);
  expect(created.body.profile).toMatchObject({ provider: "deepseek", baseUrl: null, apiFormat: "chat_completions", hasApiKey: true });
  const id = created.body.profile.id;

  s.http.on("GET api.deepseek.com/models", () => ({ object: "list", data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-flash" }] }));
  const listed = await s.admin("POST", "/api/admin/profiles/models", { provider: "deepseek", profileId: id });
  expect([listed.status, listed.body.models]).toEqual([200, ["deepseek-flash", "deepseek-v4-pro"]]);
  expect(s.http.requests.at(-1)).toMatchObject({ url: "https://api.deepseek.com/models", headers: { authorization: "Bearer ds-key" } });

  s.http.on("POST api.deepseek.com/chat/completions", () => openAIReply("OK"));
  const tested = await s.admin("POST", "/api/admin/profiles/test", { provider: "deepseek", model: "deepseek-flash", profileId: id });
  expect(tested.body.checks.text.status).toBe("ok");

  const { repositories } = await import("../../../packages/db/src/index.ts");
  await repositories().bots.update(s.bot.id, { profileId: id });
  s.model.live();
  s.http.on("POST api.deepseek.com/chat/completions", () => openAIReply("Pong."));
  await s.discord.send(`${s.discord.mention} ping`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Pong.");
  const asked = s.http.requests.filter((r) => r.method === "POST" && r.url === "https://api.deepseek.com/chat/completions").at(-1)!;
  expect([asked.body.model, asked.headers.authorization]).toEqual(["deepseek-flash", "Bearer ds-key"]);
  const usage = (await repositories().usage.list()).filter((r: any) => r.tenantId === s.tenant.id && r.type === "llm_tokens");
  expect(usage.map((r: any) => [r.provider, r.model])).toEqual([["deepseek", "deepseek-flash"]]);
});

discordScenario("only a BYOK profile takes a base URL, and a BYOK profile switched to OpenAI loses it", async (s) => {
  for (const provider of ["openai", "anthropic", "deepseek"]) {
    const refused = await create(s, { name: provider, provider, model: "m", baseUrl: "https://proxy.example/v1" });
    expect([refused.status, refused.body.error]).toEqual([400, "Only a BYOK profile takes a baseUrl"]);
  }
  expect((await create(s, { name: "Blank", provider: "openai", model: "m", baseUrl: "" })).body.profile.baseUrl).toBeNull();
  const listed = await s.admin("POST", "/api/admin/profiles/models", { provider: "openai", baseUrl: "https://proxy.example/v1", apiKey: "k" });
  expect([listed.status, listed.body.error]).toEqual([400, "Only a BYOK profile takes a baseUrl"]);

  const own = (await create(s, { name: "Own", provider: "custom", apiFormat: "messages", model: "m", baseUrl: "https://llm.example/v1" })).body.profile;
  const moved = await s.admin("PATCH", `/api/admin/profiles/${own.id}`, { provider: "openai" });
  expect([moved.status, moved.body.profile.provider, moved.body.profile.baseUrl]).toEqual([200, "openai", null]);
  const pointed = await s.admin("PATCH", `/api/admin/profiles/${own.id}`, { baseUrl: "https://llm.example/v1" });
  expect([pointed.status, pointed.body.error]).toEqual([400, "Only a BYOK profile takes a baseUrl"]);
  const back = await s.admin("PATCH", `/api/admin/profiles/${own.id}`, { provider: "custom" });
  expect([back.status, back.body.error]).toEqual([400, "A custom provider needs a baseUrl"]);
});
