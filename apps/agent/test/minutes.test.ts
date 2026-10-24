import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("Write minutes on a message covers it and everything after it, posted as one embed replying in place", async (s) => {
  // Minutes are named by the date in Jakarta; a pinned clock keeps the run on one day.
  s.clock.set("2026-10-14T10:00:00+07:00");
  const { alice, bob } = s.discord;
  const minute = 60_000, now = s.clock.now();
  const [, start, , agreed] = s.discord.history([
    { content: "lunch at noon?", author: bob, at: now - 60 * minute },
    { content: "Which day do we release?", author: alice, at: now - 30 * minute },
    { content: "Friday works for me. Agreed?", author: bob, at: now - 20 * minute },
    { content: "Agreed, Friday. Bob writes the release notes by Thursday", author: alice, at: now - 10 * minute },
  ]);
  s.model.script(JSON.stringify({
    title: "Release day",
    decided: [{ text: "Release on Friday", ref: 3 }],
    open: [],
    actions: [{ owner: "Bob", task: "Write the release notes", due: "Thursday", ref: 3 }],
  }));
  await s.discord.contextMenu("Write minutes", start!);

  const sent = s.model.calls[0]!.map((m) => m.content).join("\n");
  expect(sent).toContain("Which day do we release?");
  expect(sent).toContain("Agreed, Friday.");
  expect(sent).not.toContain("lunch at noon?");

  const minutes = s.discord.botMessages.at(-1)!;
  expect(minutes).toMatchObject({ channelId: "channel-1", reference: { messageId: start!.id } });
  expect(start!.thread).toBeUndefined();
  expect(minutes.embeds).toHaveLength(1);
  const embed = minutes.embeds[0];
  expect(embed.title).toBe("Release day");
  expect(embed.description).toContain(`Release on Friday [↗](https://discord.com/channels/guild-1/channel-1/${agreed!.id})`);
  expect(embed.description).toMatch(/Bob.*Write the release notes.*Thursday/);
  expect(embed.description).toContain("Alice, Bob");

  const day = "2026-10-14";
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toEqual([`guilds/guild-1/channels/channel-1/minutes/${day}-release-day.md`]);
  expect(await s.workspace.read(`guilds/guild-1/channels/channel-1/minutes/${day}-release-day.md`)).toContain("Release on Friday");
});

discordScenario("any minutes trigger inside a thread covers the whole thread from its starter message", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now(), minute = 60_000;
  const [starter] = s.discord.history([{ content: "Should we move the standup to 10?", author: alice, at: now - 50 * minute }]);
  const thread = s.discord.channel(starter!.id, { thread: true, parentId: "channel-1", ownerId: alice.id });
  starter!.thread = thread;
  const [, middle] = s.discord.history([
    { content: "10 is fine by me", author: bob, at: now - 40 * minute },
    { content: "Same here, let's do 10", author: alice, at: now - 30 * minute },
    { content: "deploy finished", author: { id: "ci-bot", name: "CI", bot: true }, at: now - 20 * minute },
  ], { channel: thread });
  const minutes = JSON.stringify({ title: "Standup time", decided: [{ text: "Standup moves to 10", ref: 3 }], open: [], actions: [] });
  s.model.script(minutes, minutes);

  await s.discord.contextMenu("Write minutes", middle!);
  await s.discord.send(`${s.discord.mention} minutes`, { channel: thread });

  for (const call of s.model.calls) {
    const sent = call.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    expect(sent).toContain("Should we move the standup to 10?");
    expect(sent).toContain("10 is fine by me");
    expect(sent).not.toContain("deploy finished");
    expect(sent).not.toContain("bot-user> minutes");
  }
  expect(s.discord.botMessages.map((m) => m.channelId)).toEqual([thread.id, thread.id]);
  expect(s.discord.botMessages[0]!.embeds[0].description).toContain(`https://discord.com/channels/guild-1/${thread.id}/`);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toHaveLength(2);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads")).toEqual([]);
});

