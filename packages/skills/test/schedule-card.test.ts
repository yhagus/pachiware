import { expect, test } from "bun:test";
import { scheduleCard, scheduleCardOf, type CardSchedule } from "../src/scheduleCard.ts";

// 2026-10-14 is a Wednesday; 2026-10-31 a Saturday.
const base: CardSchedule = {
  id: "abc", kind: "reminder", text: "cek invoice", channelId: "c1", guildId: "g1", public: true, owner: { id: "u7" }, mentions: [], withTasks: false,
  nextAt: "2026-10-14T09:00:00+07:00", until: null, recurrence: "weekly", weekdays: [1, 2, 3, 4, 5], dayOfMonth: null, timeOfDay: "09:00", timezone: "Asia/Jakarta",
  said: ["jam 9 WIB", "pagi, tiap hari kerja"],
};

test("a weekday Reminder's card, in Indonesian: the days in words, the next three times, the zone, where it posts and the words it was read from", () => {
  expect(scheduleCard(base, "id")).toEqual({
    title: "⏰ Pengingat dipasang",
    description: "> cek invoice",
    fields: [
      { name: "Jadwal", value: "Senin–Jumat, 09:00 WIB" },
      { name: "Berikutnya", value: "Rab 14 Okt 09:00 · Kam 15 Okt 09:00 · Jum 16 Okt 09:00" },
      { name: "Zona waktu", value: "Asia/Jakarta (WIB, UTC+07:00)", inline: true },
      { name: "Sampai", value: "tanpa batas", inline: true },
      { name: "Diposting di", value: "<#c1> (channel publik)", inline: true },
      { name: "Ping", value: "<@u7>", inline: true },
      { name: "Dibaca dari kata-katamu", value: "“jam 9 WIB” · “pagi, tiap hari kerja”" },
      { name: "ID", value: "`abc`", inline: true },
    ],
    footer: { text: "Bukan itu maksudmu? Balas untuk mengubah atau membatalkannya." },
  });
});

test("a once Routine changed in a DM, in English, says it only reads and shows its one time with the year", () => {
  const card = scheduleCard({ ...base, kind: "routine", text: "summarize my tasks", guildId: null, public: null, recurrence: "once", weekdays: [], timeOfDay: "16:00", timezone: "Asia/Makassar", nextAt: "2026-10-16T16:00:00+08:00", said: ["Jumat jam 4 sore WITA"], changed: true }, "en");
  expect(card.title).toBe("🔁 Routine changed");
  expect(card.fields).toEqual([
    { name: "When", value: "Once, Fri 16 Oct 2026 16:00 WITA" },
    { name: "Time zone", value: "Asia/Makassar (WITA, UTC+08:00)", inline: true },
    { name: "Posts in", value: "this DM", inline: true },
    { name: "Pings", value: "<@u7>", inline: true },
    { name: "Access", value: "reads only: it looks things up and reports, and changes nothing" },
    { name: "Read from your words", value: "“Jumat jam 4 sore WITA”" },
    { name: "ID", value: "`abc`", inline: true },
  ]);
});

test("a monthly date past some months' end, a zone without a name, an end date, two named days, the people pinged and the task list", () => {
  const monthly = scheduleCard({ ...base, recurrence: "monthly", weekdays: [], dayOfMonth: 31, timezone: "Asia/Tokyo", nextAt: "2026-10-31T09:00:00+09:00", until: "2026-12-31T23:59:59+09:00", public: false, mentions: ["u8"], withTasks: true, said: undefined }, "en");
  expect(monthly.fields).toEqual([
    { name: "When", value: "Every month on the 31st (or its last day), 09:00 UTC+09:00" },
    { name: "Next", value: "Sat 31 Oct 09:00 · Mon 30 Nov 09:00 · Thu 31 Dec 09:00" },
    { name: "Time zone", value: "Asia/Tokyo (UTC+09:00)", inline: true },
    { name: "Until", value: "Thu 31 Dec 2026 23:59", inline: true },
    { name: "Posts in", value: "<#c1> (not public)", inline: true },
    { name: "Pings", value: "<@u7> <@u8>", inline: true },
    { name: "Your open tasks", value: "listed with it", inline: true },
    { name: "ID", value: "`abc`", inline: true },
  ]);
  expect(scheduleCard({ ...base, weekdays: [1, 4] }, "en").fields[0]).toEqual({ name: "When", value: "Every Monday and Thursday, 09:00 WIB" });
  expect(scheduleCard({ ...base, weekdays: [0, 6] }, "id").fields[0]).toEqual({ name: "Jadwal", value: "Sabtu dan Minggu, 09:00 WIB" });
  expect(scheduleCard({ ...base, recurrence: "daily", weekdays: [] }, "id").fields[0]).toEqual({ name: "Jadwal", value: "Setiap hari, 09:00 WIB" });
});

test("only a schedule tool's result with a schedule in it gets a card: not a question back, not another tool", () => {
  expect(scheduleCardOf("createReminder", base, "id")?.title).toBe("⏰ Pengingat dipasang");
  expect(scheduleCardOf("editReminder", { ...base, changed: true }, "id")?.title).toBe("⏰ Pengingat diubah");
  expect(scheduleCardOf("createReminder", { set: false, question: "Pagi atau malam?" }, "id")).toBeNull();
  expect(scheduleCardOf("listReminders", { reminders: [base] }, "id")).toBeNull();
});
