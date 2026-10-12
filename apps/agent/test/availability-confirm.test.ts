import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("Confirm is refused when the queued git tool was turned off for the channel since it was asked for", async (s) => {
  await s.git({ repos: ["acme/*"] });
  s.http.on("POST api.github.com/repos/acme/api/issues/3/comments", () => ({ html_url: "https://github.com/acme/api/issues/3#c1" }));
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Fixed in main" } }, "Queued the comment for your confirmation.");
  await s.discord.send(`${s.discord.mention} comment "Fixed in main" on acme/api#3`);
  const confirmation = s.discord.botMessages.at(-1)!;

  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "repoComment", value: "off" });
  const click = await s.discord.click(confirmation, "Confirm");
  expect(click.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true, content: expect.stringContaining("turned off") } }]);
  expect(s.http.requests).toEqual([]);
});

discordScenario("the refusal is in Indonesian when the queued change reads so", async (s) => {
  await s.git({ repos: ["acme/*"] });
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Sudah diperbaiki di main, tolong dicek lagi" } }, "Komentarnya menunggu konfirmasi.");
  await s.discord.send(`${s.discord.mention} tolong komentari acme/api#3 bahwa sudah diperbaiki`);
  const confirmation = s.discord.botMessages.at(-1)!;

  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "repoComment", value: "off" });
  const click = await s.discord.click(confirmation, "Confirm");
  expect(click.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true, content: expect.stringContaining("dimatikan") } }]);
});

discordScenario("confirming git changes for the thread is refused too when the queued tool was turned off since", async (s) => {
  process.env.GIT_OWNER_DISCORD_IDS = s.discord.alice.id;
  await s.git({ repos: ["acme/*"] });
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Fixed in main" } }, "Queued the comment for your confirmation.");
  await s.discord.send(`${s.discord.mention} comment "Fixed in main" on acme/api#3`);
  const confirmation = s.discord.botMessages.at(-1)!;

  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "repoComment", value: "off" });
  const click = await s.discord.click(confirmation, "Confirm Git changes in this thread");
  expect(click.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true, content: expect.stringContaining("turned off") } }]);
  expect(s.http.requests).toEqual([]);
});

discordScenario("Confirm on a git tool available here but no longer in the git scope is still refused by git scope", async (s) => {
  const account = await s.git({ repos: ["acme/*"] });
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Fixed in main" } }, "Queued the comment for your confirmation.");
  await s.discord.send(`${s.discord.mention} comment "Fixed in main" on acme/api#3`);
  const confirmation = s.discord.botMessages.at(-1)!;

  const { replaceGitScopes } = await import("../../../packages/db/src/tenancy.ts");
  await replaceGitScopes(s.tenant.id, s.bot.id, s.discord.guildId, "", [{ gitAccountId: account.id, repoPatterns: ["other/*"] }]);
  await s.discord.click(confirmation, "Confirm");
  expect(s.http.requests).toEqual([]);
  expect(confirmation.content).toContain("I couldn't complete that");
  expect(confirmation.content).toContain("Repository acme/api is not enabled");
});

discordScenario("a danger git tool still needs an owner to ask and a Confirm click before it reaches the provider", async (s) => {
  process.env.GIT_OWNER_DISCORD_IDS = s.discord.alice.id;
  await s.git({ repos: ["acme/*"] });
  s.http.on("DELETE api.github.com/repos/acme/api", () => ({}));
  s.model.script({ tool: "repoDelete", args: { repo: "acme/api" } }, (turn) => `result: ${JSON.stringify(turn.toolResults[0])}`,
    { tool: "repoDelete", args: { repo: "acme/api" } }, "Queued the deletion for your confirmation.");
  await s.discord.send(`${s.discord.mention} delete acme/api`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)?.content).toMatch(/limited to the bot's owners/);

  await s.discord.send(`${s.discord.mention} delete acme/api`);
  const confirmation = s.discord.botMessages.at(-1)!;
  expect(confirmation.components).not.toEqual([]);
  expect(s.http.requests).toEqual([]);
  await s.discord.click(confirmation, "Confirm");
  expect(s.http.requests.map((r) => r.method + " " + new URL(r.url).pathname)).toEqual(["DELETE /repos/acme/api"]);
});
