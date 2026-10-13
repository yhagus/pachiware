import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("a tool off in one channel is not offered there but is offered in another channel of the same guild", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "tool", name: "createTask", value: "off" });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} add a task`, { channel: "channel-2" });
  await s.discord.send(`${s.discord.mention} add a task`, { channel: "channel-1" });
  expect(s.model.tools[0]).not.toContain("createTask");
  expect(s.model.tools[0]).toContain("listTasks");
  expect(s.model.tools[1]).toContain("createTask");
});

discordScenario("a skill off for a bot removes all its tools for that bot only", async (s) => {
  const { createBot } = await import("../../../packages/db/src/tenancy.ts");
  const other = await createBot({ tenantId: s.tenant.id, token: "other-token", guildIds: [s.discord.guildId] });
  await s.availability({ level: "bot", botId: other.id }, { kind: "skill", name: "task_management", value: "off" });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} list my tasks`);
  expect(s.model.tools[0]).toEqual(expect.arrayContaining(["createTask", "listTasks", "updateTaskStatus", "assignTask"]));

  await s.availability({ level: "bot" }, { kind: "skill", name: "task_management", value: "off" });
  await s.discord.send(`${s.discord.mention} list my tasks`);
  expect(s.model.tools[1].filter((t) => /Task/.test(t))).toEqual([]);
  expect(s.model.tools[1]).toContain("listChannels");
});

discordScenario("a thread follows its parent channel's rules", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "createTask", value: "off" });
  s.model.script("Which task?", "ok");
  const ask = await s.discord.send(`${s.discord.mention} add a task`);
  await s.discord.send("the login bug", { channel: ask.thread });
  expect(s.model.tools[1]).not.toContain("createTask");
  expect(s.model.tools[1]).toContain("listTasks");
});

discordScenario("a tenant with no rules is offered exactly the tools it was offered before", async (s) => {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} hi`);
  expect(s.model.tools[0]).toEqual(["archiveChannel", "assignTask", "createChannel", "createTask", "deleteFile", "describeBriefImages", "listChannels", "listFiles", "listTasks", "moveFile", "postBriefRound", "readFile", "readPlaybookFile", "recordBriefAnswers", "searchFiles", "sendMessage", "setChannelTopic", "updateTaskStatus", "writeFile", "writeIssueDraft"]);
});

discordScenario("execution refuses a tool that is off here even when the model calls it", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "createTask", value: "off" });
  s.model.script({ tool: "createTask", args: { title: "Fix login" } }, (turn) => `result: ${JSON.stringify(turn.toolResults[0])}`);
  await s.discord.send(`${s.discord.mention} add a task "Fix login"`);
  expect(s.discord.botMessages.at(-1)?.content).toMatch(/disabled or unavailable here/);
  const { tasks } = await import("../../../packages/db/src/index.ts");
  expect(await s.db.select().from(tasks)).toEqual([]);
});

discordScenario("danger off in a guild removes every danger tool in its channels and keeps read and write tools", async (s) => {
  await s.availability({ level: "guild" }, { kind: "effect", name: "danger", value: "off" });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} tidy up`, { channel: "channel-1" });
  await s.discord.send(`${s.discord.mention} tidy up`, { channel: "channel-2" });
  for (const offered of s.model.tools) {
    expect(offered).not.toContain("archiveChannel");
    expect(offered).not.toContain("deleteFile");
    expect(offered).toEqual(expect.arrayContaining(["listChannels", "readFile", "createTask", "writeFile", "setChannelTopic"]));
  }
});

