import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";

const THREAD = "guilds/guild-1/channels/channel-1/threads/thread-p";
const said = (turn: any) => { const r = turn.toolResults[0]; return r.error ? `refused: ${r.error}` : r.content ?? r.path ?? JSON.stringify(r); };
const show = (turn: any) => { const r = turn.toolResults[0]; return r.error ? `refused: ${r.error}` : JSON.stringify(r); };

discordScenario("minutes written in a private thread go to the thread's folder, are read from inside it, and take corrections there", async (s) => {
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  s.discord.history([{ content: "We ship pricing v2 on Monday, agreed", author: alice, at: Date.now() - 60_000 }], { channel: thread });
  s.model.script(JSON.stringify({ title: "Pricing", decided: [{ text: "Ship pricing v2 on Monday", ref: 1 }], open: [], actions: [] }));
  await s.discord.send(`${s.discord.mention} minutes`, { channel: thread });

  const file = `${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}-pricing.md`; // named by the date in Jakarta, UTC+7 all year
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toEqual([]);
  expect(await s.workspace.list(`${THREAD}/minutes`)).toEqual([`${THREAD}/minutes/${file}`]);

  s.model.script({ tool: "readFile", args: { path: `thread/minutes/${file}` } }, said);
  await s.discord.send(`${s.discord.mention} what did we decide?`, { channel: thread });
  expect(s.discord.botMessages.at(-1)!.content).toContain("Ship pricing v2 on Monday");

  const minutes = s.discord.botMessages.find((m) => m.embeds.length)!;
  s.model.script(JSON.stringify({ title: "Pricing", decided: [], open: [{ text: "Pricing v2 date not settled", ref: 1 }], actions: [] }));
  await s.discord.send("Monday was not agreed yet", { author: alice, replyTo: minutes, channel: thread });
  expect(await s.workspace.read(`${THREAD}/minutes/${file}`)).toContain("Pricing v2 date not settled");
});

