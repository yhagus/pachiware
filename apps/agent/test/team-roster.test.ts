import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

// The Team roster: who has which role, owns what, and works in which time zone, set from chat and found by recall (#249).

discordScenario("setTeamMember keeps a member's line with who set it, changes only the fields given, and teamRoster finds it by what they own", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  s.clock.set("2026-10-19T03:00:00Z");
  s.model.script({ tool: "setTeamMember", args: { person: "<@user-bob>", role: "backend lead", owns: ["API", "database"], timezone: "Asia/Jakarta" } }, (turn) => turn.toolResults[0].line);
  await s.discord.send(`${s.discord.mention} catat ya, Bob pegang backend: API dan database`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Bob (<@user-bob>) · backend lead · owns API, database · Asia/Jakarta · set by Alice 2026-10-19");

  s.model.script({ tool: "setTeamMember", args: { person: "Bob", role: "tech lead" } }, (turn) => turn.toolResults[0].line);
  await s.discord.send(`${s.discord.mention} Bob is tech lead now`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)!.content).toBe("Bob (<@user-bob>) · tech lead · owns API, database · Asia/Jakarta · set by Bob 2026-10-19");

  s.model.script({ tool: "setTeamMember", args: { person: "Dewi", role: "designer", owns: ["mobile UI"] } }, "ok");
  await s.discord.send(`${s.discord.mention} Dewi is our designer, she owns the mobile UI`);
  let found: any;
  s.model.script({ tool: "teamRoster", args: { queries: ["database", "basis data"] } }, (turn) => { found = turn.toolResults[0]; return "ok"; });
  await s.discord.send(`${s.discord.mention} who owns the database?`);
  expect(found.lines).toEqual(["Bob (<@user-bob>) · tech lead · owns API, database · Asia/Jakarta · set by Bob 2026-10-19"]);
  expect(await s.workspace.read("guilds/guild-1/shared/team.md")).toContain("- Dewi · designer · owns mobile UI · set by Alice 2026-10-19");
});

discordScenario("recall cites a Team roster line as an R ref, and the reply renders it as the roster's label", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  s.model.script({ tool: "setTeamMember", args: { person: "<@user-bob>", owns: ["audio normalization"] } }, "ok");
  await s.discord.send(`${s.discord.mention} Bob owns audio normalization`);
  let result: any;
  s.model.script({ tool: "recall", args: { queries: ["audio normalization", "normalisasi audio"] } }, (turn) => { result = turn.toolResults[0]; return `Bob owns it [${turn.toolResults[0].team[0].ref}].`; });
  await s.discord.send(`${s.discord.mention} who handles audio normalization?`);
  expect(result.team).toEqual([{ ref: "R1", label: "Team roster · Bob", line: expect.stringContaining("owns audio normalization") }]);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Bob owns it Team roster · Bob.");
});

discordScenario("a time zone that is not one is refused, removing takes a person off, and in a DM there is no roster", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  s.model.script({ tool: "setTeamMember", args: { person: "Bob", timezone: "Jakarta time" } }, (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} Bob is on Jakarta time`);
  expect(s.discord.botMessages.at(-1)!.content).toBe('"Jakarta time" is not a time zone: use a name such as Asia/Jakarta');

  s.model.script({ tool: "setTeamMember", args: { person: "Bob", role: "QA" } }, "ok", { tool: "setTeamMember", args: { person: "Bob", remove: true } }, (turn) => turn.toolResults[0].removed);
  await s.discord.send(`${s.discord.mention} Bob does QA`);
  await s.discord.send(`${s.discord.mention} Bob left the team`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Bob");

  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "teamRoster", args: {} }, (turn) => turn.toolResults[0].error);
  await s.discord.send("who is on the team?", { channel: dm });
  // A DM speaks the tenant's language.
  expect(s.discord.botMessages.at(-1)!.content).toBe("Daftar tim milik sebuah server: tanyakan di salah satu channel-nya.");
});
