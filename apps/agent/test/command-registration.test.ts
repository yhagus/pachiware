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

discordScenario("the global command list is cleared once and not sent again on later registrations", async (s) => {
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "minutes", value: "off" });
  await s.discord.joinGuild("guild-2");
  expect(s.discord.commandOverwrites.filter((o) => o.guildId === null)).toEqual([{ guildId: null, commands: [] }]);
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

discordScenario("joining a guild registers its commands there", async (s) => {
  expect(s.discord.commandsIn("guild-2")).toBeNull();
  await s.discord.joinGuild("guild-2");
  expect(menus(s.discord.commandsIn("guild-2"))).toEqual(["Draft issues", "Write minutes"]);
});

discordScenario("up to fifteen menu commands are registered in a guild", async (s) => {
  for (let n = 1; n <= 16; n++) {
    const name = `retro-${String(n).padStart(2, "0")}`;
    await s.workspace.write(`shared/playbooks/${name}/PLAYBOOK.md`, `---\nname: ${name}\ndescription: Retro ${n}\ntrigger: {"menu": "Retro ${n}"}\nrequires: workspace\n---\nCollect the points.\n`);
  }
  await s.restart();
  // Playbooks come in name order: issue-draft and minutes, then the retros.
  expect(s.discord.registeredCommands.map((c) => c.name)).toEqual(["Draft issues", "Write minutes", ...Array.from({ length: 13 }, (_, i) => `Retro ${i + 1}`)]);
});
