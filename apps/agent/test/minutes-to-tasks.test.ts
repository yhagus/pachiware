import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

// Minutes action items become Tasks of the Minutes' channel, each remembering the item it came from (#253).

const TASKS = "guilds/guild-1/channels/channel-1/tasks";

/** Minutes of a discussion on Wednesday 14 October 2026, 09:00 in Jakarta: Decided 1, Still open 2, action items 3 to 5. */
async function postMinutes(s: Scenario) {
  const { alice, bob } = s.discord;
  s.clock.set("2026-10-14T02:00:00Z");
  const now = s.clock.now();
  const [start, second] = s.discord.history([
    { content: "Release Friday? Bob, notes please. Someone fix the flaky login test", author: alice, at: now - 120_000 },
    { content: "Friday, agreed. I'll write the notes by Thursday. Dewi orders the banners next week", author: bob, at: now - 60_000 },
  ]);
  s.model.script(JSON.stringify({
    title: "Release day",
    decided: [{ text: "Release on Friday", ref: 2 }],
    open: [{ text: "Who announces it", ref: 1 }],
    actions: [
      { owner: "Bob", task: "Write the release notes.", due: "Thursday", ref: 2 },
      { owner: null, task: "Fix the flaky login test", due: null, ref: 1 },
      { owner: "Dewi", task: "Order the banners", due: "minggu depan", ref: 2 },
    ],
  }));
  await s.discord.contextMenu("Write minutes", start!);
  return { minutes: s.discord.botMessages.at(-1)!, start: start!, second: second! };
}
/** The bot's last message that is not an Assignee's ping. */
const lastReply = (s: Scenario) => s.discord.botMessages.filter((m) => !m.allowedMentions?.users).at(-1)!;
const tasks = async (s: Scenario) => Promise.all((await s.workspace.files(TASKS)).filter((p) => p.endsWith(".md")).map(async (p) => (await s.workspace.read(p))!));

discordScenario("'jadikan task semua' replying to Minutes makes a task of every action item, with Assignees, due dates in words as days, and the item each came from, without a model turn", async (s) => {
  await s.guildSettings({ useThreads: false });
  const { minutes, second } = await postMinutes(s);
  const file = /minutes\/(\S+\.md)$/.exec(minutes.embeds[0].footer.text)![1]!;
  const calls = s.model.calls.length;

  await s.discord.send("jadikan task semua ya", { replyTo: minutes });
  expect(s.model.calls.length).toBe(calls);
  const reply = lastReply(s).content;
  expect(reply.split("\n")[0]).toBe('3 task dibuat dari notula "Release day":');
  expect(reply).toContain("| due 2026-10-15 | Bob |");
  expect(reply).toContain('-# Butir 5: "minggu depan" tidak menunjuk satu hari, jadi saya tulis di deskripsi.');

  const written = await tasks(s);
  expect(written).toHaveLength(3);
  const notes = written.find((t) => t.includes('title: "Write the release notes"'))!;
  expect(notes).toContain('assignedTo: {"id":"user-bob","name":"Bob"}');
  expect(notes).toContain('dueAt: "2026-10-15"');
  expect(notes).toContain(`madeFrom: {"label":"Notula \\"Release day\\", butir 3","link":"https://discord.com/channels/guild-1/channel-1/${second.id}","path":"guilds/guild-1/channels/channel-1/minutes/${file}","item":3}`);
  const banners = written.find((t) => t.includes('title: "Order the banners"'))!;
  expect(banners).toContain('assignedTo: {"name":"Dewi"}');
  expect(banners).toContain("dueAt: null");
  expect(banners).toContain("Tenggat seperti disebut: minggu depan.");
  const flaky = written.find((t) => t.includes('title: "Fix the flaky login test"'))!;
  expect(flaky).toContain("assignedTo: null");
});

