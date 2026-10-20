import { expect, test } from "bun:test";
import { checkWhen, unheardQuote, whenFromWords, type Repeat, type WhenReading } from "../src/whenWords.ts";
import { textIn } from "../src/language.ts";

// Worked examples against a calendar: 2026-10-14 is a Wednesday; it is 08:00 in Jakarta (WIB, +07:00).
const FROM = Date.parse("2026-10-14T08:00:00+07:00"), ZONE = "Asia/Jakarta";
const read = (words: string, move = false) => whenFromWords(words, FROM, ZONE, { move });
const pick = (r: WhenReading) => ({ time: r.time, either: r.either, repeat: r.repeat, day: r.day, unclear: r.unclear });

test("an hour said without morning or evening is either; a part of the day, a leading zero or a two-digit hour with minutes fixes it", () => {
  expect(read("jam 9").either).toEqual(["09:00", "21:00"]);
  expect(read("jam 9").unclear).toContain("am-pm");
  expect(read("9.00").either).toEqual(["09:00", "21:00"]);
  expect(read("jam 12").either).toEqual(["12:00", "00:00"]);
  expect(read("jam 10").either).toEqual(["10:00", "22:00"]);
  for (const [words, time] of [
    ["jam 9 pagi", "09:00"], ["jam 9 malam", "21:00"], ["21.00", "21:00"], ["09.00", "09:00"], ["10.30", "10:30"], ["jam 13", "13:00"], ["jam 0", "00:00"],
    ["12 siang", "12:00"], ["jam 12 malam", "00:00"], ["jam 3 sore", "15:00"], ["1 dini hari", "01:00"], ["jam 5 subuh", "05:00"], ["jam 10.30 malam", "22:30"],
    ["setengah 9 pagi", "08:30"], ["jam setengah 8 malam", "19:30"], ["setengah 1 siang", "12:30"], ["jam 9 kurang seperempat pagi", "08:45"], ["jam 9 lewat 15 malam", "21:15"],
    ["jam sembilan pagi", "09:00"], ["pukul dua belas siang", "12:00"], ["9am", "09:00"], ["9 pm", "21:00"], ["noon", "12:00"], ["tengah malam", "00:00"],
    ["nanti malam jam 9", "21:00"], ["besok pagi jam 9", "09:00"], ["tiap pagi jam 9", "09:00"],
  ] as const) expect([words, read(words).time]).toEqual([words, time]);
});

test("an hour and a part of the day that do not go together, two hours, or none at all leave the time open", () => {
  for (const words of ["jam 12 pagi", "jam 24", "jam 9 atau 10", "jam 9 atau 21.00", "jam 9 pagi dan jam 5 sore", "besok pagi", "every day"]) {
    expect([words, read(words).time, read(words).unclear.includes("time")]).toEqual([words, null, true]);
  }
});

test("a greeting is not a part of the day, and a part of the day said apart from the hour counts when it is the only one", () => {
  expect(read("selamat pagi, jam 9").either).toEqual(["09:00", "21:00"]);
  expect(read("jam 9 WIB ; pagi, tiap hari kerja").time).toBe("09:00");
  expect(read("jam 9 ; 21.00").time).toBe("21:00");
  expect(read("jam 9 pagi ; jam 9 malam").unclear).toContain("time");
});

