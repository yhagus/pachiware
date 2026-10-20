import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

// 2026-10-14 is a Wednesday. The guild's language is Indonesian and its zone Jakarta (WIB, +07:00).

discordScenario("words that leave the time open get the one question and nothing is set; the answer, quoted with the first words, sets it", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  s.model.script({ tool: "createReminder", args: { text: "cek invoice", said: ["jam 9 WIB"], recurrence: "daily", time: "09:00" } }, (turn) => turn.toolResults[0].question);
  const ask = await s.discord.send(`${s.discord.mention} ingatkan aku cek invoice jam 9 WIB`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Maksudnya jam 09:00 (pagi) atau 21:00 (malam)? Sekali saja, atau berulang: setiap hari, Senin–Jumat, atau hari tertentu?");
  expect(await repositories().schedules.list()).toEqual([]);

  s.model.script(
    { tool: "createReminder", args: { text: "cek invoice", said: ["jam 9 WIB", "pagi, tiap hari kerja"], recurrence: "weekly", weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"], time: "09:00" } },
    (turn) => `set ${turn.toolResults[0].at}`,
  );
  await s.discord.send("pagi, tiap hari kerja", { channel: ask.thread! });
  const [row] = await repositories().schedules.list();
  expect([row!.recurrence, row!.weekdays, row!.timeOfDay, row!.timezone, row!.nextAt.toISOString()]).toEqual(["weekly", [1, 2, 3, 4, 5], "09:00", "Asia/Jakarta", "2026-10-14T02:00:00.000Z"]);
});

discordScenario("a quote the asker never wrote is refused, so the model cannot fill in morning or evening for them", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  s.model.script({ tool: "createReminder", args: { text: "cek invoice", said: ["jam 9 pagi WIB"], recurrence: "daily", time: "09:00" } }, (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} ingatkan aku cek invoice setiap hari jam 9 WIB`);
  expect(s.discord.botMessages.at(-1)!.content).toBe(`"jam 9 pagi WIB" is not in the asker's own messages. said quotes their words exactly, and only theirs; if they never said when, ask them.`);
  expect(await repositories().schedules.list()).toEqual([]);
});

discordScenario("the bot's own question, in the line a reply quotes, is not the asker's words", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  s.model.script("Pagi atau malam?");
  const ask = await s.discord.send(`${s.discord.mention} ingatkan aku cek invoice setiap hari jam 9`);
  const question = s.discord.botMessages.at(-1)!;
  s.model.script({ tool: "createReminder", args: { text: "cek invoice", said: ["setiap hari jam 9", "pagi"], recurrence: "daily", time: "09:00" } }, (turn) => turn.toolResults[0].error);
  await s.discord.send("yang itu", { channel: ask.thread!, replyTo: question });
  expect(s.discord.botMessages.at(-1)!.content).toBe(`"pagi" is not in the asker's own messages. said quotes their words exactly, and only theirs; if they never said when, ask them.`);
  expect(await repositories().schedules.list()).toEqual([]);
});

discordScenario("arguments that disagree with the words are refused, naming both; a zone word sets the Reminder's zone", async (s) => {
  s.clock.set("2026-10-14T07:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  s.model.script({ tool: "createReminder", args: { text: "cek gudang", said: ["tiap hari jam 9 malam WITA"], recurrence: "daily", time: "09:00" } }, (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} ingatkan aku cek gudang tiap hari jam 9 malam WITA`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("The asker's words read daily at 21:00, but the arguments say daily at 09:00. Pass what the words say; if the asker meant something else, ask them.");

  s.model.script({ tool: "createReminder", args: { text: "cek gudang", said: ["tiap hari jam 9 pagi WITA"], recurrence: "daily", time: "09:00" } }, (turn) => turn.toolResults[0].at);
  await s.discord.send(`${s.discord.mention} ingatkan aku cek gudang tiap hari jam 9 pagi WITA`, { channel: "channel-2" });
  expect(s.discord.botMessages.at(-1)!.content).toBe("2026-10-14T09:00:00+08:00");
  const [row] = await repositories().schedules.list();
  expect([row!.timezone, row!.timeOfDay]).toEqual(["Asia/Makassar", "09:00"]);
});

discordScenario("a repetition no schedule keeps is refused in the place's language, and nothing is set", async (s) => {
  s.clock.set("2026-10-14T08:00:00+07:00");
  const { repositories } = await import("@pachiware/db");
  s.model.script({ tool: "createReminder", args: { text: "minum air", said: ["tiap 2 jam"], recurrence: "daily", time: "10:00" } }, (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} ingatkan aku minum air tiap 2 jam`);
  expect(s.discord.botMessages.at(-1)!.content).toBe('Jadwal seperti "tiap 2 jam" belum bisa kubuat: jadwal hanya bisa sekali, setiap hari, di hari-hari tertentu tiap minggu, atau di satu tanggal tiap bulan, pada satu jam.');
  expect(await repositories().schedules.list()).toEqual([]);
});