discordScenario("asking again makes no second task of an item already made, and names the task it already is", async (s) => {
  await s.guildSettings({ useThreads: false });
  const { minutes } = await postMinutes(s);
  await s.discord.send("turn item 3 into a task", { replyTo: minutes });
  expect(lastReply(s).content.split("\n")[0]).toBe('1 task made from the minutes "Release day":');
  await s.discord.send("make items 3 and 4 tasks", { replyTo: minutes, author: s.discord.bob });
  const reply = lastReply(s).content;
  expect(reply.split("\n")[0]).toBe('1 task made from the minutes "Release day":');
  expect(reply).toContain("Item 3 is already a task: pending | due 2026-10-15 | Bob |");
  expect(await tasks(s)).toHaveLength(2);
});

discordScenario("a number that is no action item is refused with the action items' numbers, and nothing is made", async (s) => {
  await s.guildSettings({ useThreads: false });
  const { minutes } = await postMinutes(s);
  await s.discord.send("make item 1 a task", { replyTo: minutes });
  expect(s.discord.botMessages.at(-1)!.content).toBe("Item 1 isn't an action item. In these minutes the action items are items 3, 4 and 5.");
  expect(await tasks(s)).toEqual([]);
});

discordScenario("the model can make tasks from Minutes it found, with tasksFromMinutes and the item numbers", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { minutes } = await postMinutes(s);
  const file = /minutes\/(\S+\.md)$/.exec(minutes.embeds[0].footer.text)![1]!;
  let result: any;
  s.model.script({ tool: "tasksFromMinutes", args: { minutes: `channel/minutes/${file}`, points: [4] } }, (turn) => { result = turn.toolResults[0]; return "Made it."; });
  await s.discord.send(`${s.discord.mention} make a task of the flaky login test from yesterday's minutes`);
  expect(result.created).toHaveLength(1);
  expect(result.created[0].item).toBe(4);
  const written = await tasks(s);
  expect(written).toHaveLength(1);
  expect(written[0]).toContain('title: "Fix the flaky login test"');
});

// The open points of the previous Minutes are raised again in the next ones until a discussion settles them (#250).
discordScenario("an open point of the previous Minutes that the next discussion did not settle is shown again, dated, after the action items", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  await postMinutes(s);
  s.clock.set("2026-10-16T02:00:00Z");
  const [next] = s.discord.history([{ content: "Banners are printed. Still no venue for the party", author: s.discord.alice, at: s.clock.now() - 60_000 }]);
  let sent = "";
  s.model.script((turn) => {
    sent = String(turn.messages.at(-1)!.content);
    return JSON.stringify({ title: "Party prep", decided: [{ text: "Banners are printed", ref: 1 }], open: [{ text: "Venue for the party", ref: 1 }], actions: [], settled: [] });
  });
  await s.discord.contextMenu("Write minutes", next!);
  expect(sent).toContain("Open points of the previous minutes, by number:\n1. Who announces it");
  const embed = s.discord.botMessages.at(-1)!.embeds[0].description as string;
  expect(embed).toMatch(/\*\*Still open from earlier minutes\*\*\n- Who announces it \(from 2026-10-14\) \[↗\]\(https:\/\/discord\.com\/channels\/guild-1\/channel-1\/\d+\)$/);
  expect(embed).toContain("2. Venue for the party");
});

discordScenario("an open point the next discussion settled is not raised again", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  await postMinutes(s);
  s.clock.set("2026-10-16T02:00:00Z");
  const [next] = s.discord.history([{ content: "Alice announces the release", author: s.discord.bob, at: s.clock.now() - 60_000 }]);
  s.model.script(JSON.stringify({ title: "Release follow-up", decided: [{ text: "Alice announces the release", ref: 1 }], open: [], actions: [], settled: [1] }));
  await s.discord.contextMenu("Write minutes", next!);
  expect(s.discord.botMessages.at(-1)!.embeds[0].description).not.toContain("Still open from earlier minutes");
});
