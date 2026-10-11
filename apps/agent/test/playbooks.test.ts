import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("the bot registers a message command for each playbook when it starts", async (s) => {
  await s.settle();
  expect(s.discord.registeredCommands).toContainEqual(expect.objectContaining({ name: "Draft issues", type: 3 }));
});

discordScenario("Draft issues on a message opens a thread from it that follows the issue-draft playbook", async (s) => {
  const { readFileSync } = await import("node:fs");
  const playbook = readFileSync("packages/skills/playbooks/issue-draft/PLAYBOOK.md", "utf8").split(/\n---\n/)[1]!.trim();
  s.model.script("Two drafts proposed. Q1: which browser versions?", "Noted, Safari 17 and up.");
  const brief = await s.discord.send("- login loops on Safari\n- export CSV is slow");
  const run = await s.discord.contextMenu("Draft issues", brief);

  expect(brief.thread).toBeDefined();
  expect(run.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true } }]);
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([[brief.thread!.id, "Two drafts proposed. Q1: which browser versions?"]]);
  expect(s.model.calls[0]![0]!.content).toContain(playbook);
  expect(s.model.calls[0]!.map((m) => m.content).join("\n")).toContain("- login loops on Safari\n- export CSV is slow");

  await s.discord.send("Safari 17 and up", { channel: brief.thread });
  expect(s.model.calls[1]![0]!.content).toContain(playbook);
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: brief.thread!.id, content: "Noted, Safari 17 and up." });
});

discordScenario("a mention with the trigger word starts the issue-draft playbook in a thread from that message", async (s) => {
  s.model.script("Drafting from your two points.");
  const brief = await s.discord.send(`${s.discord.mention} issue:\n- login loops on Safari\n- create issues for CSV export`);
  expect(brief.thread).toBeDefined();
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([[brief.thread!.id, "Drafting from your two points."]]);
  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: issue-draft");
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads")).toEqual([`guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md`]);
});

discordScenario("a tenant playbook with a built-in's name replaces it, and a new tenant playbook starts the same way", async (s) => {
  await s.workspace.write("shared/playbooks/issue-draft/PLAYBOOK.md", `---\nname: issue-draft\ndescription: Our own drafting rules\ntrigger: {"menu": "Draft issues", "word": "issue"}\nrequires: ["workspace"]\n---\nAlways ask which sprint the work belongs to.\n`);
  await s.workspace.write("shared/playbooks/retro/PLAYBOOK.md", `---\nname: retro\ndescription: Collects a retrospective\ntrigger: {"menu": "Run retro", "word": "retro"}\nrequires: workspace\n---\nGroup the points into went well, went badly, and try next.\n`);
  await s.restart();
  expect(s.discord.registeredCommands.map((c) => c.name).sort()).toEqual(["Draft issues", "Run retro"]);

  s.model.script("Which sprint?", "Grouped.", "Grouped again.");
  await s.discord.contextMenu("Draft issues", await s.discord.send("- login loops on Safari"));
  expect(s.model.calls[0]![0]!.content).toContain("Always ask which sprint the work belongs to.");
  expect(s.model.calls[0]![0]!.content).not.toContain("This thread is bound to the issue-draft playbook.");

  await s.discord.contextMenu("Run retro", await s.discord.send("- deploys were slow"));
  await s.discord.send(`${s.discord.mention} retro: standups ran long`);
  for (const call of s.model.calls.slice(1)) expect(call[0]!.content).toContain("Group the points into went well, went badly, and try next.");
});

discordScenario("a playbook refuses to start and names the missing skill when a skill it requires is off", async (s) => {
  const { tenantSkills, and, eq } = await import(process.cwd() + "/packages/db/src/index.ts") as any;
  await s.db.update(tenantSkills).set({ isEnabled: false }).where(and(eq(tenantSkills.tenantId, s.tenant.id), eq(tenantSkills.skillId, "workspace")));
  const brief = await s.discord.send("- login loops on Safari");
  const run = await s.discord.contextMenu("Draft issues", brief);
  expect(run.responses).toEqual([{ kind: "reply", payload: expect.objectContaining({ ephemeral: true, content: expect.stringContaining("Workspace skill") }) }]);

  const mention = await s.discord.send(`${s.discord.mention} issue: export CSV is slow`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringContaining("Workspace skill")]);
  expect(brief.thread ?? mention.thread).toBeUndefined();
  expect(s.model.calls).toEqual([]);
});

discordScenario("the playbook body is in the prompt only for turns in its bound thread", async (s) => {
  s.model.script("Drafting.", "Plain answer.", "Thread answer.");
  const brief = await s.discord.send(`${s.discord.mention} issue: login loops on Safari`);
  const other = await s.discord.send(`${s.discord.mention} what is our deploy day?`);
  await s.discord.send("and the one after?", { channel: other.thread });
  expect(s.model.calls.map((call) => String(call[0]!.content).includes("### Playbook: issue-draft"))).toEqual([true, false, false]);
  expect(brief.thread!.id).not.toBe(other.thread!.id);
});

discordScenario("a thread stays bound to its playbook across a restart until its binding ends", async (s) => {
  s.model.script("Drafting.", "Still drafting.", "Plain again.");
  const thread = s.discord.channel("thread-7", { thread: true, parentId: "channel-1", ownerId: s.discord.bob.id });
  await s.discord.contextMenu("Draft issues", await s.discord.send("- login loops on Safari", { channel: thread }));
  await s.restart();
  await s.discord.send("any news?", { channel: thread });
  expect(s.model.calls[1]![0]!.content).toContain("### Playbook: issue-draft");

  const record = "guilds/guild-1/channels/channel-1/threads/thread-7.md";
  await s.workspace.write(record, (await s.workspace.read(record))!.replace('status: "active"', 'status: "cancelled"'));
  await s.discord.send(`${s.discord.mention} and now?`, { channel: thread });
  expect(s.model.calls[2]![0]!.content).not.toContain("### Playbook: issue-draft");
});

discordScenario("a brief already inside a thread is followed in that thread", async (s) => {
  s.model.script("Drafting here.");
  const thread = s.discord.channel("thread-9", { thread: true, parentId: "channel-1", ownerId: s.discord.alice.id });
  const brief = await s.discord.send("- login loops on Safari", { channel: thread });
  await s.discord.contextMenu("Draft issues", brief);
  expect(brief.thread).toBeUndefined();
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([["thread-9", "Drafting here."]]);

  s.model.script("Got it.");
  await s.discord.send("also Firefox", { channel: thread, author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: "thread-9", content: "Got it." });
  expect(s.model.calls[1]![0]!.content).toContain("### Playbook: issue-draft");
});
