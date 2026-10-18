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

// Administration starts off (#251): settings, members, secrets, runners, webhooks, transfer and delete are offered only after a tenant switches them on.
discordScenario("where a Git scope and a Plane scope apply, administration tools are not offered until the tenant switches one on, and a level below can still turn it off", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.git({ provider: "github", repos: ["acme/*"] });
  await s.plane({ projects: ["*"] });
  const ADMIN = ["repoSecrets", "repoRunners", "repoDeployKeys", "repoTransfer", "repoDelete", "repoWebhooks", "repoAddMember", "orgCreateGroup", "projectCreate", "projectDelete", "stateCreate", "workspaceInvite"];
  const EVERYDAY = ["repoList", "repoSearchWork", "repoIssues", "repoCreateIssue", "repoComment", "repoMergeRequests", "repoChecks", "workItemList", "workItemCreate", "cycleList"];

  s.model.script("ok", "ok", "ok");
  await s.discord.send(`${s.discord.mention} hello`);
  for (const name of ADMIN) expect(s.model.tools[0]).not.toContain(name);
  for (const name of EVERYDAY) expect(s.model.tools[0]).toContain(name);

  await s.availability({ level: "tenant" }, { kind: "tool", name: "repoDelete", value: "on" });
  await s.discord.send(`${s.discord.mention} hello again`);
  expect(s.model.tools[1]).toContain("repoDelete");
  expect(s.model.tools[1]).not.toContain("repoTransfer");

  await s.availability({ level: "guild" }, { kind: "tool", name: "repoDelete", value: "off" });
  await s.discord.send(`${s.discord.mention} and now?`);
  expect(s.model.tools[2]).not.toContain("repoDelete");
});

discordScenario("a call to an administration tool the tenant has not switched on is refused even when the model names it", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.model.script({ tool: "repoDelete", args: { repo: "acme/api" } }, (turn) => `refused: ${turn.toolResults[0].error}`);
  await s.discord.send(`${s.discord.mention} delete acme/api`);
  expect(s.discord.botMessages.at(-1)!.content).toMatch(/^refused: /);
  expect(s.http.requests.filter((r) => r.method === "DELETE")).toEqual([]);
});
