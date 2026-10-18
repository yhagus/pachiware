import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const text = (m: { content: unknown }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

discordScenario("a provider failure after a created task tells what was done, and the next turn never reads the failure as the bot's reply", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  s.model.script({ tool: "createTask", args: { title: "Book the venue" } }, { error: "I couldn't reach the model provider just now." });
  await s.discord.send(`${s.discord.mention} add a task to book the venue`);

  expect(s.discord.botMessages.at(-1)?.content).toBe('Done before the failure:\n- Created task "Book the venue"\n\nI couldn\'t reach the model provider just now.');
  expect((await s.workspace.list("guilds/guild-1/channels/channel-1/tasks")).filter((p) => p.endsWith(".md") && !p.endsWith("/README.md"))).toHaveLength(1);

  s.model.script("Yes, the venue task is there.");
  await s.discord.send(`${s.discord.mention} did it work?`);
  const request = s.model.calls.at(-1)!;
  expect(request.filter((m) => m.role === "assistant" && text(m).includes("couldn't reach"))).toEqual([]);
  // The stored call keeps its result, so no provider sees a tool call left unanswered.
  const call = request.findIndex((m) => m.role === "assistant" && m.toolCalls?.[0]?.name === "createTask");
  expect(call).toBeGreaterThan(-1);
  expect(request[call + 1]).toMatchObject({ role: "tool", toolCallId: request[call]!.toolCalls![0]!.id });
});

discordScenario("a provider failure with nothing done replies with the failure only and keeps it out of the history", async (s) => {
  await s.guildSettings({ useThreads: false, language: "id" });
  s.model.script({ tool: "listTasks", args: {} }, { error: "Penyedia modelnya tidak bisa saya hubungi saat ini." });
  await s.discord.send(`${s.discord.mention} tugas apa saja yang ada?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Penyedia modelnya tidak bisa saya hubungi saat ini.");

  s.model.script("Belum ada tugas.");
  await s.discord.send(`${s.discord.mention} coba lagi`);
  const request = s.model.calls.at(-1)!.map(text).join("\n");
  expect(request).toContain("tugas apa saja yang ada?");
  expect(request).not.toContain("Penyedia modelnya tidak bisa");
});

discordScenario("a provider failure on the call after the action budget runs out still tells what was done, in the place's language", async (s) => {
  const { repositories } = await import(process.cwd() + "/packages/db/src/index.ts");
  await repositories().agentConfig.update(s.tenant.id, { settings: { maxReActIterations: 3 } });
  await s.guildSettings({ useThreads: false, language: "id" });
  s.model.script({ tool: "createTask", args: { title: "Pesan gedung" } }, { tool: "listTasks", args: {} }, { tool: "listTasks", args: { status: "all" } }, { error: "Penyedia modelnya tidak bisa saya hubungi saat ini." });
  await s.discord.send(`${s.discord.mention} buat tugas pesan gedung lalu cek semuanya`);

  // The last call keeps the tools, so the cached prefix holds; tool_choice none forbids calling them (#219).
  expect(s.model.tools.at(-1)).toContain("listTasks");
  expect(s.model.tools.at(-1)).toEqual(s.model.tools[0]!);
  expect(s.discord.botMessages.at(-1)?.content).toBe('Sudah selesai sebelum gagal:\n- Membuat tugas "Pesan gedung"\n\nPenyedia modelnya tidak bisa saya hubungi saat ini.');
});