discordScenario("a Note, a Decision and a Document kept in a private thread land in the thread's folder, even when the model names the channel's", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  const offer = attachment(s, "offer.txt", new TextEncoder().encode("Salary band 5\n"), { contentType: "text/plain" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the offer`, { channel: thread, attachments: [offer] });
  expect(s.model.calls[0]!.at(-2)!.content).toContain("saved as thread/files/offer.txt");

  const [said] = s.discord.history([{ content: "We hire Dana at band 5", author: alice }], { channel: thread });
  s.model.script(
    [{ tool: "keepAsNote", args: { messageIds: [said!.id], path: "channel/notes/hire.md" } }, { tool: "writeFile", args: { path: "channel/decisions/2026-10-15-hire-dana.md", content: "# Hire Dana at band 5\n" } }],
    (turn) => turn.toolResults.map((r: any) => r.error ?? r.path).join(" "),
  );
  await s.discord.send(`${s.discord.mention} keep that as a note and record the decision`, { channel: thread });
  expect(s.discord.botMessages.at(-1)!.content).toBe("thread/notes/hire.md thread/decisions/2026-10-15-hire-dana.md");

  expect(await s.workspace.read(`${THREAD}/files/offer.txt`)).toBe("Salary band 5\n");
  expect(await s.workspace.read(`${THREAD}/.documents/files/offer.txt.json`)).toContain("Alice");
  expect(await s.workspace.read(`${THREAD}/notes/hire.md`)).toContain("We hire Dana at band 5");
  expect(await s.workspace.read(`${THREAD}/decisions/2026-10-15-hire-dana.md`)).toBe("# Hire Dana at band 5\n");
  for (const folder of ["files", "notes", "decisions", ".documents"]) expect(await s.workspace.list(`guilds/guild-1/channels/channel-1/${folder}`)).toEqual([]);
});

discordScenario("in the parent channel only people added to a private thread can list, read or search its folder; a deleted thread's is read by nobody", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  const { alice, bob } = s.discord;
  s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write(`${THREAD}/minutes/2026-10-14-salaries.md`, "Salary bands agreed\n");
  await s.workspace.write("guilds/guild-1/channels/channel-1/threads/thread-gone/minutes/2026-09-01-salaries.md", "Old salary talk\n");
  await s.workspace.write("guilds/guild-1/channels/channel-1/threads/thread-x.md", "---\nplaybook: issue-draft\n---\nSalary page brief\n");
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/lunch.md", "Salary day lunch\n");
  const calls = [
    { tool: "listFiles", args: { path: "channel/threads/thread-p/minutes" } },
    { tool: "readFile", args: { path: "channel/threads/thread-p/minutes/2026-10-14-salaries.md" } },
    { tool: "searchFiles", args: { query: "salary", path: "channel/threads/thread-p" } },
    { tool: "searchFiles", args: { query: "salary", path: "channel" } },
    { tool: "listFiles", args: { path: "channel/threads" } },
    { tool: "readFile", args: { path: "channel/threads/thread-gone/minutes/2026-09-01-salaries.md" } },
    { tool: "readFile", args: { path: "channel/threads/thread-x.md" } },
  ];
  const ask = async (user: typeof alice) => {
    s.model.script(calls, (turn) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r)));
    await s.discord.send(`${s.discord.mention} what do we have on salaries?`, { author: user });
    return JSON.parse(s.discord.botMessages.at(-1)!.content);
  };
  const refused = "Only people added to that private thread can have its files read.";
  const lunch = { path: "channel/notes/lunch.md", lines: [{ line: 1, text: "Salary day lunch" }] };
  const salaries = { path: "channel/threads/thread-p/minutes/2026-10-14-salaries.md", lines: [{ line: 1, text: "Salary bands agreed" }] };

  expect(await ask(bob)).toEqual([refused, refused, refused, { matches: [lunch] }, { entries: [] }, refused, refused]);
  expect(await ask(alice)).toEqual([
    { entries: [{ path: salaries.path, type: "file", size: 20 }] },
    { content: "Salary bands agreed\n", version: expect.any(String) },
    { matches: [salaries] },
    { matches: [salaries, lunch] },
    { entries: [{ path: "channel/threads/thread-p", type: "dir" }] },
    refused,
    refused,
  ]);
});

discordScenario("inside a private thread the parent channel's files are still read, and the turn says where the thread keeps its own", async (s) => {
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/lunch.md", "Salary day lunch\n");
  await s.workspace.write(`${THREAD}/notes/bands.md`, "Salary bands\n");
  s.model.script(
    [{ tool: "readFile", args: { path: "channel/notes/lunch.md" } }, { tool: "searchFiles", args: { query: "salary", path: "channel" } }, { tool: "listFiles", args: { path: "thread/notes" } }],
    (turn) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r.content ?? r.matches?.map((m: any) => m.path) ?? r.entries.map((e: any) => e.path))),
  );
  await s.discord.send(`${s.discord.mention} what do we know about salaries?`, { channel: thread });
  const [read, found, listed] = JSON.parse(s.discord.botMessages.at(-1)!.content);
  expect(read).toBe("Salary day lunch\n");
  // Both files match alike, and ties go by modified time, which two files written back to back may share: the order is not the point.
  expect([...found].sort()).toEqual(["channel/notes/lunch.md", "channel/threads/thread-p/notes/bands.md"]);
  expect(listed).toEqual(["thread/notes/bands.md"]);
  expect(s.model.calls[0]!.map((m) => m.content).join("\n")).toContain("thread/ is this private thread's own folder");
});

discordScenario("a private thread's files change only from inside it, and the refusals speak the place's language", async (s) => {
  const { alice, bob } = s.discord;
  await s.guildSettings({ useThreads: false });
  s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write(`${THREAD}/minutes/2026-10-14-salaries.md`, "Salary bands agreed\n");
  const calls = [
    { tool: "readFile", args: { path: "channel/threads/thread-p/minutes/2026-10-14-salaries.md" } },
    { tool: "moveFile", args: { from: "channel/threads/thread-p/minutes/2026-10-14-salaries.md", to: "channel/notes/salaries.md" } },
    { tool: "writeFile", args: { path: "channel/threads/thread-p/notes/x.md", content: "x" } },
  ];
  const ask = async (user: typeof alice) => {
    s.model.script(calls, (turn) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? "ok")));
    await s.discord.send(`${s.discord.mention} pindahkan notulen gaji ke catatan channel`, { author: user });
    return JSON.parse(s.discord.botMessages.at(-1)!.content);
  };
  const readOnly = "File thread privat hanya bisa diubah dari dalam thread itu sendiri.";
  const topOnly = "Di tingkat atas folder channel atau DM hanya boleh ada tasks, notes, decisions, files, minutes, daily-logs, MEMORY.md, glossary.md; letakkan di salah satunya.";
  expect(await ask(bob)).toEqual(["Hanya orang yang ditambahkan ke thread privat itu yang bisa meminta file-nya dibaca.", readOnly, topOnly]);
  expect(await ask(alice)).toEqual(["ok", readOnly, topOnly]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/notes")).toEqual([]);
  expect(await s.workspace.read(`${THREAD}/minutes/2026-10-14-salaries.md`)).toBe("Salary bands agreed\n");
});

discordScenario("a public thread still keeps its Minutes, Notes, Decisions and Documents in the parent channel's folders", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-pub", { thread: true, parentId: "channel-1", ownerId: alice.id });
  const CHANNEL = "guilds/guild-1/channels/channel-1";
  const plan = attachment(s, "plan.txt", new TextEncoder().encode("Launch plan\n"), { contentType: "text/plain" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the plan`, { channel: thread, attachments: [plan] });
  const [said] = s.discord.history([{ content: "We launch on the 20th, agreed", author: alice }], { channel: thread });
  s.model.script(
    [{ tool: "keepAsNote", args: { messageIds: [said!.id], path: "channel/notes/launch.md" } }, { tool: "writeFile", args: { path: "channel/decisions/2026-10-15-launch.md", content: "# Launch on the 20th\n" } }],
    (turn) => turn.toolResults.map((r: any) => r.error ?? r.path).join(" "),
  );
  await s.discord.send(`${s.discord.mention} keep that and record the decision`, { channel: thread });
  expect(s.discord.botMessages.at(-1)!.content).toBe("channel/notes/launch.md channel/decisions/2026-10-15-launch.md");
  s.model.script(JSON.stringify({ title: "Launch", decided: [{ text: "Launch on the 20th", ref: 1 }], open: [], actions: [] }));
  await s.discord.send(`${s.discord.mention} minutes`, { channel: thread });

  expect(await s.workspace.read(`${CHANNEL}/files/plan.txt`)).toBe("Launch plan\n");
  expect(await s.workspace.read(`${CHANNEL}/notes/launch.md`)).toContain("We launch on the 20th, agreed");
  expect(await s.workspace.read(`${CHANNEL}/decisions/2026-10-15-launch.md`)).toBe("# Launch on the 20th\n");
  expect(await s.workspace.list(`${CHANNEL}/minutes`)).toEqual([`${CHANNEL}/minutes/2026-10-15-launch.md`]);
  expect(await s.workspace.list(`${CHANNEL}/threads`)).toEqual([]);
});