test("repetitions: daily, weekly on the days named, ranges and exceptions, monthly on a date", () => {
  const cases: [string, Repeat][] = [
    ["setiap jam 9 pagi", { recurrence: "daily" }], ["tiap hari jam 7.30 pagi", { recurrence: "daily" }], ["9am every day", { recurrence: "daily" }], ["noon daily", { recurrence: "daily" }],
    ["setiap 09.00", { recurrence: "daily" }], ["harian jam 8 pagi", { recurrence: "daily" }],
    ["tiap hari kerja jam 8 pagi", { recurrence: "weekly", weekdays: [1, 2, 3, 4, 5] }], ["Senin–Jumat jam 08.00", { recurrence: "weekly", weekdays: [1, 2, 3, 4, 5] }],
    ["Senin s/d Jumat jam 08.00", { recurrence: "weekly", weekdays: [1, 2, 3, 4, 5] }], ["weekdays at 9am", { recurrence: "weekly", weekdays: [1, 2, 3, 4, 5] }],
    ["Jumat-Senin jam 8 pagi", { recurrence: "weekly", weekdays: [0, 1, 5, 6] }], ["akhir pekan jam 10 pagi", { recurrence: "weekly", weekdays: [0, 6] }],
    ["setiap hari kecuali Sabtu jam 6 pagi", { recurrence: "weekly", weekdays: [0, 1, 2, 3, 4, 5] }], ["setiap hari kecuali akhir pekan jam 9 pagi", { recurrence: "weekly", weekdays: [1, 2, 3, 4, 5] }],
    ["jam 7 sore tiap hari kerja kecuali Jumat", { recurrence: "weekly", weekdays: [1, 2, 3, 4] }], ["setiap Senin dan Kamis jam 4 sore", { recurrence: "weekly", weekdays: [1, 4] }],
    ["setiap Senin, Rabu, Jumat jam 7 pagi", { recurrence: "weekly", weekdays: [1, 3, 5] }], ["setiap hari Senin jam 9 pagi", { recurrence: "weekly", weekdays: [1] }],
    ["every Monday 9am", { recurrence: "weekly", weekdays: [1] }], ["hari Minggu jam 9 pagi setiap", { recurrence: "weekly", weekdays: [0] }],
    ["setiap minggu hari Senin jam 9 pagi", { recurrence: "weekly", weekdays: [1] }], ["mingguan hari Jumat jam 4 sore", { recurrence: "weekly", weekdays: [5] }],
    ["tiap tanggal 25 jam 9 pagi", { recurrence: "monthly", dayOfMonth: 25 }], ["setiap awal bulan jam 9 pagi", { recurrence: "monthly", dayOfMonth: 1 }],
    ["tiap akhir bulan jam 5 sore", { recurrence: "monthly", dayOfMonth: 31 }], ["bulanan tanggal 1 jam 9 pagi", { recurrence: "monthly", dayOfMonth: 1 }],
    ["every month on the 15th at 9am", { recurrence: "monthly", dayOfMonth: 15 }],
  ];
  for (const [words, repeat] of cases) expect([words, read(words).repeat, read(words).unclear]).toEqual([words, repeat, []]);
});

test("once: a day word, a date, this or next weekday, a span from now, or 'sekali'", () => {
  expect(pick(read("besok jam 9 pagi"))).toEqual({ time: "09:00", either: null, repeat: { recurrence: "once" }, day: "2026-10-15", unclear: [] });
  expect(read("hari ini jam 3 sore").day).toBe("2026-10-14");
  expect(read("nanti malam jam 9").day).toBe("2026-10-14");
  expect(read("lusa jam 10.00").day).toBe("2026-10-16");
  expect(read("tanggal 25 Oktober jam 10 pagi").day).toBe("2026-10-25");
  expect(read("tanggal 20 jam 10 pagi").day).toBe("2026-10-20");
  expect(read("20/10 jam 9 pagi").day).toBe("2026-10-20");
  expect(read("Jumat ini jam 10 pagi").day).toBe("2026-10-16");
  expect(read("Jumat depan jam 10 pagi").day).toBe("2026-10-23");
  expect(read("Jumat sekali saja jam 10 pagi").day).toBe("2026-10-16");
  expect(pick(read("sekali jam 15:00"))).toEqual({ time: "15:00", either: null, repeat: { recurrence: "once" }, day: null, unclear: [] });
  expect(read("tomorrow at 9 pm")).toMatchObject({ time: "21:00", day: "2026-10-15" });
  for (const [words, minutes] of [["30 menit lagi", 30], ["2 jam lagi", 120], ["in 2 hours", 120], ["dalam 30 menit", 30], ["1 jam 30 menit lagi", 90], ["sejam lagi", 60], ["setengah jam lagi", 30]] as const) {
    expect([words, read(words).after, read(words).repeat, read(words).unclear]).toEqual([words, minutes * 60_000, { recurrence: "once" }, []]);
  }
});

test("what the words leave open is asked: once or repeating, which days, which date, 'setiap minggu', morning or evening, the zone", () => {
  expect(read("simpulin tugasku jam 9 WIB").unclear.sort()).toEqual(["am-pm", "repetition"]);
  expect(read("remind me at 15:00").unclear).toEqual(["repetition"]);
  expect(read("Jumat jam 10 pagi").unclear).toEqual(["repetition"]);
  expect(read("seminggu sekali jam 9 pagi").unclear).toEqual(["days"]);
  expect(read("tiap bulan jam 9 pagi").unclear).toEqual(["date"]);
  expect(read("monthly at 9am").unclear).toEqual(["date"]);
  expect(read("setiap minggu jam 9 pagi").unclear).toEqual(["week-or-sunday"]);
  expect(read("jam 10 setiap hari").unclear).toEqual(["am-pm"]);
  expect(read("besok jam 9").unclear).toEqual(["am-pm"]);
  expect(read("jam 9 pagi WIB atau WITA").unclear).toContain("zone");
});