// A long discussion is read in parts of 500 messages and the parts joined, up to 2,000 messages (#246).
discordScenario("a range over 500 messages is read in parts of 500, each part's items keep their own links, and the parts are joined in order", async (s) => {
  const now = Date.now();
  const sent = s.discord.history(Array.from({ length: 520 }, (_, i) => ({ content: `point number ${i}`, at: now - (600 - i) * 1000 })));
  s.model.script(
    JSON.stringify({ title: "Long talk", decided: [{ text: "Ship on Friday", ref: 3 }], open: [{ text: "Nothing settled", ref: 1 }], actions: [] }),
    JSON.stringify({ title: "Long talk, part two", decided: [{ text: "Ship on Friday", ref: 2 }], open: [], actions: [{ owner: null, task: "Write the notes", due: null, ref: 20 }] }),
  );
  await s.discord.contextMenu("Write minutes", sent[0]!);

  const first = s.model.calls[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const second = s.model.calls[1]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(first).toContain("part 1 of 2 (messages 1-500 of 520)");
  expect(first).toContain("point number 0\n");
  expect(first).toContain("point number 499");
  expect(second).toContain("part 2 of 2 (messages 501-520 of 520)");
  expect(second).toContain("point number 519");
  const description = s.discord.botMessages[0]!.embeds[0].description as string;
  expect(description).not.toContain("Cut to the latest");
  expect(description).toContain(`1. Ship on Friday [↗](https://discord.com/channels/guild-1/channel-1/${sent[2]!.id})`);
  expect(description).not.toContain(sent[501]!.id);
  expect(description).toContain(`3. *no owner yet*: Write the notes [↗](https://discord.com/channels/guild-1/channel-1/${sent[519]!.id})`);
});

discordScenario("a range over 2,000 messages keeps the latest 2,000, in at most 20 reads, and says what was cut", async (s) => {
  const now = Date.now();
  const sent = s.discord.history(Array.from({ length: 2010 }, (_, i) => ({ content: `point number ${i}`, at: now - (3000 - i) * 1000 })));
  const part = JSON.stringify({ title: "Very long talk", decided: [], open: [{ text: "Nothing settled", ref: 1 }], actions: [] });
  s.model.script(part, part, part, part);
  await s.discord.contextMenu("Write minutes", sent[0]!);
  expect(s.model.calls).toHaveLength(4);
  expect(s.discord.channel("channel-1").fetches).toBeLessThanOrEqual(20);
  const description = s.discord.botMessages[0]!.embeds[0].description as string;
  expect(description).toContain("Cut to the latest 2000 messages");
  expect(description).toContain(`https://discord.com/channels/guild-1/channel-1/${sent[10]!.id}`);
});

discordScenario("a thread longer than 24 hours keeps the last 24 hours and says what was cut", async (s) => {
  const now = Date.now(), hour = 3600_000;
  const thread = s.discord.channel("thread-old", { thread: true, parentId: "channel-1", ownerId: s.discord.alice.id });
  s.discord.history([
    { content: "kickoff two days ago", at: now - 48 * hour },
    { content: "today we settled on Redis", at: now - 2 * hour },
  ], { channel: thread });
  s.model.script(JSON.stringify({ title: "Cache", decided: [{ text: "Use Redis", ref: 1 }], open: [], actions: [] }));
  await s.discord.send(`${s.discord.mention} minutes`, { channel: thread });

  const transcript = s.model.calls[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(transcript).toContain("today we settled on Redis");
  expect(transcript).not.toContain("kickoff two days ago");
  expect(s.discord.botMessages[0]!.embeds[0].description).toContain("Cut to the last 24 hours");
  expect(await s.workspace.read((await s.workspace.list("guilds/guild-1/channels/channel-1/minutes"))[0]!)).toContain("Cut to the last 24 hours");
});

discordScenario("@bot minutes in a channel covers the last 3 hours and replies to the mention", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now(), hour = 3600_000;
  s.discord.history([
    { content: "yesterday's topic", author: bob, at: now - 4 * hour },
    { content: "We keep Postgres, agreed", author: alice, at: now - 2 * hour },
    { content: "Agreed", author: bob, at: now - hour },
  ]);
  s.model.script(JSON.stringify({ title: "Database", decided: [{ text: "Keep Postgres", ref: 2 }], open: [], actions: [] }));
  const ask = await s.discord.send(`${s.discord.mention} minutes`);

  const sent = s.model.calls[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(sent).toContain("We keep Postgres, agreed");
  expect(sent).not.toContain("yesterday's topic");
  expect(ask.thread).toBeUndefined();
  expect(s.discord.botMessages).toHaveLength(1);
  expect(s.discord.botMessages[0]).toMatchObject({ channelId: "channel-1", reference: { messageId: ask.id } });
  expect(s.discord.botMessages[0]!.embeds[0].title).toBe("Database");
});

discordScenario("@bot notulen in a channel writes the minutes as @bot minutes does, with or without a title after it", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now(), hour = 3600_000;
  s.discord.history([
    { content: "Kita tetap pakai Postgres, sepakat", author: alice, at: now - 2 * hour },
    { content: "Sepakat", author: bob, at: now - hour },
  ]);
  const minutes = JSON.stringify({ title: "Database", decided: [{ text: "Tetap pakai Postgres", ref: 1 }], open: [], actions: [] });
  s.model.script(minutes, minutes);
  const ask = await s.discord.send(`${s.discord.mention} notulen`);
  await s.discord.send(`${s.discord.mention} notulen: rapat sprint`);

  expect(s.model.calls).toHaveLength(2);
  for (const call of s.model.calls) expect(call.filter((m) => m.role === "user").map((m) => m.content).join("\n")).toContain("Kita tetap pakai Postgres, sepakat");
  expect(s.discord.botMessages).toHaveLength(2);
  expect(s.discord.botMessages[0]).toMatchObject({ channelId: "channel-1", reference: { messageId: ask.id } });
  expect(s.discord.botMessages.map((m) => m.embeds[0].title)).toEqual(["Database", "Database"]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toHaveLength(2);
});

discordScenario("\"@bot notulen dong\" and \"@bot tolong bikinin notulen ya!\" write the minutes; a question naming notulen goes to the assistant (#245)", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now(), hour = 3600_000;
  s.discord.history([
    { content: "Kita tetap pakai Postgres, sepakat", author: alice, at: now - 2 * hour },
    { content: "Sepakat", author: bob, at: now - hour },
  ]);
  const minutes = JSON.stringify({ title: "Database", decided: [{ text: "Tetap pakai Postgres", ref: 1 }], open: [], actions: [] });
  s.model.script(minutes, minutes, "Belum ada notulen rapat vendor yang tersimpan.");
  await s.discord.send(`${s.discord.mention} notulen dong`);
  await s.discord.send(`${s.discord.mention} tolong bikinin notulen ya!`);
  await s.discord.send(`${s.discord.mention} notulen rapat vendor kemarin di mana?`);
  expect(s.discord.botMessages.map((m) => m.embeds?.[0]?.title ?? m.content)).toEqual(["Database", "Database", "Belum ada notulen rapat vendor yang tersimpan."]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toHaveLength(2);
});

discordScenario("Minutes written at 23:30 UTC are named by the date in the place's zone, Jakarta's next morning", async (s) => {
  const { alice, bob } = s.discord;
  s.clock.set("2026-03-06T23:30:00Z");
  s.discord.history([
    { content: "We keep Postgres, agreed", author: alice, at: Date.parse("2026-03-06T22:00:00Z") },
    { content: "Agreed", author: bob, at: Date.parse("2026-03-06T22:30:00Z") },
  ]);
  s.model.script(JSON.stringify({ title: "Database", decided: [{ text: "Keep Postgres", ref: 1 }], open: [], actions: [] }));
  await s.discord.send(`${s.discord.mention} minutes`);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toEqual(["guilds/guild-1/channels/channel-1/minutes/2026-03-07-database.md"]);
});

discordScenario("every item links to its source message and owners appear only when the discussion named them", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now();
  const [ask, answer] = s.discord.history([
    { content: "Who updates the runbook? Bob, can you take it?", author: alice, at: now - 120_000 },
    { content: "Sure. Someone should also email the vendor", author: bob, at: now - 60_000 },
  ]);
  s.model.script(JSON.stringify({
    title: "Runbook",
    decided: [{ text: "A decision with no source" }, { text: "Made-up decision", ref: 99 }],
    open: [],
    actions: [
      { owner: "Bob", task: "Update the runbook", due: null, ref: 1 },
      { owner: "Dave", task: "Email the vendor", due: null, ref: 2 },
    ],
  }));
  await s.discord.contextMenu("Write minutes", ask!);

  const description: string = s.discord.botMessages[0]!.embeds[0].description;
  expect(description).not.toContain("A decision with no source");
  expect(description).not.toContain("Made-up decision");
  expect(description).toContain(`**Bob**: Update the runbook [↗](https://discord.com/channels/guild-1/channel-1/${ask!.id})`);
  expect(description).toContain(`*no owner yet*: Email the vendor [↗](https://discord.com/channels/guild-1/channel-1/${answer!.id})`);
  expect(description).not.toContain("Dave");
  for (const line of description.split("\n").filter((l) => /^\d+\. /.test(l))) expect(line).toMatch(/\[↗\]\(https:\/\/discord\.com\/channels\/guild-1\/channel-1\/\d+\)$/);
});

discordScenario("minutes too long for one embed post Decided and Action items, with the whole text as minutes.md", async (s) => {
  const now = Date.now();
  s.discord.history([{ content: "Long planning session starts", at: now - 120_000 }, { content: "Many open points", at: now - 60_000 }]);
  const open = Array.from({ length: 40 }, (_, i) => ({ text: `Open question ${i} ${"about the migration plan and its rollout ".repeat(3)}`, ref: 2 }));
  s.model.script(JSON.stringify({ title: "Planning", decided: [{ text: "Freeze the schema", ref: 1 }], open, actions: [{ owner: null, task: "Write the migration", ref: 2 }] }));
  await s.discord.send(`${s.discord.mention} minutes`);

  const posted = s.discord.botMessages[0]!;
  const description: string = posted.embeds[0].description;
  expect(description.length).toBeLessThanOrEqual(4096);
  expect(description).toContain("Freeze the schema");
  expect(description).toContain("Write the migration");
  expect(description).not.toContain("Open question 0");
  expect(posted.files.map((f: any) => f.name)).toEqual(["minutes.md"]);
  const file = posted.files[0].attachment.toString();
  expect(file).toContain("Open question 39");
  expect(file).toContain("Freeze the schema");
});

discordScenario("the requester's reply corrects the minutes in place; anyone else's is recorded as input", async (s) => {
  s.clock.set("2026-10-14T10:00:00+07:00");
  const { alice, bob } = s.discord;
  const now = s.clock.now();
  const [start, agreed] = s.discord.history([
    { content: "Release Friday?", author: alice, at: now - 120_000 },
    { content: "Friday, agreed", author: bob, at: now - 60_000 },
  ]);
  s.model.script(JSON.stringify({ title: "Release day", decided: [{ text: "Release on Friday", ref: 2 }], open: [], actions: [] }));
  await s.discord.contextMenu("Write minutes", start!);
  const minutes = s.discord.botMessages[0]!;
  const file = "guilds/guild-1/channels/channel-1/minutes/2026-10-14-release-day.md";

  const other = await s.discord.send("point 1 was not decided", { author: bob, replyTo: minutes });
  expect(minutes.edits).toEqual([]);
  expect(other.reactions).toEqual(["👀"]);
  expect(await s.workspace.read(file)).toContain("point 1 was not decided");
  expect(s.model.calls).toHaveLength(1);

  s.model.script(JSON.stringify({ title: "Release day", decided: [], open: [{ text: "Release on Friday, not yet confirmed", ref: 1 }], actions: [] }));
  const fix = await s.discord.send("point 1 was not decided, it is still open", { author: alice, replyTo: minutes });
  expect(s.model.calls[1]!.map((m) => m.content).join("\n")).toContain("point 1 was not decided, it is still open");
  expect(minutes.edits).toHaveLength(1);
  expect(minutes.embeds[0].description).toMatch(/\*\*Still open\*\*\n1\. Release on Friday, not yet confirmed \[↗\]/);
  expect(minutes.embeds[0].description).toContain(`https://discord.com/channels/guild-1/channel-1/${agreed!.id}`);
  expect(s.discord.botMessages).toHaveLength(1);
  expect(fix.reactions).toEqual(["✅"]);
  const stored = (await s.workspace.read(file))!;
  expect(stored).toContain("Release on Friday, not yet confirmed");
  expect(stored).toMatch(/## Decided\n\*None\*/);
});

discordScenario("the requester's reply asking for something other than a correction leaves the minutes alone and goes to the assistant, which sees them (#245)", async (s) => {
  s.clock.set("2026-10-14T10:00:00+07:00");
  const { alice, bob } = s.discord;
  const now = s.clock.now();
  const [start] = s.discord.history([
    { content: "Release Friday? Bob, can you book the venue?", author: alice, at: now - 120_000 },
    { content: "Friday, agreed. I'll book it", author: bob, at: now - 60_000 },
  ]);
  s.model.script(JSON.stringify({ title: "Release day", decided: [{ text: "Release on Friday", ref: 2 }], open: [], actions: [{ owner: "Bob", task: "Book the venue", due: null, ref: 2 }] }));
  await s.discord.contextMenu("Write minutes", start!);
  const minutes = s.discord.botMessages[0]!, before = structuredClone(minutes.embeds);
  const file = "guilds/guild-1/channels/channel-1/minutes/2026-10-14-release-day.md", stored = await s.workspace.read(file);

  // A request for tasks goes straight to tasksFromMinutes (#253); a question is still the assistant's.
  s.model.script(JSON.stringify({ notACorrection: true }), "Mau saya buatkan tugas Book the venue untuk Bob?");
  const ask = await s.discord.send(`${s.discord.mention} poin 2 sudah ada yang pegang belum?`, { author: alice, replyTo: minutes });
  expect(s.model.calls[1]!.map((m) => m.content).join("\n")).toContain("poin 2 sudah ada yang pegang belum?");
  expect(minutes.edits).toEqual([]);
  expect(minutes.embeds).toEqual(before);
  expect(await s.workspace.read(file)).toBe(stored);
  expect(ask.reactions).not.toContain("✅");
  const turn = String(s.model.calls[2]!.at(-2)!.content);
  expect(turn).toStartWith('(replying to you: "Release day ');
  expect(turn).toContain("**Decided** 1. Release on Friday");
  expect(turn).toContain("2. **Bob**: Book the venue");
  expect(s.discord.botMessages.at(-1)!.content).toBe("Mau saya buatkan tugas Book the venue untuk Bob?");
});

discordScenario("a requester who cannot read the history gets a refusal naming why, and no minutes", async (s) => {
  const { alice, bob } = s.discord;
  const [start] = s.discord.history([{ content: "We ship Friday, agreed", author: alice, at: Date.now() - 60_000 }]);
  s.discord.deny("channel-1", bob.id, ["ReadMessageHistory"]);
  const run = await s.discord.contextMenu("Write minutes", start!, { user: bob });
  expect(run.responses).toEqual([{ kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) }, { kind: "editReply", payload: expect.objectContaining({ content: expect.stringContaining("Read Message History") }) }]);

  const secret = s.discord.channel("thread-private", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  const [inside] = s.discord.history([{ content: "salary talk", author: alice, at: Date.now() - 60_000 }], { channel: secret });
  const denied = await s.discord.contextMenu("Write minutes", inside!, { user: { id: "user-carol", name: "Carol" } });
  expect(denied.responses).toEqual([{ kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) }, { kind: "editReply", payload: expect.objectContaining({ content: expect.stringContaining("private thread") }) }]);

  expect(s.discord.botMessages).toEqual([]);
  expect(s.model.calls).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes").catch(() => [])).toEqual([]);
});

discordScenario("a bot missing a permission names it instead of posting empty minutes", async (s) => {
  s.discord.history([{ content: "We ship Friday, agreed", at: Date.now() - 60_000 }]);
  s.discord.deny("channel-1", s.discord.botUserId, ["ReadMessageHistory"]);
  await s.discord.send(`${s.discord.mention} minutes`);
  expect(s.discord.botMessages.map((m) => [m.content, m.embeds.length])).toEqual([[expect.stringContaining("missing the Read Message History permission"), 0]]);
  expect(s.model.calls).toEqual([]);
});

discordScenario("minutes are refused in DMs", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true });
  await s.discord.send(`${s.discord.mention} minutes`, { channel: dm });
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringContaining("not in DMs")]);
  expect(s.model.calls).toEqual([]);
});