discordScenario("a file of the private thread deleted from inside it goes once its asker presses Confirm", async (s) => {
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write(`${THREAD}/notes/old.md`, "outdated\n");
  s.model.script({ tool: "deleteFile", args: { path: "thread/notes/old.md" } }, "Waiting for your Confirm.");
  await s.discord.send(`${s.discord.mention} delete the old note`, { channel: thread });
  const confirm = s.discord.botMessages.find((m) => m.components.length)!;
  await s.discord.click(confirm, "Confirm");
  expect(await s.workspace.read(`${THREAD}/notes/old.md`)).toBeNull();
});

discordScenario("asking in the parent channel or its public thread with no path, a member added to a private thread has its files searched and quoted; nobody else sees them", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  const { alice, bob } = s.discord;
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] }).name = "salaries";
  const open = s.discord.channel("thread-pub", { thread: true, parentId: "channel-1" });
  await s.workspace.write(`${THREAD}/minutes/2026-10-14-salaries.md`, "Salary bands agreed\n");
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/lunch.md", "Salary day lunch\n");
  const ask = async (user: typeof alice, channel?: typeof open) => {
    s.model.script({ tool: "searchFiles", args: { query: "salary" } }, (turn) => JSON.stringify(turn.toolResults[0]));
    await s.discord.send(`${s.discord.mention} what do we have on salaries?`, { author: user, ...(channel && { channel }) });
    return JSON.parse(s.discord.botMessages.at(-1)!.content);
  };
  const lunch = { channel: "#general", matches: [{ path: "channel/notes/lunch.md", lines: [{ line: 1, text: "Salary day lunch" }] }] };
  const salaries = { channel: "#salaries", matches: [{ path: "channel/threads/thread-p/minutes/2026-10-14-salaries.md", lines: [{ line: 1, text: "Salary bands agreed" }] }] };
  expect(await ask(alice)).toEqual({ groups: [salaries, lunch], total: 2, leftOut: 0 });
  expect(await ask(alice, open)).toEqual({ groups: [salaries, lunch], total: 2, leftOut: 0 });
  expect(await ask(bob)).toEqual({ groups: [lunch], total: 1, leftOut: 0 });
});

