import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("the turn that calls a tool sees its full result; later turns see a short form of it", async (s) => {
  const text = (m: { content: any }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
  await s.guildSettings({ useThreads: false });
  const body = `# Launch plan\nFULL-BODY-MARKER\n${"Every step of the launch, written out at length. ".repeat(200)}`;
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/launch.md", body);
  let live: any;
  s.model.script({ tool: "readFile", args: { path: "channel/notes/launch.md" } }, (turn) => { live = turn.toolResults[0]; return "read it"; }, "ok");
  await s.discord.send(`${s.discord.mention} read the launch plan`);
  await s.discord.send(`${s.discord.mention} thanks`);

  expect(live.content).toContain("FULL-BODY-MARKER");
  expect(live.content.length).toBeGreaterThan(9000);
  const rows = s.model.calls[2]!.filter((m) => m.role === "tool").map(text);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.length).toBeLessThan(1000);
  expect(rows[0]).not.toContain("FULL-BODY-MARKER");
  expect(rows[0]).toMatch(/^<untrusted_data source="tool:readFile[^"]*">/);
  expect(rows[0]).toContain('"success":true');
});

discordScenario("a stored task listing keeps each task's id and title, and a stored failure keeps its error", async (s) => {
  const text = (m: { content: any }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
  await s.guildSettings({ useThreads: false });
  const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const titles = ["Print the flyers", "Book the venue", "Order the badges"];
  for (const [i, title] of titles.entries()) {
    await s.workspace.write(`guilds/guild-1/channels/channel-1/tasks/task-${i + 1}.md`, `---\nid: "${id(i + 1)}"\ntitle: ${JSON.stringify(title)}\nstatus: "pending"\npriority: "medium"\nassignedTo: null\ndueAt: null\ncreatedBy: "user-bob"\ncreatedByName: "Bob"\ncreatedAt: "2026-10-01T00:00:0${i}.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n---\n${"Long background for this task. ".repeat(60)}\n`);
  }
  s.model.script([{ tool: "listTasks", args: {} }, { tool: "readFile", args: { path: "channel/notes/missing.md" } }], "listed", "ok");
  await s.discord.send(`${s.discord.mention} what tasks are open?`);
  await s.discord.send(`${s.discord.mention} move the venue one too`);

  const [listing, failure] = s.model.calls[2]!.filter((m) => m.role === "tool").map(text);
  expect(listing!.length).toBeLessThan(1000);
  expect(listing).toContain('"success":true');
  expect(listing).not.toContain("Long background");
  for (const [i, title] of titles.entries()) {
    expect(listing).toContain(id(i + 1));
    expect(listing).toContain(title);
  }
  expect(failure).toContain('"success":false');
  expect(failure).toContain("not found");
});

discordScenario("a turn with several tool calls leaves the earlier user turns in the window and replays only short tool rows", async (s) => {
  const text = (m: { content: any }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
  await s.guildSettings({ useThreads: false });
  s.discord.unlimited(s.discord.alice);
  for (let i = 1; i <= 5; i++) await s.workspace.write(`guilds/guild-1/channels/channel-1/notes/part-${i}.md`, `# Part ${i}\n${"A long section of the plan. ".repeat(300)}`);
  const reads = Array.from({ length: 5 }, (_, i) => ({ tool: "readFile", args: { path: `channel/notes/part-${i + 1}.md` } }));
  s.model.script("reply 1", "reply 2", "reply 3", reads, "read all five", "ok");
  for (let i = 1; i <= 3; i++) await s.discord.send(`${s.discord.mention} turn ${i}`);
  await s.discord.send(`${s.discord.mention} read all five parts`);
  await s.discord.send(`${s.discord.mention} and the first turn?`);

  const request = s.model.calls.at(-1)!;
  const all = request.map(text).join("\n");
  for (let i = 1; i <= 3; i++) expect(all).toContain(`turn ${i}`);
  const rows = request.filter((m) => m.role === "tool").map(text);
  expect(rows).toHaveLength(5);
  expect(rows.join("").length).toBeLessThan(5 * 1000);
});