test("a zone word sets the zone; 'mulai' sets the first day a repeating schedule may run", () => {
  expect(read("jam 9 WITA tiap hari pagi")).toMatchObject({ time: "09:00", zone: "Asia/Makassar", repeat: { recurrence: "daily" } });
  expect(read("jam 9 pagi WIT tiap hari").zone).toBe("Asia/Jayapura");
  expect(read("mulai Senin depan setiap hari jam 9 pagi")).toMatchObject({ start: "2026-10-19", repeat: { recurrence: "daily" }, time: "09:00" });
  expect(read("setiap hari jam 9 pagi mulai besok").start).toBe("2026-10-15");
  expect(read("mulai minggu depan tiap hari kerja jam 8 pagi").start).toBe("2026-10-19");
  expect(read("mulai bulan depan tiap tanggal 1 jam 9 pagi").start).toBe("2026-11-01");
});

test("by the hour or minute, every other day or week, yearly, or around another event cannot be kept", () => {
  for (const [words, unsupported] of [
    ["setiap jam", "setiap jam"], ["tiap 2 jam", "tiap 2 jam"], ["tiap 30 menit", "tiap 30 menit"], ["every hour", "every hour"], ["2 minggu sekali jam 9 pagi", "2 minggu sekali"],
    ["every other day at 9am", "every other day"], ["tiap tahun", "tiap tahun"], ["hourly", "hourly"], ["30 menit sebelum rapat", "30 menit sebelum"],
  ] as const) expect([words, read(words).unsupported]).toEqual([words, unsupported]);
});

test("moving one post reads a bare span as from now and needs no repetition", () => {
  expect(read("tunda 30 menit", true)).toMatchObject({ after: 30 * 60_000, unclear: [] });
  expect(read("snooze it 30 minutes", true).after).toBe(30 * 60_000);
  expect(read("pindah ke jam 4 sore", true).time).toBe("16:00");
});

test("each quote must be found in one of the asker's lines, in any case and spacing, without the bot's mention or the quote's end punctuation", () => {
  const lines = ["<@999> Simpulin tugasku jam 9   WIB ya", "Pagi, tiap hari kerja."];
  expect(unheardQuote(["jam 9 WIB", "pagi, tiap hari kerja"], lines)).toBeNull();
  expect(unheardQuote(['"tiap hari kerja."'], lines)).toBeNull();
  expect(unheardQuote(["jam 9 pagi"], lines)).toBe("jam 9 pagi");
  expect(unheardQuote(["  "], lines)).toBe("  ");
});

