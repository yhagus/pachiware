import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("with one allowed repository every draft of the breakdown targets it, and no question asks which", async (s) => {
  const { briefFields, ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  await s.git({ repos: ["acme/api"] });
  s.model.script(
    { tool: "briefRepositories" },
    (turn) => {
      expect(turn.toolResults[0]).toMatchObject({ single: "acme/api", repositories: [{ repo: "acme/api" }] });
      return { tool: "postBriefRound", args: ROUND_1 };
    },
    "ok",
  );
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);

  const round = s.discord.botMessages.find((m) => m.channelId === brief.thread!.id)!.content;
  expect(round).toContain("**1. Stop the Safari login loop** · point 1 · acme/api");
  expect(round).toContain("**2. Stream CSV exports** · point 2 · acme/api · blocked by draft 1");
  const fields = await briefFields(s, `guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md`);
  expect(fields.drafts.map((d: any) => d.repo)).toEqual(["acme/api", "acme/api"]);
});
