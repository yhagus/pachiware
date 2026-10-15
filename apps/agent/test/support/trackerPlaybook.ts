import type { Scenario } from "./discordScenario";

/** A tenant playbook that declares `repository: required`, started by "@bot track: ..." or the "Track work" menu. */
export async function addTracker(s: Scenario) {
  await s.workspace.write("shared/playbooks/tracker/PLAYBOOK.md", `---\ndescription: Tracks work as issues\ntrigger: {"menu": "Track work", "word": "track"}\nrequires: ["workspace"]\nrepository: "required"\n---\nKeep the work as issues in the thread's repository.\n`);
}

/** A git account whose guild rule is "acme/*" over three repositories, narrowed in channel-1 to `channelRepos` when given. */
export async function acmeRepos(s: Scenario, channelRepos?: string[]) {
  const account = await s.git({ repos: ["acme/*"] });
  s.http.on("GET api.github.com/user/repos", () => [{ full_name: "acme/api" }, { full_name: "acme/web" }, { full_name: "acme/infra" }]);
  if (channelRepos) {
    const { repositories } = await import(process.cwd() + "/packages/db/src/index.ts");
    await repositories().git.replaceScopes(s.tenant.id, s.bot.id, s.discord.guildId, "channel-1", [{ gitAccountId: account.id, repoPatterns: channelRepos }]);
  }
  return account;
}