test("checkWhen asks about what is open, refuses arguments that disagree with the words, and otherwise plans from the words", () => {
  const at = (iso: string) => Date.parse(iso);
  const opts = { from: FROM, timeZone: ZONE };
  expect(checkWhen(read("simpulin tugasku jam 9 WIB"), { recurrence: "daily", time: "09:00" }, opts)).toEqual({ ask: ["repetition", "am-pm"], either: ["09:00", "21:00"] });
  expect(checkWhen(read("tiap 2 jam"), {}, opts)).toEqual({ unsupported: "tiap 2 jam" });

  expect(checkWhen(read("setiap jam 9 pagi WIB"), { recurrence: "daily", time: "09:00" }, opts))
    .toEqual({ plan: { recurrence: "daily", weekdays: [], dayOfMonth: null, timeOfDay: "09:00", timezone: "Asia/Jakarta", nextAt: at("2026-10-14T09:00:00+07:00") } });
  expect(checkWhen(read("jam 9 WIB ; pagi, tiap hari kerja"), { recurrence: "weekly", time: "09:00", weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"] }, opts))
    .toEqual({ plan: { recurrence: "weekly", weekdays: [1, 2, 3, 4, 5], dayOfMonth: null, timeOfDay: "09:00", timezone: "Asia/Jakarta", nextAt: at("2026-10-14T09:00:00+07:00") } });
  expect(checkWhen(read("tiap tanggal 25 jam 9 pagi"), { recurrence: "monthly", time: "09:00", dayOfMonth: 25 }, opts))
    .toMatchObject({ plan: { recurrence: "monthly", dayOfMonth: 25, nextAt: at("2026-10-25T09:00:00+07:00") } });
  expect(checkWhen(read("mulai Senin depan setiap hari jam 9 pagi"), { recurrence: "daily", time: "09:00" }, opts)).toMatchObject({ plan: { nextAt: at("2026-10-19T09:00:00+07:00") } });
  // 08:00 in Jakarta is 09:00 in Makassar, so today's 09:00 WITA is no longer ahead.
  expect(checkWhen(read("jam 9 WITA tiap hari pagi"), { recurrence: "daily", time: "09:00" }, opts)).toMatchObject({ plan: { timezone: "Asia/Makassar", nextAt: at("2026-10-15T09:00:00+08:00") } });

  expect(checkWhen(read("besok jam 9 pagi"), { recurrence: "once", at: "2026-10-15T09:00" }, opts)).toMatchObject({ plan: { recurrence: "once", timeOfDay: "09:00", nextAt: at("2026-10-15T09:00:00+07:00") } });
  expect(checkWhen(read("sekali jam 7 pagi"), { recurrence: "once", at: "07:00" }, opts)).toMatchObject({ plan: { nextAt: at("2026-10-15T07:00:00+07:00") } });
  expect(checkWhen(read("30 menit lagi"), { recurrence: "once", at: "08:30" }, opts)).toMatchObject({ plan: { nextAt: at("2026-10-14T08:30:00+07:00") } });
  expect(checkWhen(read("hari ini jam 7 pagi"), { recurrence: "once", at: "07:00" }, opts)).toEqual({ passed: true });

  expect(checkWhen(read("setiap jam 9 malam"), { recurrence: "daily", time: "09:00" }, opts)).toEqual({ mismatch: "The asker's words read daily at 21:00, but the arguments say daily at 09:00." });
  expect(checkWhen(read("setiap jam 9 pagi"), { recurrence: "once", at: "09:00" }, opts)).toEqual({ mismatch: "The asker's words read daily at 09:00, but the arguments say once at 2026-10-14T09:00:00+07:00." });
  expect(checkWhen(read("setiap Senin dan Kamis jam 4 sore"), { recurrence: "weekly", time: "16:00", weekdays: ["monday"] }, opts))
    .toEqual({ mismatch: "The asker's words read weekly on [1,4] at 16:00, but the arguments say weekly on [1] at 16:00." });
  expect(checkWhen(read("besok jam 9 pagi"), { recurrence: "once", at: "2026-10-14T09:00" }, opts))
    .toEqual({ mismatch: 'The asker\'s words read once at 2026-10-15T09:00:00+07:00, but at is "2026-10-14T09:00".' });

  // Moving one post: only its time is read, from now for a span.
  expect(checkWhen(read("tunda 30 menit", true), { at: "08:30" }, { ...opts, move: true })).toMatchObject({ plan: { nextAt: at("2026-10-14T08:30:00+07:00") } });
  expect(checkWhen(read("pindah ke jam 4", true), { at: "16:00" }, { ...opts, move: true })).toEqual({ ask: ["am-pm"], either: ["04:00", "16:00"] });
});

test("the question names both clock times with their part of the day, then how often, in the asker's language", () => {
  const { unclear, either } = read("simpulin tugasku jam 9 WIB");
  expect(textIn("id").whenAsk(unclear, either)).toBe("Maksudnya jam 09:00 (pagi) atau 21:00 (malam)? Sekali saja, atau berulang: setiap hari, Senin–Jumat, atau hari tertentu?");
  expect(textIn("en").whenAsk(unclear, either)).toBe("Do you mean 09:00 (morning) or 21:00 (evening)? Just once, or repeating: every day, Monday to Friday, or on certain days?");
  expect(textIn("id").whenAsk(read("jam 12 tiap hari").unclear, read("jam 12 tiap hari").either)).toBe("Maksudnya jam 12:00 (siang) atau 00:00 (tengah malam)?");
});

test("each part of the day the question offers, said back as the answer, reads as the clock time it was offered for", () => {
  for (const language of ["id", "en"] as const) for (let hour = 1; hour <= 12; hour++) {
    const first = read(`jam ${hour} setiap hari`);
    const offered = [...textIn(language).whenAsk(first.unclear, first.either).matchAll(/\((.+?)\)/g)].map((m) => m[1]!);
    expect(offered.map((answer) => read(`jam ${hour} setiap hari ; ${answer}`).time)).toEqual(first.either!);
  }
});
