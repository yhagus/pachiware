import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { lastReply } from "./support/lastReply";

// 2026-10-14 is a Wednesday. The guild's language is Indonesian and its zone Jakarta (WIB, +07:00).

discordScenario("a Routine is set from the asker's words, with its card saying it reads only, and is listed and cancelled beside Reminders", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  s.model.script(
    { tool: "createRoutine", args: { instruction: "Simpulkan tugasku untuk hari ini", said: ["setiap jam 9 pagi WIB"], recurrence: "daily", time: "09:00" } },
    (turn) => `Siap, ${turn.toolResults[0].kind} ${turn.toolResults[0].at}`,
  );
  const ask = await s.discord.send(`${s.discord.mention} Simpulkan tugasku untuk hari ini setiap jam 9 pagi WIB ya`);
  expect(lastReply(s).content).toBe("Siap, routine 2026-10-14T09:00:00+07:00");
  const [row] = await repositories().schedules.list();
  expect([row!.kind, row!.text, row!.recurrence, row!.timeOfDay, row!.ownerId, row!.channelId, row!.withTasks]).toEqual(["routine", "Simpulkan tugasku untuk hari ini", "daily", "09:00", s.discord.alice.id, ask.thread!.id, false]);

  const card = s.discord.botMessages.at(-1)!.embeds[0];
  expect(card.title).toBe("🔁 Rutinitas dipasang");
  expect(card.description).toBe("> Simpulkan tugasku untuk hari ini");
  expect(card.fields.filter((f: any) => ["Jadwal", "Akses"].includes(f.name))).toEqual([
    { name: "Jadwal", value: "Setiap hari, 09:00 WIB" },
    { name: "Akses", value: "hanya membaca: mencari dan melaporkan, tidak mengubah apa pun" },
  ]);

  s.model.script({ tool: "createReminder", args: { text: "cek invoice", said: ["besok jam 10 pagi"], recurrence: "once", at: "2026-10-15T10:00" } }, "ok");
  await s.discord.send("ingatkan besok jam 10 pagi cek invoice", { channel: ask.thread! });
  s.model.script({ tool: "listReminders", args: {} }, (turn) => JSON.stringify(turn.toolResults[0].reminders.map((r: any) => [r.kind, r.text])));
  await s.discord.send("jadwalku apa saja?", { channel: ask.thread! });
  expect(JSON.parse(lastReply(s).content)).toEqual([["routine", "Simpulkan tugasku untuk hari ini"], ["reminder", "cek invoice"]]);

  s.model.script({ tool: "cancelReminder", args: { id: row!.id } }, (turn) => `cancelled ${turn.toolResults[0].cancelled}`);
  await s.discord.send("batalkan rutinitas itu", { channel: ask.thread! });
  expect(lastReply(s).content).toBe("cancelled true");
  expect((await repositories().schedules.get(row!.id))!.status).toBe("cancelled");
});

discordScenario("a person keeps at most 10 active Routines, apart from their Reminders, refused in the place's language", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  const { schedules } = repositories();
  const add = (kind: "reminder" | "routine", n: number) => Promise.all([...Array(n)].map((_, i) => schedules.create({
    tenantId: s.tenant.id, botId: s.bot.id, kind, guildId: "guild-1", channelId: "channel-1", ownerId: s.discord.alice.id, text: `${kind} ${i}`, recurrence: "daily", timeOfDay: "09:00", timezone: "Asia/Jakarta", nextAt: new Date("2026-10-15T02:00:00Z"),
  })));
  await add("routine", 9);
  await add("reminder", 20);
  const set = () => {
    s.model.script({ tool: "createRoutine", args: { instruction: "rangkum progres", said: ["tiap Jumat jam 4 sore"], recurrence: "weekly", weekdays: ["friday"], time: "16:00" } }, (turn) => turn.toolResults[0].error ?? "set");
    return s.discord.send(`${s.discord.mention} rangkum progres tiap Jumat jam 4 sore`).then(() => lastReply(s).content);
  };
  expect(await set()).toBe("set");
  expect(await set()).toBe("Kamu sudah punya 10 rutinitas aktif, batas untuk satu orang. Batalkan satu dulu sebelum membuat yang baru.");
  expect(await schedules.count({ kind: "routine", status: "active" })).toBe(10);
});

/** A Routine row as createRoutine stores it: Alice's, in channel-2 of guild-1, daily at 09:00 in Jakarta, first due at `nextAt`. */
const routineRow = async (s: any, text: string, nextAt: string) => {
  const { repositories } = await import("@pachiware/db");
  s.discord.channel("channel-2");
  return repositories().schedules.create({
    tenantId: s.tenant.id, botId: s.bot.id, kind: "routine", guildId: "guild-1", channelId: "channel-2", ownerId: s.discord.alice.id, ownerName: "Alice", text,
    recurrence: "daily", timeOfDay: "09:00", timezone: "Asia/Jakarta", nextAt: new Date(nextAt),
  });
};

