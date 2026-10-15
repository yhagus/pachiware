import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const CHANNEL = "guilds/guild-1/channels/channel-1";
const THREAD = `${CHANNEL}/threads/thread-p`;
/** Minutes as written before a private thread had its own folder: in the parent's `minutes/`, the record naming where they were posted. */
const oldMinutes = (postedIn: string, decided: string, channelId = "channel-1", guildId = "guild-1") => [
  "---",
  `title: "Salaries"`, `guildId: "${guildId}"`, `channelId: "${channelId}"`, `postedIn: "${postedIn}"`, `messageId: "9001"`, `requesterId: "user-alice"`,
  `header: {"from":0,"to":0,"count":1,"participants":["Alice"],"cut":null,"language":"en"}`,
  `minutes: {"title":"Salaries","decided":[{"text":"${decided}","link":"https://discord.com/channels/${guildId}/${postedIn}/9000"}],"open":[],"actions":[],"labels":{}}`,
  `corrections: []`, `input: []`,
  "---",
  `**Decided**\n- ${decided}\n`,
].join("\n");
const said = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r.content));

discordScenario("old Minutes posted in a private thread move to its folder when the bot connects, out of reach of the parent's other members", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  const { alice, bob } = s.discord;
  s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write(`${CHANNEL}/minutes/2026-10-01-salaries.md`, oldMinutes("thread-p", "Salary band 5 for Dana"));
  await s.restart();

  expect(await s.workspace.list(`${CHANNEL}/minutes`)).toEqual([]);
  expect(await s.workspace.read(`${THREAD}/minutes/2026-10-01-salaries.md`)).toContain("Salary band 5 for Dana");

  const ask = async (user: typeof alice) => {
    s.model.script([
      { tool: "readFile", args: { path: "channel/minutes/2026-10-01-salaries.md" } },
      { tool: "readFile", args: { path: "channel/threads/thread-p/minutes/2026-10-01-salaries.md" } },
    ], said);
    await s.discord.send(`${s.discord.mention} what were the salary decisions?`, { author: user });
    return JSON.parse(s.discord.botMessages.at(-1)!.content);
  };
  const [gone, moved] = await ask(bob);
  expect(gone).toContain("not found");
  expect(moved).toBe("Only people added to that private thread can have its files read.");
  expect((await ask(alice))[1]).toContain("Salary band 5 for Dana");
});

/** A Note kept from messages before a private thread had its own folder: the source links name the channel each message was in. */
const oldNote = (channels: string[], text: string) => {
  const links = channels.map((c, i) => `https://discord.com/channels/guild-1/${c}/${800 + i}`);
  const source = links.length === 1 ? JSON.stringify(links[0]) : JSON.stringify(links);
  return `---\nsource: ${source}\nauthor: "Alice"\naskedBy: "Alice"\ndate: "2026-10-01"\n---\n${text}\n`;
};

discordScenario("old Notes kept from a private thread's messages move to its folder, nested paths kept; one from the thread's starter message stays", async (s) => {
  const { alice } = s.discord;
  s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write(`${CHANNEL}/notes/hire.md`, oldNote(["thread-p"], "We hire Dana at band 5"));
  await s.workspace.write(`${CHANNEL}/notes/hiring/offers.md`, oldNote(["channel-1", "thread-p", "thread-p"], "Offer sent"));
  await s.workspace.write(`${CHANNEL}/notes/kickoff.md`, oldNote(["channel-1"], "Kickoff in the channel"));
  await s.restart();

  expect(await s.workspace.read(`${THREAD}/notes/hire.md`)).toContain("We hire Dana at band 5");
  expect(await s.workspace.read(`${THREAD}/notes/hiring/offers.md`)).toContain("Offer sent");
  expect(await s.workspace.read(`${CHANNEL}/notes/hire.md`)).toBeNull();
  expect(await s.workspace.read(`${CHANNEL}/notes/hiring/offers.md`)).toBeNull();
  expect(await s.workspace.read(`${CHANNEL}/notes/kickoff.md`)).toContain("Kickoff in the channel");
});