discordScenario("inside a private thread a parent channel Document is kept as a Note in the thread's own folder", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  await s.workspace.write("guilds/guild-1/channels/channel-1/files/brief.txt", "Hiring brief\n");
  s.model.script({ tool: "keepAsNote", args: { document: "channel/files/brief.txt", path: "channel/notes/brief.md" } }, (turn) => turn.toolResults[0].error ?? turn.toolResults[0].path);
  await s.discord.send(`${s.discord.mention} keep the brief as a note`, { channel: thread });
  expect(s.discord.botMessages.at(-1)!.content).toBe("thread/notes/brief.md");
  expect(await s.workspace.read(`${THREAD}/notes/brief.md`)).toBe(`---\nsource: "channel/files/brief.txt"\naskedBy: "Alice"\ndate: "2026-10-15"\n---\nHiring brief\n`);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/notes")).toEqual([]);
});

discordScenario("inside a private thread a sibling private thread's files are only counted, even for someone added to both", async (s) => {
  await s.guildSettings({ language: "en" });
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  s.discord.channel("thread-q", { thread: true, private: true, parentId: "channel-1", members: [alice.id] }).name = "bonuses";
  const SIBLING = "guilds/guild-1/channels/channel-1/threads/thread-q";
  await s.workspace.write(`${SIBLING}/minutes/2026-10-13-bonus.md`, "Salary bonus pool\n");
  await s.workspace.write(`${THREAD}/notes/bands.md`, "Salary bands\n");
  s.model.script([
    { tool: "readFile", args: { path: "channel/threads/thread-q/minutes/2026-10-13-bonus.md" } },
    { tool: "readFile", args: { path: "channel/threads/thread-q/minutes/2026-10-12-nothing.md" } },
    { tool: "listFiles", args: { path: "channel/threads/thread-q/minutes" } },
    { tool: "readFile", args: { path: "<#thread-q>/minutes/2026-10-13-bonus.md" } },
    { tool: "listFiles", args: { path: "channel/threads" } },
    { tool: "searchFiles", args: { query: "salary", path: "channel" } },
    { tool: "searchFiles", args: { query: "salary" } },
  ], (turn) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r)));
  await s.discord.send(`${s.discord.mention} what do we have on salaries?`, { channel: thread });
  const said = s.discord.botMessages.at(-1)!.content;
  expect(said).not.toMatch(/bonus|thread-q/i);
  const refused = "Files from there cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.";
  const suggestion = "1 more matching file you can read cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.";
  const bands = { path: "thread/notes/bands.md", lines: [{ line: 1, text: "Salary bands" }] };
  expect(JSON.parse(said)).toEqual([
    refused, refused, refused, refused,
    { entries: [{ path: "channel/threads/thread-p", type: "dir" }] },
    { matches: [{ ...bands, path: "channel/threads/thread-p/notes/bands.md" }], notShownHere: 1, suggestion },
    { groups: [{ channel: "#thread-p", matches: [bands] }], total: 1, leftOut: 0, notShownHere: 1, suggestion },
  ]);
});