discordScenario("at its time a Routine runs as its owner with tools that read only, and its report is posted with a ping; the row moves on", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  const row = await routineRow(s, "Simpulkan tugasku untuk hari ini", "2026-10-14T09:00:00+07:00");
  s.model.script(
    { tool: "createTask", args: { title: "should not be made" } },
    { tool: "listTasks", args: { scope: "mine" } },
    (turn) => `Tugasmu hari ini: ${turn.toolResults[1].tasks?.length ?? 0} tugas. (${turn.toolResults[0].error})`,
  );
  s.clock.set("2026-10-14T09:00:10+07:00");
  await s.scheduler.tick();

  const post = s.discord.botMessages.at(-1)!;
  expect(post.channelId).toBe("channel-2");
  expect(post.content).toBe(`<@${s.discord.alice.id}> 🔁 Rutinitas: Simpulkan tugasku untuk hari ini\nTugasmu hari ini: 0 tugas. (Not run: a Routine only reads, so nothing was changed. Report what you found, and what its owner could do themselves.)`);
  expect(post.allowedMentions).toEqual({ users: [s.discord.alice.id] });

  // The turn is the owner's own words, framed as a Routine, offered only tools that read, and a write named anyway is refused.
  const request = s.model.calls.at(-1)!.map((m) => String(m.content));
  expect(request).toContain(`Alice (<@${s.discord.alice.id}>): Simpulkan tugasku untuk hari ini`);
  expect(request.some((c) => c.includes("Routine: this message is a Routine Alice set, run now on its schedule. Nobody is here to answer a question"))).toBe(true);
  const offered = s.model.tools.at(-1)!;
  expect(offered).toContain("listTasks");
  for (const write of ["createTask", "createReminder", "createRoutine", "writeFile", "sendMessage"]) expect(offered).not.toContain(write);
  expect(await s.workspace.files("guilds/guild-1").catch(() => [])).toEqual([]);

  const after = (await repositories().schedules.get(row.id))!;
  expect([after.status, after.nextAt.toISOString(), after.lastFiredAt?.toISOString(), after.error]).toEqual(["active", "2026-10-15T02:00:00.000Z", "2026-10-14T02:00:10.000Z", null]);
  expect(await repositories().conversations.latestInChannel(s.tenant.id, s.bot.id, "channel-2")).toBeNull();
});

discordScenario("an owner who can no longer view the channel ends the Routine unrun, with the reason kept for the console", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  const row = await routineRow(s, "Simpulkan tugasku untuk hari ini", "2026-10-14T09:00:00+07:00");
  s.discord.deny("channel-2", s.discord.alice.id, ["ViewChannel"]);
  const before = s.discord.botMessages.length, calls = s.model.calls.length;
  s.clock.set("2026-10-14T09:00:10+07:00");
  await s.scheduler.tick();
  expect([s.discord.botMessages.length, s.model.calls.length]).toEqual([before, calls]);
  const after = (await repositories().schedules.get(row.id))!;
  expect([after.status, after.error]).toEqual(["done", "Not run: its owner can no longer view the channel."]);
});

discordScenario("a provider failure tells the owner and keeps the error; the Routine still comes again tomorrow, and a run past six hours late is skipped", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  const row = await routineRow(s, "Simpulkan tugasku untuk hari ini", "2026-10-14T09:00:00+07:00");
  s.model.script({ error: "Provider request failed" });
  s.clock.set("2026-10-14T09:00:10+07:00");
  await s.scheduler.tick();
  const post = s.discord.botMessages.at(-1)!;
  expect(post.content).toBe(`<@${s.discord.alice.id}> 🔁 Rutinitas "Simpulkan tugasku untuk hari ini" tidak bisa jalan kali ini: penyedia modelnya tidak bisa saya hubungi. Ia jalan lagi di waktu berikutnya, kalau ada.`);
  expect(post.allowedMentions).toEqual({ users: [s.discord.alice.id] });
  let after = (await repositories().schedules.get(row.id))!;
  expect([after.status, after.nextAt.toISOString(), after.error]).toEqual(["active", "2026-10-15T02:00:00.000Z", "Could not run: the model provider failed."]);

  const before = s.discord.botMessages.length, calls = s.model.calls.length;
  s.clock.set("2026-10-15T15:30:00+07:00");
  await s.scheduler.tick();
  expect([s.discord.botMessages.length, s.model.calls.length]).toEqual([before, calls]);
  after = (await repositories().schedules.get(row.id))!;
  expect(after.nextAt.toISOString()).toBe("2026-10-16T02:00:00.000Z");
});