discordScenario("a multi-action git tool tagged danger is gone when danger is off, and git reads and writes stay", async (s) => {
  await s.git({ repos: ["acme/*"] });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} list the repo secrets`);
  expect(s.model.tools[0]).toEqual(expect.arrayContaining(["repoSecrets", "repoDelete", "repoTransfer"]));

  await s.availability({ level: "guild" }, { kind: "effect", name: "danger", value: "off" });
  await s.discord.send(`${s.discord.mention} list the repo secrets`);
  expect(s.model.tools[1]).not.toContain("repoSecrets");
  expect(s.model.tools[1]).not.toContain("repoDelete");
  expect(s.model.tools[1]).not.toContain("repoTransfer");
  expect(s.model.tools[1]).toEqual(expect.arrayContaining(["repoList", "repoIssues", "repoCreateIssue", "repoWriteFile"]));
});

discordScenario("a guild opt-in hides a skill in every channel until a channel says on, and a new channel does not get it", async (s) => {
  await s.availability({ level: "guild" }, { kind: "skill", name: "task_management", value: "opt_in" });
  s.model.script("ok", "ok", "ok");
  await s.discord.send(`${s.discord.mention} list my tasks`, { channel: "channel-1" });
  expect(s.model.tools[0].filter((t) => /Task/.test(t))).toEqual([]);
  expect(s.model.tools[0]).toContain("listChannels");

  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "skill", name: "task_management", value: "on" });
  await s.discord.send(`${s.discord.mention} list my tasks`, { channel: "channel-1" });
  await s.discord.send(`${s.discord.mention} list my tasks`, { channel: "brand-new" });
  expect(s.model.tools[1]).toEqual(expect.arrayContaining(["createTask", "listTasks", "updateTaskStatus", "assignTask"]));
  expect(s.model.tools[2].filter((t) => /Task/.test(t))).toEqual([]);
});

discordScenario("a bot opt-in hides a tool in every guild until that guild says on", async (s) => {
  await s.availability({ level: "bot" }, { kind: "tool", name: "createTask", value: "opt_in" });
  await s.availability({ level: "guild", guildId: "guild-2" }, { kind: "tool", name: "createTask", value: "on" });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} add a task`);
  expect(s.model.tools[0]).not.toContain("createTask");
  expect(s.model.tools[0]).toContain("listTasks");

  await s.availability({ level: "guild" }, { kind: "tool", name: "createTask", value: "on" });
  await s.discord.send(`${s.discord.mention} add a task`);
  expect(s.model.tools[1]).toContain("createTask");
});

discordScenario("a level cannot opt in or turn on what a level above turned off", async (s) => {
  await s.availability({ level: "bot" }, { kind: "skill", name: "task_management", value: "off" });
  await expect(s.availability({ level: "guild" }, { kind: "skill", name: "task_management", value: "opt_in" })).rejects.toThrow(/off at the bot/);
  await s.availability({ level: "guild" }, { kind: "effect", name: "danger", value: "off" });
  await expect(s.availability({ level: "guild" }, { kind: "tool", name: "createTask", value: "opt_in" })).rejects.toThrow(/task_management is off at the bot/);
  await expect(s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "archiveChannel", value: "on" })).rejects.toThrow(/danger is off at the guild/);
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} list my tasks`);
  expect(s.model.tools[0].filter((t) => /Task/.test(t))).toEqual([]);
});

discordScenario("an off written above after an on below still wins", async (s) => {
  await s.availability({ level: "guild" }, { kind: "skill", name: "task_management", value: "opt_in" });
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "skill", name: "task_management", value: "on" });
  await s.availability({ level: "bot" }, { kind: "skill", name: "task_management", value: "off" });
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} list my tasks`);
  expect(s.model.tools[0].filter((t) => /Task/.test(t))).toEqual([]);
  expect(s.model.tools[0]).toContain("listChannels");
});

discordScenario("a tool opted in and turned on below stays off when its effect is off above", async (s) => {
  await s.availability({ level: "bot" }, { kind: "tool", name: "archiveChannel", value: "opt_in" });
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "archiveChannel", value: "on" });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} archive this channel`);
  expect(s.model.tools[0]).toContain("archiveChannel");

  await s.availability({ level: "guild" }, { kind: "effect", name: "danger", value: "off" });
  await s.discord.send(`${s.discord.mention} archive this channel`);
  expect(s.model.tools[1]).not.toContain("archiveChannel");
  expect(s.model.tools[1]).toContain("setChannelTopic");
});
