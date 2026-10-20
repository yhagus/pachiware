import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const task = (f: { id: string; title: string; status?: string; assignedTo?: string | { id: string; name: string } | null; dueAt?: string | null; createdBy: string; createdByName: string }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: ${JSON.stringify(f.assignedTo ?? null)}\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "${f.createdBy}"\ncreatedByName: "${f.createdByName}"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\n`;

discordScenario("a DM Reminder with withTasks appends the owner's open Personal tasks under their own heading, assigned by id or by name, in the task list format, and not another person's", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  const dm = s.discord.channel("dm-alice", { dm: true }), alice = s.discord.alice, bob = s.discord.bob;
  s.model.script({ tool: "createTask", args: { title: "Pay the rent", dueAt: "2026-03-07" } }, "Filed.");
  await s.discord.send("task: pay the rent, due tomorrow", { channel: dm });
  s.model.script({ tool: "createTask", args: { title: "Call the dentist", assignedTo: "Alice" } }, "Filed.");
  await s.discord.send("task: call the dentist", { channel: dm });
  await s.workspace.write(`dms/${bob.id}/tasks/bobs-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Bob's errand", assignedTo: "Bob", createdBy: bob.id, createdByName: bob.name }));
  await s.workspace.write(`dms/${alice.id}/tasks/handover-dddddddd.md`, task({ id: "dddddddd-0000-4000-8000-000000000004", title: "Take the handover", assignedTo: { id: alice.id, name: "Ali" }, dueAt: "2026-03-08", createdBy: bob.id, createdByName: bob.name }));
  await s.workspace.write(`dms/${alice.id}/tasks/done-bbbbbbbb.md`, task({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Already done", status: "completed", createdBy: alice.id, createdByName: alice.name }));
  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/channel-cccccccc.md", task({ id: "cccccccc-0000-4000-8000-000000000003", title: "Channel work", createdBy: alice.id, createdByName: alice.name }));
  const files = await s.workspace.list(`dms/${alice.id}/tasks`);
  const idOf = (slug: string) => /-([0-9a-f]{8})\.md$/.exec(files.find((p) => p.includes(`/${slug}-`))!)![1];
  const rent = idOf("pay-the-rent"), dentist = idOf("call-the-dentist");

  s.model.script({ tool: "createReminder", args: { text: "morning overview", said: ["once at 07:00"], recurrence: "once", at: "07:00", withTasks: true } }, (turn) => `set ${turn.toolResults[0].withTasks}`);
  await s.discord.send("remind me once at 07:00 with my tasks", { channel: dm });
  expect(s.discord.botMessages.at(-1)!.content).toBe("set true");

  s.clock.set("2026-03-07T07:00:00+07:00");
  await s.scheduler.tick();
  const post = s.discord.botMessages.at(-1)!;
  expect(post.channelId).toBe(dm.id);
  expect(post.allowedMentions).toEqual({ users: [alice.id] });
  expect(post.content).toBe([
    `<@${alice.id}> Pengingat: morning overview`,
    "Tugas terbuka (status | due | assignee | id | title):",
    "Tugas pribadi",
    `pending | due 2026-03-07 | unassigned | ${rent} | Pay the rent`,
    "pending | due 2026-03-08 | Ali | dddddddd | Take the handover",
    `pending | no due date | Alice | ${dentist} | Call the dentist`,
  ].join("\n"));
});

discordScenario("a Reminder with withTasks and no open task of the owner posts its text alone", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  const dm = s.discord.channel("dm-alice", { dm: true }), alice = s.discord.alice, bob = s.discord.bob;
  await s.workspace.write(`dms/${bob.id}/tasks/bobs-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Bob's errand", createdBy: bob.id, createdByName: bob.name }));
  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/channel-cccccccc.md", task({ id: "cccccccc-0000-4000-8000-000000000003", title: "Bob's channel work", assignedTo: { id: bob.id, name: "Bob" }, createdBy: alice.id, createdByName: alice.name }));
  s.model.script({ tool: "createReminder", args: { text: "morning overview", said: ["once at 07:00"], recurrence: "once", at: "07:00", withTasks: true } }, "set");
  await s.discord.send("remind me once at 07:00 with my tasks", { channel: dm });
  s.clock.set("2026-03-07T07:00:00+07:00");
  await s.scheduler.tick();
  expect(s.discord.botMessages.at(-1)!.content).toBe(`<@${alice.id}> Pengingat: morning overview`);
});