discordScenario("/minutes in a channel posts minutes of its recent history there, with no thread or binding", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now(), hour = 3600_000;
  s.discord.history([
    { content: "yesterday's topic", author: bob, at: now - 4 * hour },
    { content: "We keep Postgres, agreed", author: alice, at: now - 2 * hour },
    { content: "Agreed", author: bob, at: now - hour },
  ]);
  s.model.script(JSON.stringify({ title: "Database", decided: [{ text: "Keep Postgres", ref: 2 }], open: [], actions: [] }));
  const run = await s.discord.slash("minutes");

  const sent = s.model.calls[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(sent).toContain("We keep Postgres, agreed");
  expect(sent).not.toContain("yesterday's topic");
  expect(s.discord.botMessages).toHaveLength(1);
  expect(s.discord.botMessages[0]).toMatchObject({ channelId: "channel-1" });
  expect(s.discord.botMessages[0]!.thread).toBeUndefined();
  expect(s.discord.botMessages[0]!.embeds[0].title).toBe("Database");
  expect(run.responses).toEqual([
    { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
    { kind: "editReply", payload: expect.objectContaining({ content: "Writing minutes of the last 3 hours here." }) },
  ]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toHaveLength(1);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads").catch(() => [])).toEqual([]);
});

discordScenario("/minutes inside a thread covers the whole thread and posts there", async (s) => {
  const { alice, bob } = s.discord;
  const now = Date.now(), hour = 3600_000;
  s.discord.history([{ content: "channel chatter outside the thread", author: bob, at: now - hour }]);
  const [starter] = s.discord.history([{ content: "Should we move the standup to 10?", author: alice, at: now - 5 * hour }]);
  const thread = s.discord.channel(starter!.id, { thread: true, parentId: "channel-1", ownerId: alice.id });
  starter!.thread = thread;
  s.discord.history([{ content: "10 is fine by me", author: bob, at: now - 4 * hour }], { channel: thread });
  s.model.script(JSON.stringify({ title: "Standup time", decided: [{ text: "Standup moves to 10", ref: 2 }], open: [], actions: [] }));
  const run = await s.discord.slash("minutes", { channel: thread });

  const sent = s.model.calls[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(sent).toContain("Should we move the standup to 10?");
  expect(sent).toContain("10 is fine by me");
  expect(sent).not.toContain("channel chatter outside the thread");
  expect(s.discord.botMessages.map((m) => m.channelId)).toEqual([thread.id]);
  expect(run.responses.at(-1)).toEqual({ kind: "editReply", payload: expect.objectContaining({ content: "Writing minutes of this whole thread." }) });
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toHaveLength(1);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads").catch(() => [])).toEqual([]);
});

discordScenario("/minutes refusals stay private: history the person cannot read, or minutes off here", async (s) => {
  const { alice, bob } = s.discord;
  s.discord.history([{ content: "We ship Friday, agreed", author: alice, at: Date.now() - 60_000 }]);
  s.discord.deny("channel-1", bob.id, ["ReadMessageHistory"]);
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "playbook", name: "minutes", value: "off" });
  s.discord.history([{ content: "We ship Monday, agreed", author: alice, at: Date.now() - 60_000 }], { channel: "channel-2" });

  const unreadable = await s.discord.slash("minutes", { user: bob });
  const off = await s.discord.slash("minutes", { channel: "channel-2" });

  expect(unreadable.responses).toEqual([{ kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) }, { kind: "editReply", payload: expect.objectContaining({ content: expect.stringContaining("Read Message History") }) }]);
  expect(off.responses).toEqual([{ kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) }, { kind: "editReply", payload: expect.objectContaining({ content: "The minutes playbook is off here. An admin can turn it on in the console." }) }]);
  expect(s.discord.botMessages).toEqual([]);
  expect(s.model.calls).toEqual([]);
});
