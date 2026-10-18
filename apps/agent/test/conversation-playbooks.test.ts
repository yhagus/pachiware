import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const slashes = (commands: any[]) => commands.filter((c) => c.type === 1).map((c) => c.name);
const menus = (commands: any[]) => commands.filter((c) => c.type === 3).map((c) => c.name);

discordScenario("the imported conversation playbooks add nothing to a guild until the tenant turns one on", async (s) => {
  await s.settle();
  expect(slashes(s.discord.registeredCommands)).toEqual(["issue-draft", "minutes"]);
  expect(menus(s.discord.registeredCommands)).toEqual(["Draft issues", "Write minutes"]);

  const asked = await s.discord.send(`${s.discord.mention} grill-me: we move billing to a queue`);
  expect(asked.thread).toBeUndefined();
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["The grill-me playbook is off here. An admin can turn it on in the console."]);
  expect(s.model.calls).toEqual([]);

  await s.availability({ level: "tenant" }, { kind: "playbook", name: "wait-what", value: "on" });
  expect(slashes(s.discord.registeredCommands)).toEqual(["issue-draft", "minutes", "wait-what"]);
  expect(menus(s.discord.registeredCommands)).toEqual(["Draft issues", "Write minutes", "Explain this"]);
});

discordScenario("once turned on, each startable conversation playbook starts by slash and by mention in its own thread", async (s) => {
  const startable = ["ask-matt", "grill-me", "grilling", "to-questionnaire"];
  for (const name of startable) await s.availability({ level: "tenant" }, { kind: "playbook", name, value: "on" });
  expect(slashes(s.discord.registeredCommands)).toEqual(["ask-matt", "grill-me", "grilling", "issue-draft", "minutes", "to-questionnaire"]);
  s.discord.unlimited(s.discord.alice);

  for (const name of startable) {
    s.model.script(`${name} by slash.`, `${name} by mention.`);
    const calls = s.model.calls.length;
    const slash = await s.discord.slash(name, { text: "we move billing to a queue" });
    const line = s.discord.botMessages.filter((m) => m.channelId === "channel-1").at(-1)!;
    expect(line.content).toBe(`<@${s.discord.alice.id}> started the ${name} playbook.`);
    expect(slash.responses.at(-1)).toEqual({ kind: "editReply", payload: expect.objectContaining({ content: `Following the ${name} playbook in <#${line.thread!.id}>.` }) });
    const mention = await s.discord.send(`${s.discord.mention} ${name}: we move billing to a queue`);
    expect(mention.thread).toBeDefined();
    expect(s.discord.botMessages.filter((m) => m.channelId === mention.thread!.id).map((m) => m.content)).toEqual([`${name} by mention.`]);
    for (const call of s.model.calls.slice(calls)) expect(call[0]!.content).toContain(`### Playbook: ${name}`);
  }
  // grill-me runs the grilling interview it loads.
  const grillMe = s.model.calls.find((c) => String(c[0]!.content).includes("### Playbook: grill-me"))!;
  expect(grillMe[0]!.content).toContain("#### Loaded playbook: grilling");
  expect(grillMe[0]!.content).toContain("Work the tree in **rounds**.");
});

discordScenario("/wait-what explains the bot's last message here, a mention explains the message it replies to, and Explain this the picked message, all in place", async (s) => {
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "wait-what", value: "on" });
  const bot = { id: s.discord.botUserId, name: "Pachiware", bot: true };
  const [older, answer] = s.discord.history([{ content: "Tenants share one database", author: bot }, { content: "We shard by tenant hash with consistent hashing.", author: bot }, { content: "ok thanks", author: s.discord.bob }]);
  s.model.script("Plainer: each tenant's data lives on one server.", "Plainer from a mention.", "Plainer from the menu.");

  const slash = await s.discord.slash("wait-what", { text: "what is a hash here?" });
  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: wait-what");
  expect(s.model.calls[0]!.at(-2)!.content).toBe("Pachiware: We shard by tenant hash with consistent hashing.\nAlice (<@user-alice>): what is a hash here?");
  expect(slash.responses).toEqual([
    { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
    { kind: "editReply", payload: expect.objectContaining({ content: "Answering here with the wait-what playbook." }) },
  ]);
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: "channel-1", content: "Plainer: each tenant's data lives on one server.", reference: { messageId: answer!.id } });

  const ask = await s.discord.send(`${s.discord.mention} wait-what`, { replyTo: older });
  expect(s.model.calls[1]![0]!.content).toContain("### Playbook: wait-what");
  expect(s.model.calls[1]!.at(-2)!.content).toBe("Pachiware: Tenants share one database");
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: "channel-1", content: "Plainer from a mention.", reference: { messageId: ask.id } });

  const [target] = s.discord.history([{ content: "The cache is write-through", author: s.discord.bob }]);
  const menu = await s.discord.contextMenu("Explain this", target!);
  expect(s.model.calls[2]![0]!.content).toContain("### Playbook: wait-what");
  expect(s.model.calls[2]!.at(-2)!.content).toBe("Bob (<@user-bob>): The cache is write-through");
  expect(menu.responses.at(-1)).toEqual({ kind: "editReply", payload: expect.objectContaining({ content: "Answering here with the wait-what playbook." }) });
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: "channel-1", content: "Plainer from the menu.", reference: { messageId: target!.id } });
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads").catch(() => [])).toEqual([]);
});

