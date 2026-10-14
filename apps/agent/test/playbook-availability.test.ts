import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("a playbook off in a channel is refused there with the reason and still starts in another channel", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "playbook", name: "issue-draft", value: "off" });
  const brief = await s.discord.send("- login loops on Safari", { channel: "channel-2" });
  const run = await s.discord.contextMenu("Draft issues", brief);
  expect(run.responses).toEqual([{ kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) }, { kind: "editReply", payload: expect.objectContaining({ content: expect.stringMatching(/issue-draft playbook is off here/) }) }]);
  const mention = await s.discord.send(`${s.discord.mention} issue: export CSV is slow`, { channel: "channel-2" });
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringMatching(/issue-draft playbook is off here/)]);
  expect(brief.thread ?? mention.thread).toBeUndefined();
  expect(s.model.calls).toEqual([]);

  s.model.script("Drafting.");
  const elsewhere = await s.discord.send(`${s.discord.mention} issue: export CSV is slow`);
  expect(elsewhere.thread).toBeDefined();
  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: issue-draft");
});

discordScenario("a skill the playbook requires off in a channel refuses it there and names the skill", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "skill", name: "workspace", value: "off" });
  const run = await s.discord.contextMenu("Draft issues", await s.discord.send("- login loops on Safari", { channel: "channel-2" }));
  expect(run.responses).toEqual([{ kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) }, { kind: "editReply", payload: expect.objectContaining({ content: expect.stringMatching(/issue-draft playbook needs the Workspace skill, which is off here/) }) }]);
  expect(s.model.calls).toEqual([]);
});

discordScenario("one of the playbook's tools off still lets it start and run without that tool", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "searchFiles", value: "off" });
  s.model.script("Drafting.");
  const brief = await s.discord.send(`${s.discord.mention} issue: export CSV is slow`);
  expect(brief.thread).toBeDefined();
  expect(s.model.tools[0]).not.toContain("searchFiles");
  expect(s.model.tools[0]).toEqual(expect.arrayContaining(["readPlaybookFile", "postBriefRound", "writeIssueDraft"]));
});

discordScenario("a playbook's tools disappear where the playbook is off and stay elsewhere", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "playbook", name: "issue-draft", value: "off" });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} hi`, { channel: "channel-2" });
  await s.discord.send(`${s.discord.mention} hi`);
  const brief = ["describeBriefImages", "postBriefRound", "recordBriefAnswers", "writeIssueDraft"];
  expect(s.model.tools[0].filter((t) => brief.includes(t))).toEqual([]);
  expect(s.model.tools[0]).toContain("readFile");
  expect(s.model.tools[1]).toEqual(expect.arrayContaining(brief));
});

discordScenario("turning a playbook off while its thread is active ends the thread with one note on the next message", async (s) => {
  s.model.script("Drafting.");
  const brief = await s.discord.send(`${s.discord.mention} issue: export CSV is slow`);
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "playbook", name: "issue-draft", value: "off" });
  await s.discord.send("any news?", { channel: brief.thread });
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Drafting.", expect.stringMatching(/issue-draft playbook is no longer available here/)]);
  expect(s.model.calls).toHaveLength(1);
  expect(await s.workspace.read(`guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md`)).toContain('status: "cancelled"');

  s.model.script("Plain answer.");
  await s.discord.send("and now?", { channel: brief.thread });
  expect(s.discord.botMessages.filter((m) => /no longer available/.test(m.content))).toHaveLength(1);
  expect(s.model.calls[1]![0]!.content).not.toContain("### Playbook: issue-draft");
  expect(s.model.tools[1]).not.toContain("postBriefRound");
});

discordScenario("a playbook's write tools obey a write effect rule while the playbook itself still starts", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "effect", name: "write", value: "off" });
  s.model.script("Drafting.");
  const brief = await s.discord.send(`${s.discord.mention} issue: export CSV is slow`);
  expect(brief.thread).toBeDefined();
  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: issue-draft");
  expect(s.model.tools[0]).not.toContain("postBriefRound");
  expect(s.model.tools[0]).toContain("readPlaybookFile");
});

const RETRO = `---\nname: retro\ndescription: Group the points\ntrigger: {"word": "retro"}\ndefault: off\n---\nGroup the points.\n`;

discordScenario("a default-off playbook is off everywhere with no rules and is refused with off here", async (s) => {
  await s.workspace.write("shared/playbooks/retro/PLAYBOOK.md", RETRO);
  const run = await s.discord.send(`${s.discord.mention} retro: login loops, slow export`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringMatching(/retro playbook is off here/)]);
  expect(run.thread).toBeUndefined();
  expect(s.model.calls).toEqual([]);
});

discordScenario("a default-off playbook turned on at the tenant starts everywhere a channel rule does not narrow it", async (s) => {
  await s.workspace.write("shared/playbooks/retro/PLAYBOOK.md", RETRO);
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "retro", value: "on" });
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "playbook", name: "retro", value: "off" });
  s.model.script("Grouping.");
  const started = await s.discord.send(`${s.discord.mention} retro: login loops, slow export`);
  expect(started.thread).toBeDefined();
  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: retro");

  await s.discord.send(`${s.discord.mention} retro: login loops`, { channel: "channel-2" });
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Grouping.", expect.stringMatching(/retro playbook is off here/)]);
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("a default-off playbook no rule mentions leaves the prompt as it was", async (s) => {
  await s.workspace.write("shared/playbooks/retro/PLAYBOOK.md", RETRO);
  s.model.script("Hello.");
  await s.discord.send(`${s.discord.mention} hi`);
  expect(s.model.calls[0]![0]!.content).not.toContain("Turned off here");
});
