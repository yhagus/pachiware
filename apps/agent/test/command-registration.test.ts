import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const menus = (commands: any[] | null) => (commands ?? []).filter((c) => c.type === 3).map((c) => c.name).sort();

discordScenario("a menu playbook off for one guild is not registered there but is in another guild of the same bot", async (s) => {
  await s.discord.joinGuild("guild-2");
  await s.availability({ level: "guild", guildId: "guild-2" }, { kind: "playbook", name: "minutes", value: "off" });

  expect(menus(s.discord.commandsIn("guild-1"))).toEqual(["Draft issues", "Write minutes"]);
  expect(menus(s.discord.commandsIn("guild-2"))).toEqual(["Draft issues"]);
});

discordScenario("a playbook off at the tenant or the bot is registered in no guild of the bot", async (s) => {
  await s.discord.joinGuild("guild-2");
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "minutes", value: "off" });
  expect(menus(s.discord.commandsIn("guild-1"))).toEqual(["Draft issues"]);
  expect(menus(s.discord.commandsIn("guild-2"))).toEqual(["Draft issues"]);

  await s.availability({ level: "bot" }, { kind: "playbook", name: "issue-draft", value: "off" });
  expect(menus(s.discord.commandsIn("guild-1"))).toEqual([]);
  expect(menus(s.discord.commandsIn("guild-2"))).toEqual([]);
});

discordScenario("a playbook that is opt-in for a guild's channels is still registered in that guild", async (s) => {
  await s.availability({ level: "bot" }, { kind: "playbook", name: "minutes", value: "opt_in" });
  await s.availability({ level: "guild" }, { kind: "playbook", name: "issue-draft", value: "opt_in" });
  expect(menus(s.discord.commandsIn("guild-1"))).toEqual(["Draft issues", "Write minutes"]);
});

discordScenario("the global command list is cleared once and not sent again on later registrations or after a restart", async (s) => {
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "minutes", value: "off" });
  await s.discord.joinGuild("guild-2");
  await s.restart();
  expect(s.discord.commandOverwrites.filter((o) => o.guildId === null)).toEqual([{ guildId: null, commands: [] }]);
});

discordScenario("a guild the bot is in but not set up for gets one empty overwrite and no commands", async (s) => {
  await s.discord.joinGuild("guild-3", "Elsewhere", { setUp: false });
  expect(s.discord.commandsIn("guild-3")).toEqual([]);

  await s.availability({ level: "tenant" }, { kind: "playbook", name: "minutes", value: "off" });
  expect(s.discord.commandOverwrites.filter((o) => o.guildId === "guild-3")).toEqual([{ guildId: "guild-3", commands: [] }]);
  expect(menus(s.discord.commandsIn("guild-1"))).toEqual(["Draft issues"]);
});

discordScenario("a guild that refuses the overwrite is reported on the bot and retried on the next registration", async (s) => {
  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const app = createServer();
  const lastError = async () => (await (await app.request(`/api/admin/bots/${s.bot.id}`, { headers: { "X-Platform-Key": "scenario" } })).json()).bot.lastError;
  s.discord.refuseCommands("guild-2");
  await s.discord.joinGuild("guild-2");
  expect(s.discord.commandsIn("guild-2")).toBeNull();
  expect(await lastError()).toContain("guild-2");

  s.discord.refuseCommands("guild-2", false);
  await s.availability({ level: "guild", guildId: "guild-1" }, { kind: "playbook", name: "minutes", value: "off" });
  expect(menus(s.discord.commandsIn("guild-2"))).toEqual(["Draft issues", "Write minutes"]);
});

discordScenario("slash commands stop at Discord's 100 per guild in name order, and the rest report the limit", async (s) => {
  for (let n = 1; n <= 99; n++) {
    const name = `a-${String(n).padStart(3, "0")}`;
    await s.workspace.write(`shared/playbooks/${name}/PLAYBOOK.md`, `---\nname: ${name}\ndescription: Playbook ${n}\n---\nDo it.\n`);
  }
  await s.restart();
  const slashes = s.discord.registeredCommands.filter((c) => c.type === 1).map((c) => c.name);
  expect(slashes).toHaveLength(100);
  expect(slashes.at(-1)).toBe("issue-draft");
  expect(slashes).not.toContain("minutes");

  const { createServer } = await import(process.cwd() + "/apps/agent/src/server.ts");
  const view = await (await createServer().request(`/api/admin/bots/${s.bot.id}/guilds/guild-1/availability`, { headers: { "X-Platform-Key": "scenario" } })).json();
  expect(view.slash.find((p: any) => p.playbook === "minutes")).toEqual({ playbook: "minutes", status: "not_registered", reason: "limit" });
});

discordScenario("a guild-level change re-registers only that guild, and an unchanged guild gets no second overwrite", async (s) => {
  await s.discord.joinGuild("guild-2");
  const sentTo = () => s.discord.commandOverwrites.filter((o) => o.guildId).map((o) => o.guildId);
  expect(sentTo()).toEqual(["guild-1", "guild-2"]);

  await s.availability({ level: "guild", guildId: "guild-2" }, { kind: "playbook", name: "minutes", value: "off" });
  expect(sentTo()).toEqual(["guild-1", "guild-2", "guild-2"]);

  // A channel rule changes no guild's list.
  await s.availability({ level: "channel", guildId: "guild-1", channelId: "channel-1" }, { kind: "playbook", name: "issue-draft", value: "off" });
  await s.availability({ level: "guild", guildId: "guild-2" }, { kind: "playbook", name: "minutes", value: "off" });
  expect(sentTo()).toEqual(["guild-1", "guild-2", "guild-2"]);
});

discordScenario("up to fifteen menu commands are registered in a guild", async (s) => {
  for (let n = 1; n <= 16; n++) {
    const name = `retro-${String(n).padStart(2, "0")}`;
    await s.workspace.write(`shared/playbooks/${name}/PLAYBOOK.md`, `---\nname: ${name}\ndescription: Retro ${n}\ntrigger: {"menu": "Retro ${n}"}\nrequires: workspace\n---\nCollect the points.\n`);
  }
  await s.restart();
  // Playbooks come in name order: issue-draft and minutes, then the retros.
  expect(s.discord.registeredCommands.filter((c) => c.type === 3).map((c) => c.name)).toEqual(["Draft issues", "Write minutes", ...Array.from({ length: 13 }, (_, i) => `Retro ${i + 1}`)]);
});

const RETRO = `---\nname: retro\ndescription: Group the points\ntrigger: {"menu": "Run retro"}\ndefault: off\n---\nGroup the points.\n`;

discordScenario("a default-off playbook is registered in no guild until the tenant turns it on", async (s) => {
  await s.workspace.write("shared/playbooks/retro/PLAYBOOK.md", RETRO);
  await s.restart();
  await s.discord.joinGuild("guild-2");
  expect(menus(s.discord.commandsIn("guild-1"))).toEqual(["Draft issues", "Write minutes"]);
  expect(menus(s.discord.commandsIn("guild-2"))).toEqual(["Draft issues", "Write minutes"]);

  await s.availability({ level: "tenant" }, { kind: "playbook", name: "retro", value: "on" });
  expect(menus(s.discord.commandsIn("guild-1"))).toEqual(["Draft issues", "Run retro", "Write minutes"]);
  expect(menus(s.discord.commandsIn("guild-2"))).toEqual(["Draft issues", "Run retro", "Write minutes"]);
});
