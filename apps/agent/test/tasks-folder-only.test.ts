import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const CHANNEL = "guilds/guild-1/channels/channel-1";
const task = (f: { id: string; title: string; status?: string; dueAt?: string | null }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: null\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\n`;
const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);
const digests = (s: any) => s.discord.botMessages.filter((m: any) => !m.reference && m.allowedMentions && !m.allowedMentions.users);
const day = (n: number) => new Date(Date.UTC(2025, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

discordScenario("a channel's Tasks stay listed, in the turn context and the Digest, beside 600 Notes and a flat folder of 501 Daily logs", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  for (let n = 0; n < 600; n++) await s.workspace.write(`${CHANNEL}/notes/batch-${Math.floor(n / 100)}/note-${n}.md`, `Note ${n}\n`);
  for (let n = 0; n < 501; n++) await s.workspace.write(`${CHANNEL}/daily-logs/${day(n)}.md`, `---\nkind: "daily-log"\n---\nDay ${n}\n`);
  // A Note whose head happens to read as a Task is a Note: only tasks/ holds Tasks.
  await s.workspace.write(`${CHANNEL}/notes/copied-task.md`, task({ id: "99999999-0000-4000-8000-000000000009", title: "Copied into a note" }));
  await s.workspace.write(`${CHANNEL}/tasks/invoice-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Send the invoice", dueAt: "2026-03-07" }));
  await s.workspace.write(`${CHANNEL}/tasks/room-bbbbbbbb.md`, task({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Book the room" }));
  await s.workspace.write(`${CHANNEL}/tasks/2026/q1/offsite-cccccccc.md`, task({ id: "cccccccc-0000-4000-8000-000000000003", title: "Plan the offsite" }));
  await s.guildSettings({ useThreads: false, digestChannels: [{ channelId: "channel-1", hour: 8 }] });

  s.model.script({ tool: "listTasks", args: {} }, (turn) => turn.toolResults[0].tasks.map((t: any) => t.title).sort().join(", ") || "none");
  await s.discord.send(`${s.discord.mention} what is open here?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Book the room, Plan the offsite, Send the invoice");
  const context = contextOf(s.model.calls.at(-2)!);
  expect(context).toContain("pending | due 2026-03-07 | unassigned | aaaaaaaa | Send the invoice");
  expect(context).toContain("pending | no due date | unassigned | bbbbbbbb | Book the room");
  expect(context).toContain("pending | no due date | unassigned | cccccccc | Plan the offsite");
  expect(context).not.toContain("Copied into a note");

  s.clock.set("2026-03-07T08:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s).map((m: any) => m.content)).toEqual([["**Jatuh tempo hari ini**", "pending | due 2026-03-07 | unassigned | aaaaaaaa | Send the invoice"].join("\n")]);
});

discordScenario("a tasks folder holding 520 completed Tasks still lists the one still open", async (s) => {
  for (let n = 0; n < 520; n++) {
    const id = `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
    await s.workspace.write(`${CHANNEL}/tasks/done-${n}-${id.slice(0, 8)}.md`, task({ id, title: `Finished ${n}`, status: "completed" }));
  }
  await s.workspace.write(`${CHANNEL}/tasks/venue-ffffffff.md`, task({ id: "ffffffff-0000-4000-8000-000000000001", title: "Call the venue" }));
  await s.guildSettings({ useThreads: false });

  s.model.script({ tool: "listTasks", args: { status: "pending" } }, (turn) => turn.toolResults[0].tasks.map((t: any) => t.title).join(", ") || "none");
  await s.discord.send(`${s.discord.mention} what is still pending?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Call the venue");
  expect(contextOf(s.model.calls.at(-2)!)).toContain("pending | no due date | unassigned | ffffffff | Call the venue");
});