discordScenario("a wait-what mention that replies to nothing explains the bot's last message in the channel, as /wait-what does", async (s) => {
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "wait-what", value: "on" });
  const bot = { id: s.discord.botUserId, name: "Pachiware", bot: true };
  s.discord.history([{ content: "Tenants share one database", author: bot }, { content: "We shard by tenant hash.", author: bot }, { content: "ok thanks", author: s.discord.bob }]);
  s.model.script("Plainer: each tenant's data lives on one server.");

  const ask = await s.discord.send(`${s.discord.mention} wait-what: what is a hash here?`);

  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: wait-what");
  expect(s.model.calls[0]!.at(-2)!.content).toBe("Pachiware: We shard by tenant hash.\nAlice (<@user-alice>): what is a hash here?");
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: "channel-1", content: "Plainer: each tenant's data lives on one server.", reference: { messageId: ask.id } });
});

discordScenario("/wait-what inside a thread explains the bot's last message in that thread", async (s) => {
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "wait-what", value: "on" });
  const thread = s.discord.channel("thread-1", { thread: true, parentId: "channel-1" });
  s.discord.history([{ content: "Outside the thread", author: { id: s.discord.botUserId, name: "Pachiware", bot: true } }]);
  const [inside] = s.discord.history([{ content: "Retries back off exponentially", author: { id: s.discord.botUserId, name: "Pachiware", bot: true } }, { content: "hm", author: s.discord.bob }], { channel: thread }) as any;
  s.model.script("Each retry waits twice as long.");

  await s.discord.slash("wait-what", { channel: thread });

  expect(s.model.calls[0]!.at(-2)!.content).toBe("Pachiware: Retries back off exponentially");
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: "thread-1", content: "Each retry waits twice as long.", reference: { messageId: inside.id } });
});

discordScenario("a reference playbook cannot be started, but a playbook that loads it carries its text once it is on", async (s) => {
  await s.workspace.write("shared/playbooks/design-review/PLAYBOOK.md", `---\nname: design-review\ndescription: Reviews a module design\nloads: ["codebase-design"]\n---\nReview the design the person describes.\n`);
  await s.restart();
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "codebase-design", value: "on" });
  expect(slashes(s.discord.registeredCommands)).not.toContain("codebase-design");
  expect(slashes(s.discord.registeredCommands)).not.toContain("writing-for-agents");

  s.model.script("A plain answer.", "Reviewing.");
  await s.discord.send(`${s.discord.mention} codebase-design: our billing module`);
  expect(s.model.calls[0]![0]!.content).not.toContain("### Playbook");
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads").catch(() => [])).toEqual([]);

  await s.discord.slash("design-review", { text: "billing module has 14 exports" });
  expect(s.model.calls[1]![0]!.content).toContain("### Playbook: design-review");
  expect(s.model.calls[1]![0]!.content).toContain("#### Loaded playbook: codebase-design");
  expect(s.model.calls[1]![0]!.content).toContain("Design **deep modules**");
});

discordScenario("a playbook that loads a reference the tenant has not turned on is refused with that cause", async (s) => {
  await s.workspace.write("shared/playbooks/design-review/PLAYBOOK.md", `---\nname: design-review\ndescription: Reviews a module design\nloads: ["codebase-design"]\n---\nReview the design the person describes.\n`);
  await s.restart();

  const run = await s.discord.slash("design-review", { text: "billing module has 14 exports" });

  expect(run.responses.at(-1)).toEqual({ kind: "editReply", payload: expect.objectContaining({ content: "The design-review playbook loads codebase-design, which is off here. An admin can turn it on in the console." }) });
  expect(s.model.calls).toEqual([]);
});
