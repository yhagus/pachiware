import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const task = (f: { id: string; title: string; status?: string; assignedTo?: string | null; dueAt?: string | null }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: ${JSON.stringify(f.assignedTo ?? null)}\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\n`;
/** Posts the scheduler made on its own: not a reply, and nobody pinged. */
const digests = (s: any) => s.discord.botMessages.filter((m: any) => !m.reference && m.allowedMentions && !m.allowedMentions.users);

discordScenario("the Digest posts the channel's tasks due today and late at the chosen hour, without pings, until they are completed", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  const folder = "guilds/guild-1/channels/channel-1/tasks";
  await s.workspace.write(`${folder}/today-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Send the invoice", assignedTo: "Alice", dueAt: "2026-03-07" }));
  await s.workspace.write(`${folder}/yesterday-bbbbbbbb.md`, task({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Book the room", dueAt: "2026-03-06" }));
  await s.workspace.write(`${folder}/next-week-cccccccc.md`, task({ id: "cccccccc-0000-4000-8000-000000000003", title: "Plan the offsite", dueAt: "2026-03-14" }));
  await s.workspace.write(`${folder}/undated-dddddddd.md`, task({ id: "dddddddd-0000-4000-8000-000000000004", title: "Tidy the drive" }));
  await s.workspace.write(`${folder}/done-eeeeeeee.md`, task({ id: "eeeeeeee-0000-4000-8000-000000000005", title: "Already finished", status: "completed", dueAt: "2026-03-05" }));
  await s.workspace.write("guilds/guild-1/channels/channel-2/tasks/other-ffffffff.md", task({ id: "ffffffff-0000-4000-8000-000000000006", title: "Another channel's", dueAt: "2026-03-07" }));
  await s.workspace.write("guilds/guild-1/shared/tasks/guild-99999999.md", task({ id: "99999999-0000-4000-8000-000000000007", title: "Guild-wide", dueAt: "2026-03-07" }));
  s.discord.channel("channel-2");
  s.discord.channel("channel-3");
  await s.guildSettings({ useThreads: false, digestChannels: [{ channelId: "channel-1", hour: 8 }, { channelId: "channel-3", hour: 8 }] });

  s.clock.set("2026-03-07T07:59:00+07:00");
  await s.scheduler.tick();
  expect(digests(s)).toHaveLength(0);

  s.clock.set("2026-03-07T08:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s)).toHaveLength(1);
  const first = digests(s)[0];
  expect(first.channelId).toBe("channel-1");
  expect(first.allowedMentions).toEqual({ parse: [] });
  expect(first.content).toBe([
    "**Jatuh tempo hari ini**",
    "pending | due 2026-03-07 | Alice | aaaaaaaa | Send the invoice",
    "**Terlambat**",
    "pending | due 2026-03-06, late | unassigned | bbbbbbbb | Book the room · terlambat 1 hari",
  ].join("\n"));

  s.clock.set("2026-03-08T08:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s)).toHaveLength(2);
  expect(digests(s)[1].content).toBe([
    "**Terlambat**",
    "pending | due 2026-03-06, late | unassigned | bbbbbbbb | Book the room · terlambat 2 hari",
    "pending | due 2026-03-07, late | Alice | aaaaaaaa | Send the invoice · terlambat 1 hari",
  ].join("\n"));

  s.model.script({ tool: "updateTaskStatus", args: { taskId: "bbbbbbbb", status: "completed" } }, "Done.");
  await s.discord.send(`${s.discord.mention} the room is booked`);
  s.clock.set("2026-03-09T08:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s)).toHaveLength(3);
  expect(digests(s)[2].content).toBe([
    "**Terlambat**",
    "pending | due 2026-03-07, late | Alice | aaaaaaaa | Send the invoice · terlambat 2 hari",
  ].join("\n"));
});

discordScenario("a Digest in English posts its sections in English and skips a day with nothing to report", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  await s.guildSettings({ language: "en", digestChannels: [{ channelId: "channel-1", hour: 9 }] });
  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/later-aaaaaaaa.md", task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Renew the domain", dueAt: "2026-03-20" }));
  s.clock.set("2026-03-07T09:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s)).toHaveLength(0);

  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/timed-bbbbbbbb.md", task({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Call the venue", assignedTo: "Bob", dueAt: "2026-03-08T07:30:00+07:00" }));
  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/old-cccccccc.md", task({ id: "cccccccc-0000-4000-8000-000000000003", title: "File the report", dueAt: "2026-02-28" }));
  s.clock.set("2026-03-08T09:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s)).toHaveLength(1);
  expect(digests(s)[0].content).toBe([
    "**Due today**",
    "pending | due 2026-03-08T07:30:00+07:00, late | Bob | bbbbbbbb | Call the venue",
    "**Late**",
    "pending | due 2026-02-28, late | unassigned | cccccccc | File the report · 8 days late",
  ].join("\n"));
});

discordScenario("a Digest whose channel is gone keeps its row for the next day, with the error recorded", async (s) => {
  const { repositories } = await import("@pachiware/db");
  s.clock.set("2026-03-06T20:00:00+07:00");
  await s.guildSettings({ digestChannels: [{ channelId: "channel-9", hour: 8 }] });
  for (const time of ["08:00:30", "08:01:30", "08:06:30", "08:36:30"]) { s.clock.set(`2026-03-07T${time}+07:00`); await s.scheduler.tick(); }
  const [row] = (await repositories().schedules.list()).filter((r: any) => r.kind === "digest");
  expect([row!.status, row!.attempts, row!.nextAt.toISOString(), row!.error]).toEqual(["active", 0, "2026-03-08T01:00:00.000Z", "Could not post after 4 attempts: The channel is gone or cannot be posted in."]);
});
