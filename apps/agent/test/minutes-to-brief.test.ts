import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("Draft issues on a minutes message starts a brief with all its action items, authored by whoever ran it", async (s) => {
  const { parseFrontmatter } = await import(process.cwd() + "/packages/skills/src/playbooks.ts");
  const { alice, bob } = s.discord;
  const now = Date.now();
  const [start] = s.discord.history([
    { content: "Release Friday? Bob, notes please. Someone fix the flaky login test", author: alice, at: now - 120_000 },
    { content: "Friday, agreed. I'll write the notes by Thursday", author: bob, at: now - 60_000 },
  ]);
  s.model.script(JSON.stringify({
    title: "Release day",
    decided: [{ text: "Release on Friday", ref: 2 }],
    open: [{ text: "Who announces it", ref: 1 }],
    actions: [{ owner: "Bob", task: "Write the release notes", due: "Thursday", ref: 2 }, { owner: null, task: "Fix the flaky login test", due: null, ref: 1 }],
  }));
  await s.discord.contextMenu("Write minutes", start!);
  const minutes = s.discord.botMessages.at(-1)!;

  s.model.script((turn) => {
    const sent = turn.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    if (!sent.includes("Write the release notes") || !sent.includes("Fix the flaky login test") || sent.includes("Release on Friday")) throw new Error(sent);
    return { tool: "postBriefRound", args: {
      drafts: [{ point: 1, title: "Write the release notes", summary: "Notes for Friday's release." }, { point: 2, title: "Fix the flaky login test", summary: "The login test passes reliably." }],
      questions: [{ point: 2, question: "Should the test be quarantined until fixed?", recommendation: "Yes." }],
    } };
  }, "ok");
  const run = await s.discord.contextMenu("Draft issues", minutes, { user: bob });

  const thread = minutes.thread!;
  expect(thread).toBeDefined();
  expect(run.responses.map((r) => r.kind)).toEqual(["deferReply", "editReply"]);
  expect(run.responses[1].payload.content).toContain(`<#${thread.id}>`);
  const { fields } = parseFrontmatter((await s.workspace.read(`guilds/guild-1/channels/channel-1/threads/${thread.id}.md`))!)!;
  expect(fields).toMatchObject({ playbook: "issue-draft", authorId: bob.id, sourceMessageId: minutes.id, round: 1, points: ["Bob: Write the release notes (due Thursday)", "Fix the flaky login test"] });
  const posted = s.discord.botMessages.filter((m) => m.channelId === thread.id).map((m) => m.content).join("\n");
  expect(posted).toContain("**Round 1**");
  expect(posted).toContain(`Only <@${bob.id}> decides here`);
});

discordScenario("@bot turn points 4 and 5 into issues, replying to minutes, drafts only those action items", async (s) => {
  const { parseFrontmatter } = await import(process.cwd() + "/packages/skills/src/playbooks.ts");
  const { alice, bob } = s.discord;
  const [start] = s.discord.history([{ content: "Plan for the launch, lots to do", author: alice, at: Date.now() - 60_000 }]);
  s.model.script(JSON.stringify({
    title: "Launch plan",
    decided: [{ text: "Launch on Monday", ref: 1 }],
    open: [{ text: "Pricing", ref: 1 }],
    actions: [{ owner: null, task: "Book the venue", ref: 1 }, { owner: null, task: "Write the press release", ref: 1 }, { owner: null, task: "Update the docs", ref: 1 }],
  }));
  await s.discord.contextMenu("Write minutes", start!);
  const minutes = s.discord.botMessages.at(-1)!;
  expect(minutes.embeds[0].description).toMatch(/4\. \*no owner yet\*: Write the press release/);

  s.model.script((turn) => {
    const sent = turn.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    if (sent.includes("Book the venue") || !sent.includes("Write the press release") || !sent.includes("Update the docs")) throw new Error(sent);
    return { tool: "postBriefRound", args: { drafts: [{ point: 1, title: "Write the press release", summary: "Release text ready." }, { point: 2, title: "Update the docs", summary: "Docs match the launch." }], questions: [] } };
  }, "ok");
  await s.discord.send(`${s.discord.mention} turn points 4 and 5 into issues`, { author: bob, replyTo: minutes });

  expect(minutes.edits).toEqual([]);
  const thread = minutes.thread!;
  const { fields } = parseFrontmatter((await s.workspace.read(`guilds/guild-1/channels/channel-1/threads/${thread.id}.md`))!)!;
  expect(fields).toMatchObject({ authorId: bob.id, sourceMessageId: minutes.id, points: ["Write the press release", "Update the docs"] });
  expect(s.discord.botMessages.filter((m) => m.channelId === thread.id).map((m) => m.content).join("\n")).toContain(`Only <@${bob.id}> decides here`);
});

discordScenario("naming an item that is not an action item says which numbers are, and starts nothing", async (s) => {
  const [start] = s.discord.history([{ content: "Ship Friday, agreed. Bob writes notes", at: Date.now() - 60_000 }]);
  s.model.script(JSON.stringify({ title: "Release", decided: [{ text: "Ship Friday", ref: 1 }], open: [], actions: [{ owner: null, task: "Write notes", ref: 1 }, { owner: null, task: "Tag the build", ref: 1 }] }));
  await s.discord.contextMenu("Write minutes", start!);
  const minutes = s.discord.botMessages.at(-1)!;

  const ask = await s.discord.send(`${s.discord.mention} issues: 1 and 2`, { replyTo: minutes });
  expect(s.discord.botMessages.at(-1)).toMatchObject({ reference: { messageId: ask.id }, content: "Item 1 isn't an action item. In these minutes the action items are items 2 and 3." });
  expect(minutes.thread).toBeUndefined();
  expect(minutes.edits).toEqual([]);
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("the first round of a brief from minutes cannot replace its points", async (s) => {
  const { parseFrontmatter } = await import(process.cwd() + "/packages/skills/src/playbooks.ts");
  const [start] = s.discord.history([{ content: "Bob fixes the login test", at: Date.now() - 60_000 }]);
  s.model.script(JSON.stringify({ title: "Tests", decided: [], open: [], actions: [{ owner: null, task: "Fix the login test", ref: 1 }] }));
  await s.discord.contextMenu("Write minutes", start!);
  const minutes = s.discord.botMessages.at(-1)!;
  const round = { drafts: [{ point: 1, title: "Fix the login test", summary: "It passes reliably." }], questions: [] };
  s.model.script(
    { tool: "postBriefRound", args: { points: ["Something else"], ...round } },
    (turn) => { if (!JSON.stringify(turn.toolResults).includes("already set from the minutes")) throw new Error(JSON.stringify(turn.toolResults)); return { tool: "postBriefRound", args: round }; },
    "ok",
  );
  await s.discord.contextMenu("Draft issues", minutes);
  const { fields } = parseFrontmatter((await s.workspace.read(`guilds/guild-1/channels/channel-1/threads/${minutes.thread!.id}.md`))!)!;
  expect(fields).toMatchObject({ round: 1, points: ["Fix the login test"] });
});
