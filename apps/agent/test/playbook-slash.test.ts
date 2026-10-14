import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { pdf } from "./support/documents";

const slashes = (commands: any[] | null) => (commands ?? []).filter((c) => c.type === 1);

discordScenario("a guild's command list has one slash command per available playbook, each with an optional text and file", async (s) => {
  await s.discord.joinGuild("guild-2");
  await s.availability({ level: "guild", guildId: "guild-2" }, { kind: "playbook", name: "minutes", value: "off" });

  expect(slashes(s.discord.commandsIn("guild-1")).map((c) => c.name)).toEqual(["issue-draft", "minutes"]);
  expect(slashes(s.discord.commandsIn("guild-2")).map((c) => c.name)).toEqual(["issue-draft"]);
  for (const command of slashes(s.discord.commandsIn("guild-1"))) {
    expect(command.description).toBeTruthy();
    expect(command.options).toEqual([
      expect.objectContaining({ type: 3, name: "text", maxLength: 6000 }),
      expect.objectContaining({ type: 11, name: "file" }),
    ]);
    expect(command.options.some((o: any) => o.required)).toBe(false);
  }
  // Menus are sent in the same overwrite.
  expect(s.discord.commandsIn("guild-1")!.filter((c) => c.type === 3).map((c) => c.name)).toEqual(["Draft issues", "Write minutes"]);
});

discordScenario("a slash start defers privately, posts one public line, opens and binds a thread from it, and points the person at it", async (s) => {
  s.model.script("Drafting from your point.");
  const run = await s.discord.slash("issue-draft", { text: "login loops on Safari" });

  const channel = s.discord.botMessages.filter((m) => m.channelId === "channel-1");
  expect(channel.map((m) => m.content)).toEqual([`<@${s.discord.alice.id}> started the issue-draft playbook.`]);
  expect(channel[0]!.allowedMentions).toEqual({ parse: [] });
  const thread = channel[0]!.thread!;
  expect(thread).toBeDefined();
  expect(s.discord.botMessages.filter((m) => m.channelId === thread.id).map((m) => m.content)).toEqual(["Drafting from your point."]);
  expect(run.responses).toEqual([
    { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
    { kind: "editReply", payload: expect.objectContaining({ content: `Following the issue-draft playbook in <#${thread.id}>.` }) },
  ]);
  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: issue-draft");
  expect(s.model.calls[0]!.at(-2)!.content).toBe("Alice: login loops on Safari");

  const binding = await s.workspace.read(`guilds/guild-1/channels/channel-1/threads/${thread.id}.md`);
  expect(binding).toContain(`authorId: "${s.discord.alice.id}"`);
  expect(binding).toContain(`botId: "${s.bot.id}"`);
  expect(binding).toContain("login loops on Safari");

  s.model.script("Noted, Safari 17 and up.");
  await s.discord.send("Safari 17 and up", { channel: thread });
  expect(s.model.calls[1]![0]!.content).toContain("### Playbook: issue-draft");
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: thread.id, content: "Noted, Safari 17 and up." });
});

discordScenario("a slash start refused by a channel rule or an off required skill tells only the person why and posts nothing", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "playbook", name: "issue-draft", value: "off" });
  await s.availability({ level: "channel", channelId: "channel-3" }, { kind: "skill", name: "workspace", value: "off" });

  const offHere = await s.discord.slash("issue-draft", { text: "login loops on Safari", channel: "channel-2" });
  const skillOff = await s.discord.slash("issue-draft", { text: "login loops on Safari", channel: "channel-3" });

  expect(offHere.responses).toEqual([
    { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
    { kind: "editReply", payload: expect.objectContaining({ content: expect.stringMatching(/issue-draft playbook is off here/) }) },
  ]);
  expect(skillOff.responses).toEqual([
    { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
    { kind: "editReply", payload: expect.objectContaining({ content: expect.stringMatching(/issue-draft playbook needs the Workspace skill, which is off here/) }) },
  ]);
  expect(s.discord.botMessages).toEqual([]);
  expect(s.model.calls).toEqual([]);
});

