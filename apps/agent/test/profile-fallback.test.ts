import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { anthropicReply, image, openAIReply } from "./support/images";

type ProfileInput = { name: string; provider: "openai" | "anthropic" | "custom"; model: string; baseUrl?: string; apiKey?: string; acceptsImages?: boolean; fallbackProfileId?: string };

async function profile(s: Scenario, input: ProfileInput) {
  const created = await s.admin("POST", `/api/admin/tenants/${s.tenant.id}/profiles`, { apiKey: "profile-key", ...input });
  expect(created.status).toBe(201);
  return created.body.profile as { id: string; fallbackProfileId: string | null };
}

/** Real router from here on: model calls reach the stubbed providers. */
async function answerWith(s: Scenario, profileId: string) {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  await repositories().bots.update(s.bot.id, { profileId });
  s.model.live();
}

const down = () => Response.json({ error: { message: "upstream exploded" } }, { status: 500 });
const hits = (s: Scenario, host: string) => s.http.requests.filter((r) => r.method === "POST" && r.url.includes(host)).length;

async function usageRows(s: Scenario) {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  return (await repositories().usage.list()).filter((r: any) => r.tenantId === s.tenant.id);
}

discordScenario("a Profile whose provider fails after its retries is answered by its fallback, and the usage row names the fallback", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const backup = await profile(s, { name: "Backup", provider: "anthropic", model: "claude-haiku-5-5" });
  const main = await profile(s, { name: "Main", provider: "openai", model: "gpt-main", fallbackProfileId: backup.id });
  await answerWith(s, main.id);
  s.http.on("POST api.openai.com/v1/chat/completions", down);
  s.http.on("POST api.anthropic.com/v1/messages", () => anthropicReply("The deploy is at 14:00."));

  await s.discord.send(`${s.discord.mention} when is the deploy?`);

  expect(s.discord.botMessages.at(-1)?.content).toBe("The deploy is at 14:00.");
  expect(hits(s, "api.openai.com")).toBe(4);
  expect(hits(s, "api.anthropic.com")).toBe(1);
  const rows = await usageRows(s);
  const tokens = rows.filter((r: any) => r.type === "llm_tokens");
  expect(tokens.map((r: any) => [r.provider, r.model, r.metadata.profileId])).toEqual([["anthropic", "claude-haiku-5-5", backup.id]]);
  const fell = rows.filter((r: any) => r.type === "profile_fallback");
  expect(fell.map((r: any) => [r.metadata.from, r.metadata.to])).toEqual([[main.id, backup.id]]);
});

