import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { GIF_1PX, anthropicReply, attachment, image, openAIReply, useProfile } from "./support/images";
import { pdf } from "./support/documents";

discordScenario("an image-only mention to a text-only profile is answered with what the bot cannot do", async (s) => {
  const shot = await image(s, "screenshot.png", 300, 200);
  await s.discord.send(s.discord.mention, { attachments: [shot] });
  expect(s.model.calls).toEqual([]);
  expect(s.http.requests).toEqual([]);
  expect(s.discord.botMessages.at(-1)?.content).toBe("I can't see images with this profile. Describe the image in words and I'll work from that.");
});

discordScenario("an image-capable OpenAI profile gets the screenshot as a data URL, and the next turn only a placeholder", async (s) => {
  await useProfile(s, { provider: "openai", model: "gpt-vision", acceptsImages: true });
  const shot = await image(s, "screenshot.png", 1170, 2532);
  s.http.on("POST api.openai.com/v1/chat/completions", () => openAIReply("The login button is cut off."));
  const ask = await s.discord.send(`${s.discord.mention} what is wrong here?`, { attachments: [shot] });
  const [first] = s.http.requests.filter((r) => r.url.endsWith("/chat/completions"));
  const user = first!.body.messages.find((m: any) => Array.isArray(m.content));
  expect(user.role).toBe("user");
  expect(user.content[0]).toEqual({ type: "text", text: "Alice (<@user-alice>): what is wrong here? [image: screenshot.png, 1170×2532]" });
  expect(user.content[1].type).toBe("image_url");
  expect(user.content[1].image_url.url).toStartWith("data:image/png;base64,");
  const { width, height } = await new Bun.Image(Buffer.from(user.content[1].image_url.url.split(",")[1], "base64")).metadata();
  expect(Math.max(width, height)).toBe(2000);
  expect(s.discord.botMessages.at(-1)?.content).toBe("The login button is cut off.");

  await s.discord.send("and how do I fix it?", { channel: ask.thread });
  const second = s.http.requests.filter((r) => r.url.endsWith("/chat/completions")).at(-1)!;
  expect(JSON.stringify(second.body)).not.toContain("base64");
  expect(second.body.messages.map((m: any) => m.content)).toContain("Alice (<@user-alice>): what is wrong here? [image: screenshot.png, 1170×2532]");
});

discordScenario("an image-capable Anthropic profile gets an image block, with a GIF reduced to its first frame", async (s) => {
  await useProfile(s, { provider: "anthropic", model: "claude-opus-5-5", acceptsImages: true });
  const wave = attachment(s, "wave.gif", GIF_1PX, { contentType: "image/gif", width: 1, height: 1 });
  s.http.on("POST api.anthropic.com/v1/messages", () => anthropicReply("A white pixel."));
  await s.discord.send(`${s.discord.mention} what is this?`, { attachments: [wave] });
  const request = s.http.requests.find((r) => r.url.endsWith("/messages"))!;
  const [block, text] = request.body.messages.at(-1).content;
  expect(block.type).toBe("image");
  expect(block.source).toMatchObject({ type: "base64", media_type: "image/png" });
  expect(text).toEqual({ type: "text", text: "Alice (<@user-alice>): what is this? [image: wave.gif, 1×1]" });
  expect(s.discord.botMessages.at(-1)?.content).toBe("A white pixel.");
});

discordScenario("images of the replied-to message reach the model", async (s) => {
  await useProfile(s, { provider: "openai", model: "gpt-vision", acceptsImages: true }, { scripted: true });
  const chart = await image(s, "chart.png", 640, 480);
  const post = await s.discord.send("latency after the deploy", { author: s.discord.bob, attachments: [chart] });
  expect(s.model.calls).toEqual([]);
  s.model.script("p99 doubled at 14:05.");
  await s.discord.send(`${s.discord.mention} what does this show?`, { replyTo: post });
  const turn = s.model.calls[0]!.find((m) => Array.isArray(m.content)) as any;
  expect(turn.content[0].text).toBe('(replying to Bob (<@user-bob>): "latency after the deploy")\nAlice (<@user-alice>): what does this show?\n[image in the replied-to message: chart.png, 640×480]');
  expect(turn.content.slice(1).map((p: any) => [p.type, p.mediaType])).toEqual([["image", "image/png"]]);
});