discordScenario("a slash start inside a thread that already follows a playbook is refused privately and posts nothing", async (s) => {
  s.model.script("Drafting from your point.");
  await s.discord.slash("issue-draft", { text: "login loops on Safari" });
  const thread = s.discord.botMessages[0]!.thread!;
  const posted = s.discord.botMessages.length;

  const run = await s.discord.slash("issue-draft", { text: "export CSV is slow", channel: thread });

  expect(run.responses).toEqual([
    { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
    { kind: "editReply", payload: expect.objectContaining({ content: "This thread already follows the issue-draft playbook." }) },
  ]);
  expect(s.discord.botMessages).toHaveLength(posted);
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("a file attached to a slash start reaches the playbook's first turn as a message attachment would", async (s) => {
  const report = attachment(s, "report.pdf", pdf(["Login loops on Safari 17"]), { contentType: "application/pdf" });
  s.model.script("Drafting from the report.");
  await s.discord.slash("issue-draft", { file: report });

  expect(s.model.calls[0]!.at(-2)!.content).toBe("Alice: [file: report.pdf saved as channel/files/report.pdf; text in channel/files/report.md]");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/files/report.md")).toBe("Login loops on Safari 17\n");
  const line = s.discord.botMessages.find((m) => m.channelId === "channel-1")!;
  expect(line.thread!.name).toBe("issue-draft");
});

discordScenario("a mention with a playbook's name starts it like its trigger word, a tenant playbook with no word gets a slash command, and a reference gets neither", async (s) => {
  await s.workspace.write("shared/playbooks/retro/PLAYBOOK.md", `---\nname: retro\ndescription: Collects a retrospective\nrequires: workspace\n---\nGroup the points into went well, went badly, and try next.\n`);
  await s.workspace.write("shared/playbooks/house-style/PLAYBOOK.md", `---\nname: house-style\ndescription: How we write\nstart: false\n---\nShort sentences.\n`);
  await s.restart();
  expect(s.discord.registeredCommands.filter((c) => c.type === 1).map((c) => [c.name, c.description])).toEqual([["issue-draft", expect.any(String)], ["minutes", expect.any(String)], ["retro", "Collects a retrospective"]]);

  s.model.script("Grouping.", "Drafting.", "Plain answer.");
  const retro = await s.discord.send(`${s.discord.mention} retro: standups ran long`);
  const draft = await s.discord.send(`${s.discord.mention} issue-draft: login loops on Safari`);
  const reference = await s.discord.send(`${s.discord.mention} house-style: tighten this`);

  expect(retro.thread).toBeDefined();
  expect(draft.thread).toBeDefined();
  expect(s.model.calls[2]![0]!.content).not.toContain("Short sentences.");
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads")).not.toContain(`guilds/guild-1/channels/channel-1/threads/${reference.thread?.id}.md`);
  expect(s.model.calls[0]![0]!.content).toContain("Group the points into went well, went badly, and try next.");
  expect(s.model.calls[1]![0]!.content).toContain("### Playbook: issue-draft");
});

discordScenario("a run: in-place playbook answers where it was started, from a slash command, its menu, or a mention, and opens no thread", async (s) => {
  await s.workspace.write("shared/playbooks/plainer/PLAYBOOK.md", `---\nname: plainer\ndescription: Says it plainer\ntrigger: {"menu": "Say it plainer"}\nrun: in-place\n---\nRewrite the message in plain words.\n`);
  await s.restart();
  s.model.script("Plain from slash.", "Plain from menu.", "Plain from mention.");

  const slash = await s.discord.slash("plainer", { text: "the deploy is idempotent" });
  const [target] = s.discord.history([{ content: "We shard by tenant hash", author: s.discord.bob, at: Date.now() - 60_000 }]);
  const menu = await s.discord.contextMenu("Say it plainer", target!);
  const ask = await s.discord.send(`${s.discord.mention} plainer: eventual consistency`);

  for (const call of s.model.calls) expect(call[0]!.content).toContain("Rewrite the message in plain words.");
  expect(s.model.calls[0]!.map((m) => m.content)).toContain("Alice: the deploy is idempotent");
  expect(s.model.calls[1]!.map((m) => m.content)).toContain("Bob: We shard by tenant hash");
  // Like the slash command, a mention that replies to nothing is about the bot's last message here.
  expect(s.model.calls[2]!.map((m) => m.content)).toContain("Pachiware: Plain from menu.\nAlice: eventual consistency");
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content, m.reference?.messageId])).toEqual([
    ["channel-1", "Plain from slash.", undefined],
    ["channel-1", "Plain from menu.", target!.id],
    ["channel-1", "Plain from mention.", ask.id],
  ]);
  for (const run of [slash, menu]) {
    expect(run.responses).toEqual([
      { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
      { kind: "editReply", payload: expect.objectContaining({ content: "Answering here with the plainer playbook." }) },
    ]);
  }
  expect(target!.thread).toBeUndefined();
  expect(ask.thread).toBeUndefined();
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads").catch(() => [])).toEqual([]);
});
