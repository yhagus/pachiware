import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("with a text-only profile, round 1 asks the author to describe each screenshot, and the answer reaches the drafts", async (s) => {
  const { ROUND_1, briefFields, embedsIn, draft } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { image } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  const shot = await image(s, "login.png", 390, 844);
  s.model.script({ tool: "postBriefRound", args: ROUND_1 }, "ok");
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"), { attachments: [shot] });
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread!, record = `guilds/guild-1/channels/channel-1/threads/${thread.id}.md`;
  expect(s.model.calls[0]!.some((m) => Array.isArray(m.content))).toBe(false);

  const round = s.discord.botMessages.filter((m) => m.channelId === thread.id).map((m) => m.content).join("\n");
  expect(round).toContain(`❓ **Q1** What does [login.png](<${brief.url}>) show? I can't see images with this profile, so describe it in words for the drafts.`);
  expect(round).toContain("**Q2** Should Safari 16 be supported?");

  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true, answers: [{ q: 1, answer: "The sign-in form reloads empty after submitting." }] } }, { tool: "writeIssueDraft", args: draft(1) }, { tool: "writeIssueDraft", args: draft(2) }], "ok");
  await s.discord.send("yes, except Q1: The sign-in form reloads empty after submitting.", { channel: thread });
  const [first] = embedsIn(s, thread.id).map((m: any) => m.embeds[0].description as string);
  expect(first).toContain(`Screenshot [login.png](${brief.url}): The sign-in form reloads empty after submitting.`);
  expect(first).not.toContain("What does");
  const fields = await briefFields(s, record);
  expect(fields.images).toMatchObject([{ name: "login.png", link: brief.url, description: "The sign-in form reloads empty after submitting." }]);
});

discordScenario("a screenshot-only brief on a text-only profile still reaches round 1, which asks the author to describe it", async (s) => {
  const { image } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  const shot = await image(s, "checkout.png", 390, 844);
  s.model.script({ tool: "postBriefRound", args: { points: ["the checkout screen in the screenshot"], drafts: [{ point: 1, title: "Fix the checkout screen", summary: "What the screenshot shows works again." }], questions: [] } }, "ok");
  const brief = await s.discord.send("", { attachments: [shot] });
  await s.discord.contextMenu("Draft issues", brief);
  const round = s.discord.botMessages.filter((m) => m.channelId === brief.thread!.id).map((m) => m.content).join("\n");
  expect(round).toContain(`❓ **Q1** What does [checkout.png](<${brief.url}>) show?`);
  expect(round).not.toContain("Describe the image in words");
});

discordScenario("describeBriefImages refuses a screenshot the model was never shown", async (s) => {
  const { ROUND_1, briefFields } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { image } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  const shot = await image(s, "login.png", 390, 844);
  s.model.script(
    [{ tool: "postBriefRound", args: ROUND_1 }, { tool: "describeBriefImages", args: { images: [{ name: "login.png", point: 1, description: "A login form." }] } }],
    (turn) => { if (!JSON.stringify(turn.toolResults).includes("you were shown no screenshot by that name")) throw new Error(JSON.stringify(turn.toolResults)); return "ok"; },
  );
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"), { attachments: [shot] });
  await s.discord.contextMenu("Draft issues", brief);
  const fields = await briefFields(s, `guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md`);
  expect(fields.images[0].description).toBeUndefined();
});

discordScenario("with an image-capable profile, the model's description of a screenshot is kept in the brief and reaches its draft without resending the image", async (s) => {
  const { ROUND_1, briefFields, embedsIn, draft } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { image, useProfile } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  await useProfile(s, { provider: "openai", model: "gpt-vision", acceptsImages: true }, { scripted: true });
  const shot = await image(s, "login.png", 390, 844);
  const seen = "The sign-in page after submitting: the form is empty again and no error shows.";
  s.model.script(
    { tool: "postBriefRound", args: ROUND_1 },
    (turn) => {
      if (!JSON.stringify(turn.toolResults).includes("Save what login.png shows with describeBriefImages")) throw new Error(JSON.stringify(turn.toolResults));
      return { tool: "describeBriefImages", args: { images: [{ name: "login.png", point: 1, description: seen }] } };
    },
    "ok",
  );
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"), { attachments: [shot] });
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread!, record = `guilds/guild-1/channels/channel-1/threads/${thread.id}.md`;
  const first = s.model.calls[0]!.find((m) => Array.isArray(m.content)) as any;
  expect(first.content.filter((p: any) => p.type === "image")).toHaveLength(1);
  const round = s.discord.botMessages.filter((m) => m.channelId === thread.id).map((m) => m.content).join("\n");
  expect(round).not.toContain("What does");
  expect((await briefFields(s, record)).images).toMatchObject([{ name: "login.png", link: brief.url, point: 1, description: seen }]);

  const calls = s.model.calls.length;
  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(1) }, { tool: "writeIssueDraft", args: draft(2) }], "ok");
  await s.discord.send("yes", { channel: thread });
  for (const call of s.model.calls.slice(calls)) expect(call.some((m) => Array.isArray(m.content))).toBe(false);
  const [one, two] = embedsIn(s, thread.id).map((m: any) => m.embeds[0].description as string);
  expect(one).toContain(`## Current behaviour\nSafari drops the session cookie on the sign-in redirect, so the user lands on sign-in again.\n\nScreenshot [login.png](${brief.url}): ${seen}\n\n## Desired behaviour`);
  expect(two).not.toContain("Screenshot");
});
