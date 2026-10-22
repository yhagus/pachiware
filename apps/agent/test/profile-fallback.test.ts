import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { openAIReply } from "./support/images";

type ProfileInput = { name: string; provider: "openai" | "anthropic" | "deepseek" | "custom"; model: string; fallbackModels?: string[]; baseUrl?: string; apiKey?: string };

async function profile(s: Scenario, input: ProfileInput) {
  const created = await s.admin("POST", `/api/admin/tenants/${s.tenant.id}/profiles`, { apiKey: "profile-key", ...input });
  expect(created.status).toBe(201);
  return created.body.profile as { id: string; model: string; fallbackModels: string[] };
}

/** Real router from here on: model calls reach the stubbed providers. */
async function answerWith(s: Scenario, profileId: string) {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  await repositories().bots.update(s.bot.id, { profileId });
  s.model.live();
}

const down = () => Response.json({ error: { message: "upstream exploded" } }, { status: 500 });
const modelsAsked = (s: Scenario, host: string) => s.http.requests.filter((r) => r.method === "POST" && r.url.includes(host)).map((r) => r.body.model);

async function usageRows(s: Scenario) {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  return (await repositories().usage.list()).filter((r: any) => r.tenantId === s.tenant.id);
}

discordScenario("a Profile whose first model fails after its retries is answered by its next model, and the usage and audit rows name both", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const main = await profile(s, { name: "Main", provider: "openai", model: "gpt-main", fallbackModels: ["gpt-backup"] });
  await answerWith(s, main.id);
  s.http.on("POST api.openai.com/v1/chat/completions", (req) => req.body.model === "gpt-main" ? down() : openAIReply("The deploy is at 14:00."));

  await s.discord.send(`${s.discord.mention} when is the deploy?`);

  expect(s.discord.botMessages.at(-1)?.content).toBe("The deploy is at 14:00.");
  expect(modelsAsked(s, "api.openai.com")).toEqual(["gpt-main", "gpt-main", "gpt-main", "gpt-main", "gpt-backup"]);
  expect(s.http.requests.filter((r) => r.url.includes("api.openai.com")).every((r) => r.headers.authorization === "Bearer profile-key")).toBe(true);
  const rows = await usageRows(s);
  expect(rows.filter((r: any) => r.type === "llm_tokens").map((r: any) => [r.provider, r.model, r.metadata.profileId])).toEqual([["openai", "gpt-backup", main.id]]);
  expect(rows.filter((r: any) => r.type === "model_fallback").map((r: any) => [r.metadata.profileId, r.metadata.from, r.metadata.to, r.metadata.models])).toEqual([[main.id, "gpt-main", "gpt-backup", 2]]);
});

discordScenario("the models are asked in the Profile's order, and when every one fails the bot says the provider could not be reached", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const main = await profile(s, { name: "Own", provider: "custom", baseUrl: "https://llm.test/v1", model: "c", fallbackModels: ["a", "b"] });
  await answerWith(s, main.id);
  s.http.on("POST llm.test/v1/chat/completions", (req) => req.body.model === "b" ? openAIReply("B answered.") : down());

  await s.discord.send(`${s.discord.mention} status?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("B answered.");
  expect(modelsAsked(s, "llm.test")).toEqual(["c", "c", "c", "c", "a", "a", "a", "a", "b"]);

  s.http.on("POST llm.test/v1/chat/completions", down);
  await s.discord.send(`${s.discord.mention} and now?`);
  expect(modelsAsked(s, "llm.test").slice(9)).toEqual(["c", "c", "c", "c", "a", "a", "a", "a", "b", "b", "b", "b"]);
  expect(s.discord.botMessages.at(-1)?.content).toBe("I can't reach the AI service right now. Try again in a moment.");
});

discordScenario("a model that refuses tool_choice on the budget's last call answers that call without tools, before the next model is asked", async (s) => {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  await repositories().agentConfig.update(s.tenant.id, { settings: { maxReActIterations: 1 } });
  await s.guildSettings({ useThreads: false, language: "en" });
  const main = await profile(s, { name: "Main", provider: "openai", model: "gpt-main", fallbackModels: ["gpt-backup"] });
  await answerWith(s, main.id);
  s.http.on("POST api.openai.com/v1/chat/completions", (req) => {
    if (req.body.model === "gpt-backup") return openAIReply("The backup answered.");
    if (req.body.tool_choice) return Response.json({ error: { message: "tool_choice is not supported" } }, { status: 400 });
    if (req.body.tools) return { choices: [{ message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "listTasks", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    return openAIReply("Listed the tasks; nothing is open.");
  });

  await s.discord.send(`${s.discord.mention} what is open?`);

  expect(s.discord.botMessages.at(-1)?.content).toBe("Listed the tasks; nothing is open.");
  expect(modelsAsked(s, "api.openai.com")).not.toContain("gpt-backup");
  const last = s.http.requests.filter((r) => r.url.includes("api.openai.com")).at(-1)!;
  expect(last.body.tools).toBeUndefined();
  expect(last.body.tool_choice).toBeUndefined();
});

discordScenario("the admin API keeps fallback models trimmed and in order, and refuses a repeated model, more than three in all, or a list that is not names", async (s) => {
  const created = await profile(s, { name: "A", provider: "openai", model: " gpt-a ", fallbackModels: [" gpt-c", "gpt-b "] });
  expect([created.model, created.fallbackModels]).toEqual(["gpt-a", ["gpt-c", "gpt-b"]]);
  expect((await s.admin("GET", `/api/admin/tenants/${s.tenant.id}/profiles`)).body.profiles[0].fallbackModels).toEqual(["gpt-c", "gpt-b"]);
  expect((await s.admin("POST", `/api/admin/tenants/${s.tenant.id}/profiles`, { name: "B", provider: "openai", model: "m" })).body.profile.fallbackModels).toEqual([]);

  const patch = (body: unknown) => s.admin("PATCH", `/api/admin/profiles/${created.id}`, body);
  const refused = async (body: unknown) => { const res = await patch(body); return [res.status, res.body.error]; };
  expect(await refused({ fallbackModels: ["gpt-b", "gpt-b"] })).toEqual([400, "Each model may appear once"]);
  expect(await refused({ fallbackModels: ["gpt-a"] })).toEqual([400, "Each model may appear once"]);
  expect(await refused({ model: "gpt-c" })).toEqual([400, "Each model may appear once"]);
  expect(await refused({ fallbackModels: ["x", "y", "z"] })).toEqual([400, "A profile holds at most 3 models"]);
  for (const bad of ["gpt-b", [7], [""], ["  "], null]) expect(await refused({ fallbackModels: bad })).toEqual([400, "fallbackModels must be a list of model names"]);
  expect((await s.admin("GET", `/api/admin/tenants/${s.tenant.id}/profiles`)).body.profiles.find((p: any) => p.id === created.id).fallbackModels).toEqual(["gpt-c", "gpt-b"]);

  const reordered = await patch({ model: "gpt-b", fallbackModels: ["gpt-a", "gpt-c"] });
  expect([reordered.status, reordered.body.profile.model, reordered.body.profile.fallbackModels]).toEqual([200, "gpt-b", ["gpt-a", "gpt-c"]]);
  const cleared = await patch({ fallbackModels: [] });
  expect([cleared.status, cleared.body.profile.fallbackModels]).toEqual([200, []]);
});