discordScenario("images over the limit and unreadable images are skipped and named in one line; a document beside them is filed", async (s) => {
  await useProfile(s, { provider: "openai", model: "gpt-vision", acceptsImages: true }, { scripted: true });
  const broken = attachment(s, "broken.png", new TextEncoder().encode("not an image"));
  const huge = attachment(s, "huge.png", null, { size: 30 * 1024 * 1024, width: 9000, height: 9000 });
  const notes = attachment(s, "notes.pdf", pdf(["Notes"]), { contentType: "application/pdf" });
  const shots = await Promise.all(["a.png", "b.png", "c.png", "d.png", "e.png"].map((n) => image(s, n, 10, 10)));
  s.model.script("Four screenshots of the same dialog.");
  await s.discord.send(`${s.discord.mention} compare these`, { attachments: [broken, huge, notes, ...shots] });
  const turn = s.model.calls[0]!.find((m) => Array.isArray(m.content)) as any;
  expect(turn.content.filter((p: any) => p.type === "image")).toHaveLength(4);
  expect(turn.content[0].text).toContain("[file: notes.pdf saved as channel/files/notes.pdf; text in channel/files/notes.md]");
  expect(s.http.requests.some((r) => r.url.includes("huge.png"))).toBe(false);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Four screenshots of the same dialog.\nSkipped broken.png (could not be read as an image), huge.png (too large to download), e.png (over the 4-image limit).");
});

discordScenario("a text-only profile answers the text, sends no image, and says it cannot see images", async (s) => {
  const shot = await image(s, "screenshot.png", 300, 200);
  s.model.script("Restart the api pod.");
  await s.discord.send(`${s.discord.mention} the login page errors, see screenshot`, { attachments: [shot] });
  expect(s.http.requests).toEqual([]);
  expect(s.model.calls[0]!.some((m) => Array.isArray(m.content))).toBe(false);
  expect(s.model.calls[0]!.map((m) => m.content)).toContain("Alice (<@user-alice>): the login page errors, see screenshot [image: screenshot.png, 300×200]");
  expect(s.discord.botMessages.at(-1)?.content).toBe("Restart the api pod.\nI can't see images with this profile.");
});

discordScenario("a provider that rejects the image is retried without it and the reply says so", async (s) => {
  await useProfile(s, { provider: "openai", model: "gpt-text", acceptsImages: true });
  const shot = await image(s, "screenshot.png", 300, 200);
  s.http.on("POST api.openai.com/v1/chat/completions", (req) => JSON.stringify(req.body).includes("image_url")
    ? Response.json({ error: { message: "image_url is only supported by certain models" } }, { status: 400 })
    : openAIReply("Check the auth service logs."));
  await s.discord.send(`${s.discord.mention} why does login fail?`, { attachments: [shot] });
  expect(s.http.requests.filter((r) => r.url.endsWith("/chat/completions"))).toHaveLength(2);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Check the auth service logs.\nThis profile rejected the image; an admin can turn image input off for it.");
});

discordScenario("a reply cut to three messages still ends with the image notes", async (s) => {
  const shot = await image(s, "screenshot.png", 300, 200);
  s.model.script(Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}. ${"Words that make the answer long. ".repeat(30)}`).join("\n\n"));
  await s.discord.send(`${s.discord.mention} explain the whole login flow`, { attachments: [shot] });
  const sent = s.discord.botMessages.map((m) => m.content);
  expect(sent.join("\n")).toContain("-# Cut to stay within 3 messages.");
  expect(sent.at(-1)!.endsWith("I can't see images with this profile.")).toBe(true);
  for (const m of sent) expect(m.length).toBeLessThanOrEqual(2000);
});

discordScenario("in a brief thread the image notes go out with the round that replaces the model's text", async (s) => {
  const { startBrief, ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { thread } = await startBrief(s);
  const shot = await image(s, "safari.png", 300, 200);
  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, answers: [{ q: 1, answer: "No." }] } }, { tool: "postBriefRound", args: { questions: [ROUND_1.questions[1]] } }], "ok");
  await s.discord.send("Q1: no, see the screenshot", { channel: thread, attachments: [shot] });
  const sent = s.discord.botMessages.filter((m) => m.channelId === thread.id).at(-1)!.content;
  expect(sent).toContain("**Round 2**");
  expect(sent.endsWith("I can't see images with this profile.")).toBe(true);
});
