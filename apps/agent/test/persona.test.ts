import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const systemPrompt = (messages: { role: string; content: any }[]) => String(messages.find((m) => m.role === "system")?.content);
const CHANNEL = "guilds/guild-1/channels/channel-1";

discordScenario("the first model call carries the administrative-assistant persona, before the fixed policy", async (s) => {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} hi`);
  const prompt = systemPrompt(s.model.calls[0]!);
  expect(prompt).toMatch(/administrative assistant/i);
  expect(prompt).toContain("status | due | assignee | id | title");
  expect(prompt).toMatch(/more than three tasks/i);
  for (const name of ["setTaskDueDate", "remember", "forget", "readChannelHistory", "saveAttachment", "createReminder"]) expect(prompt).toContain(name);
  for (const folder of ["tasks/", "notes/", "decisions/", "files/", "minutes/", "MEMORY.md"]) expect(prompt).toContain(folder);
  expect(prompt.indexOf("administrative assistant")).toBeLessThan(prompt.indexOf("### Policy"));
});

discordScenario("the persona describes project work in the glossary's terms and keeps \"owner\" for Reminders", async (s) => {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} hi`);
  const persona = systemPrompt(s.model.calls[0]!).split("### Policy")[0]!;
  for (const term of ["Project", "Assignee", "Personal task", "Progress note"]) expect(persona).toContain(term);
  for (const name of ["editTask", "addProgressNote", "showTask", "tickChecklistItem", "moveTask", "scope mine", "scope delegated", "query", "cancelled"]) expect(persona).toContain(name);
  const ownerLines = persona.split("\n").filter((line) => /\bowners?\b/i.test(line));
  expect(ownerLines.every((line) => line.includes("Reminder"))).toBe(true);
});

discordScenario("the persona keeps long text a person asks to keep with keepAsNote, and the bot's own writing with writeFile", async (s) => {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} hi`);
  const persona = systemPrompt(s.model.calls[0]!).split("### Policy")[0]!;
  const noteLine = persona.split("\n").find((line) => line.includes("Keep this as a note"));
  expect(noteLine).toContain("keepAsNote");
  expect(noteLine).toContain("writeFile");
  expect(noteLine).toContain("(message <id>)");
});

discordScenario("the persona answers questions about past meetings from kept material, in the glossary's terms, and never offers threads/ as a folder", async (s) => {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} hi`);
  const persona = systemPrompt(s.model.calls[0]!).split("### Policy")[0]!;
  for (const term of ["Minutes", "Decisions", "Notes", "Documents", "Public channel", "searchFiles", "notShownHere", "DM"]) expect(persona).toContain(term);
  const section = persona.slice(persona.indexOf("Asking about kept material"));
  expect(section).toMatch(/search before/i);
  expect(section).toMatch(/channel and (the )?date/i);
  expect(section).toContain("postedIn");
  expect(section).toMatch(/found nothing/i);
  expect(section).toMatch(/without naming/i);
  expect(persona).not.toContain("threads/");
});

discordScenario("a question about channels reaches the model when the Discord skill is off, instead of a regex refusal", async (s) => {
  const { tenantSkills, and, eq } = await import("../../../packages/db/src/index.ts");
  await s.db.update(tenantSkills).set({ isEnabled: false }).where(and(eq(tenantSkills.tenantId, s.tenant.id), eq(tenantSkills.skillId, "discord_management")));
  s.model.script("Channel ini untuk koordinasi rilis.");
  await s.discord.send(`${s.discord.mention} channel ini buat apa?`);
  expect(s.model.calls.length).toBe(1);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Channel ini untuk koordinasi rilis.");
});

discordScenario("writeFile refuses a stray top-level folder under the channel, naming the allowed set, and accepts notes/", async (s) => {
  s.model.script(
    { tool: "writeFile", args: { path: "channel/random/x.md", content: "hi" } },
    (turn) => {
      expect(turn.toolResults[0].error).toMatch(/tasks, notes, decisions, files, minutes, MEMORY\.md/);
      return { tool: "writeFile", args: { path: "channel/notes/x.md", content: "hi" } };
    },
    (turn) => (turn.toolResults.at(-1).success ? "filed" : `not filed: ${turn.toolResults.at(-1).error}`),
  );
  await s.discord.send(`${s.discord.mention} keep this: hi`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("filed");
  expect(await s.workspace.read(`${CHANNEL}/notes/x.md`)).toBe("hi");
  expect(await s.workspace.read(`${CHANNEL}/random/x.md`)).toBeNull();
});

discordScenario("MEMORY.md and a deeper subfolder under an allowed folder are fine; a stray top-level file is not", async (s) => {
  s.model.script(
    [{ tool: "writeFile", args: { path: "channel/MEMORY.md", content: "- kept" } }, { tool: "writeFile", args: { path: "channel/notes/2026/plan.md", content: "deep" } }, { tool: "writeFile", args: { path: "channel/todo.md", content: "stray" } }],
    (turn) => turn.toolResults.map((r: any) => (r.success ? "ok" : "refused")).join(","),
  );
  await s.discord.send(`${s.discord.mention} file these`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("ok,ok,refused");
  expect(await s.workspace.read(`${CHANNEL}/notes/2026/plan.md`)).toBe("deep");
  expect(await s.workspace.read(`${CHANNEL}/todo.md`)).toBeNull();
});
