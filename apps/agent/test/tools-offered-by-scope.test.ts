import { expect } from "bun:test";
import { skillRegistry } from "@pachiware/skills";
import { discordScenario } from "./support/discordScenario";

const toolsOf = (id: string) => skillRegistry.catalogue().find((s) => s.id === id)!.tools.map((t) => t.name);
const GIT = toolsOf("git_repositories"), PLANE = toolsOf("plane");

discordScenario("where no Git or Plane scope applies, of their tools only gitAccounts, writePlaybookDocument and planeAccounts are offered, and a hidden one called anyway is refused with why", async (s) => {
  const { repositories } = await import("@pachiware/db");
  await s.guildSettings({ useThreads: false });
  await s.git({ provider: "github", repos: ["acme/*"] });
  await repositories().git.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "", []);
  await s.plane({ projects: null });

  s.model.script({ tool: "repoList", args: {} }, (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} which repositories can you see?`);
  const offered = s.model.tools[0]!;
  expect(offered.filter((name) => GIT.includes(name))).toEqual(["gitAccounts", "writePlaybookDocument"]);
  expect(offered.filter((name) => PLANE.includes(name))).toEqual(["planeAccounts"]);
  expect(offered).toContain("createTask");
  expect(offered).toContain("recall");
  expect(s.discord.botMessages.at(-1)?.content).toBe("No git account is enabled for this channel. An admin can enable one in the console under the server's git access.");
  expect(s.http.requests).toEqual([]);
});

discordScenario("where a Git scope and a Plane scope apply, their tools are offered as before", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.git({ provider: "github", repos: ["acme/*"] });
  await s.plane({ projects: ["*"] });

  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} hello`);
  const offered = s.model.tools[0]!;
  for (const name of ["gitAccounts", "repoList", "repoSearchWork", "planeAccounts", "workItemList", "workItemCreate"]) expect(offered).toContain(name);
});

discordScenario("in a DM no git tool that needs an account is offered, since git works only in a server channel", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script("ok");
  await s.discord.send("hello", { channel: dm });
  expect(s.model.tools[0]!.filter((name) => GIT.includes(name))).toEqual(["gitAccounts", "writePlaybookDocument"]);
});