discordScenario("with A→B→C and A and B failing (A has no key), C answers; a fourth Profile in the chain is never tried", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const d = await profile(s, { name: "D", provider: "custom", model: "d", baseUrl: "https://d.llm.test/v1" });
  const c = await profile(s, { name: "C", provider: "custom", model: "c", baseUrl: "https://c.llm.test/v1", fallbackProfileId: d.id });
  const b = await profile(s, { name: "B", provider: "anthropic", model: "claude-b", fallbackProfileId: c.id });
  const a = await profile(s, { name: "A", provider: "openai", model: "gpt-a", apiKey: "", fallbackProfileId: b.id });
  await answerWith(s, a.id);
  s.http.on("POST api.anthropic.com/v1/messages", down);
  s.http.on("POST c.llm.test/v1/chat/completions", () => openAIReply("C answered."));
  s.http.on("POST d.llm.test/v1/chat/completions", () => openAIReply("D answered."));

  await s.discord.send(`${s.discord.mention} status?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("C answered.");
  expect([hits(s, "api.openai.com"), hits(s, "api.anthropic.com"), hits(s, "c.llm.test"), hits(s, "d.llm.test")]).toEqual([0, 4, 1, 0]);

  s.http.on("POST c.llm.test/v1/chat/completions", down);
  await s.discord.send(`${s.discord.mention} and now?`);
  expect(hits(s, "d.llm.test")).toBe(0);
  expect(s.discord.botMessages.at(-1)?.content).toBe("I couldn't reach the model provider just now. Try again in a moment.");
});

discordScenario("a fallback that does not accept images gets the request without them, and the reply carries the usual note", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const blind = await profile(s, { name: "Blind", provider: "anthropic", model: "claude-text", acceptsImages: false });
  const seeing = await profile(s, { name: "Seeing", provider: "openai", model: "gpt-vision", acceptsImages: true, fallbackProfileId: blind.id });
  await answerWith(s, seeing.id);
  const shot = await image(s, "screenshot.png", 300, 200);
  s.http.on("POST api.openai.com/v1/chat/completions", down);
  s.http.on("POST api.anthropic.com/v1/messages", () => anthropicReply("Check the auth service logs."));

  await s.discord.send(`${s.discord.mention} why does login fail?`, { attachments: [shot] });

  const toOpenAI = s.http.requests.find((r) => r.url.includes("api.openai.com"))!;
  expect(JSON.stringify(toOpenAI.body)).toContain("image_url");
  const toAnthropic = s.http.requests.find((r) => r.url.includes("api.anthropic.com"))!;
  expect(JSON.stringify(toAnthropic.body)).not.toContain("base64");
  expect(JSON.stringify(toAnthropic.body)).toContain("why does login fail?");
  expect(s.discord.botMessages.at(-1)?.content).toBe("Check the auth service logs.\nThis profile rejected the image; an admin can turn image input off for it.");
});

discordScenario("a Profile that refuses tool_choice on the budget's last call answers that call without tools, before its fallback is tried", async (s) => {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  await repositories().agentConfig.update(s.tenant.id, { settings: { maxReActIterations: 1 } });
  await s.guildSettings({ useThreads: false, language: "en" });
  const backup = await profile(s, { name: "Backup", provider: "anthropic", model: "claude-haiku-5-5" });
  const main = await profile(s, { name: "Main", provider: "openai", model: "gpt-main", fallbackProfileId: backup.id });
  await answerWith(s, main.id);
  s.http.on("POST api.openai.com/v1/chat/completions", (req) => {
    if (req.body.tool_choice) return Response.json({ error: { message: "tool_choice is not supported" } }, { status: 400 });
    if (req.body.tools) return { choices: [{ message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "listTasks", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    return openAIReply("Listed the tasks; nothing is open.");
  });
  s.http.on("POST api.anthropic.com/v1/messages", () => anthropicReply("The backup answered."));

  await s.discord.send(`${s.discord.mention} what is open?`);

  expect(s.discord.botMessages.at(-1)?.content).toBe("Listed the tasks; nothing is open.");
  expect(hits(s, "api.anthropic.com")).toBe(0);
  const lastToOpenAI = s.http.requests.filter((r) => r.url.includes("api.openai.com")).at(-1)!;
  expect(lastToOpenAI.body.tools).toBeUndefined();
  expect(lastToOpenAI.body.tool_choice).toBeUndefined();
});

discordScenario("the admin API sets and clears a fallback, and refuses a cycle, the profile itself and another tenant's Profile", async (s) => {
  const a = await profile(s, { name: "A", provider: "openai", model: "a" });
  const b = await profile(s, { name: "B", provider: "openai", model: "b", fallbackProfileId: a.id });
  expect(b.fallbackProfileId).toBe(a.id);

  const cycle = await s.admin("PATCH", `/api/admin/profiles/${a.id}`, { fallbackProfileId: b.id });
  expect(cycle.status).toBe(400);
  expect(cycle.body.error).toBe("Fallback chain would loop");
  const self = await s.admin("PATCH", `/api/admin/profiles/${a.id}`, { fallbackProfileId: a.id });
  expect([self.status, self.body.error]).toEqual([400, "A profile cannot fall back to itself"]);

  const { repositories } = await import("../../../packages/db/src/index.ts");
  const other = await repositories().tenants.create({ name: "Other", slug: "other" });
  const foreign = await s.admin("POST", `/api/admin/tenants/${other.id}/profiles`, { name: "F", provider: "openai", model: "f" });
  const crossed = await s.admin("PATCH", `/api/admin/profiles/${a.id}`, { fallbackProfileId: foreign.body.profile.id });
  expect([crossed.status, crossed.body.error]).toEqual([400, "Fallback profile not found"]);
  expect((await s.admin("PATCH", `/api/admin/profiles/${b.id}`, { fallbackProfileId: 7 })).status).toBe(400);

  const cleared = await s.admin("PATCH", `/api/admin/profiles/${b.id}`, { fallbackProfileId: null });
  expect([cleared.status, cleared.body.profile.fallbackProfileId]).toEqual([200, null]);
});