discordScenario("Minutes from a public thread or the channel itself stay; a deleted thread's move as private; a guild the bot does not serve is left alone", async (s) => {
  s.discord.channel("thread-pub", { thread: true, parentId: "channel-1" });
  await s.workspace.write(`${CHANNEL}/minutes/2026-10-01-launch.md`, oldMinutes("thread-pub", "Launch on the 20th"));
  await s.workspace.write(`${CHANNEL}/minutes/2026-10-02-standup.md`, oldMinutes("channel-1", "Standup at nine"));
  await s.workspace.write(`${CHANNEL}/minutes/2026-10-03-salaries.md`, oldMinutes("thread-gone", "Salary bands"));
  await s.workspace.write(`${CHANNEL}/notes/gone.md`, oldNote(["thread-gone"], "Bonus talk"));
  const elsewhere = "guilds/guild-9/channels/channel-9/minutes/2026-10-04-budget.md";
  await s.workspace.write(elsewhere, oldMinutes("thread-gone", "Budget cut", "channel-9", "guild-9"));
  await s.restart();

  expect(await s.workspace.list(`${CHANNEL}/minutes`)).toEqual([`${CHANNEL}/minutes/2026-10-01-launch.md`, `${CHANNEL}/minutes/2026-10-02-standup.md`]);
  expect(await s.workspace.read(`${CHANNEL}/threads/thread-gone/minutes/2026-10-03-salaries.md`)).toContain("Salary bands");
  expect(await s.workspace.read(`${CHANNEL}/threads/thread-gone/notes/gone.md`)).toContain("Bonus talk");
  expect(await s.workspace.list(`${CHANNEL}/threads`)).toEqual([`${CHANNEL}/threads/thread-gone`]);
  expect(await s.workspace.read(elsewhere)).toContain("Budget cut");
  expect(await s.workspace.list("guilds/guild-9/channels/channel-9")).toEqual(["guilds/guild-9/channels/channel-9/minutes"]);
});

discordScenario("a name already taken in the thread's folder is reported and nothing is replaced; running again changes nothing", async (s) => {
  const { alice } = s.discord;
  s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write(`${CHANNEL}/minutes/2026-10-01-salaries.md`, oldMinutes("thread-p", "Salary band 5 for Dana"));
  await s.workspace.write(`${CHANNEL}/minutes/2026-10-02-bonus.md`, oldMinutes("thread-p", "Bonus in December"));
  await s.workspace.write(`${THREAD}/minutes/2026-10-01-salaries.md`, "Written in the thread since\n");
  await s.restart();

  const snapshot = async () => {
    const paths = [
      ...await s.workspace.list(`${CHANNEL}/minutes`), ...await s.workspace.list(`${THREAD}/minutes`),
    ];
    return Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await s.workspace.read(p)])));
  };
  const first = await snapshot();
  expect(Object.keys(first)).toEqual([`${CHANNEL}/minutes/2026-10-01-salaries.md`, `${THREAD}/minutes/2026-10-01-salaries.md`, `${THREAD}/minutes/2026-10-02-bonus.md`]);
  expect(first[`${CHANNEL}/minutes/2026-10-01-salaries.md`]).toContain("Salary band 5 for Dana");
  expect(first[`${THREAD}/minutes/2026-10-01-salaries.md`]).toBe("Written in the thread since\n");
  expect(JSON.parse((await s.workspace.read("guilds/guild-1/.private-threads-moved.json"))!).notMoved).toEqual([
    { from: `${CHANNEL}/minutes/2026-10-01-salaries.md`, to: `${THREAD}/minutes/2026-10-01-salaries.md` },
  ]);

  await s.restart();
  expect(await snapshot()).toEqual(first);
});
