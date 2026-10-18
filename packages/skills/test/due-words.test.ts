import { expect, test } from "bun:test";
import { dueFromWords } from "../src/dueWords.ts";

// Worked examples against a calendar: 2026-10-14 is a Wednesday, 2026-10-17 a Saturday.
const WED = "2026-10-14", SAT = "2026-10-17";

test("a weekday is the coming one, never the day it was said; 'depan' or 'next' is the one in the following week", () => {
  expect(dueFromWords("Jumat", WED)).toBe("2026-10-16");
  expect(dueFromWords("jum'at sore", WED)).toBe("2026-10-16");
  expect(dueFromWords("Friday", WED)).toBe("2026-10-16");
  expect(dueFromWords("Rabu", WED)).toBe("2026-10-21");
  expect(dueFromWords("Senin", WED)).toBe("2026-10-19");
  expect(dueFromWords("Jumat depan", WED)).toBe("2026-10-23");
  expect(dueFromWords("next Friday", WED)).toBe("2026-10-23");
  expect(dueFromWords("Jumat depan", SAT)).toBe("2026-10-23");
  expect(dueFromWords("Minggu", WED)).toBe("2026-10-18");
});

test("today, tomorrow, the day after, a count of days or weeks, and the end of the month", () => {
  expect(dueFromWords("hari ini", WED)).toBe(WED);
  expect(dueFromWords("EOD", WED)).toBe(WED);
  expect(dueFromWords("besok pagi", WED)).toBe("2026-10-15");
  expect(dueFromWords("tomorrow", WED)).toBe("2026-10-15");
  expect(dueFromWords("lusa", WED)).toBe("2026-10-16");
  expect(dueFromWords("3 hari lagi", WED)).toBe("2026-10-17");
  expect(dueFromWords("in 2 weeks", WED)).toBe("2026-10-28");
  expect(dueFromWords("akhir bulan", WED)).toBe("2026-10-31");
  expect(dueFromWords("end of the month", "2026-02-03")).toBe("2026-02-28");
});

test("a written date, day first, with or without a year; a day already past this year is next year's", () => {
  expect(dueFromWords("2026-11-02", WED)).toBe("2026-11-02");
  expect(dueFromWords("20/10", WED)).toBe("2026-10-20");
  expect(dueFromWords("1/3/2027", WED)).toBe("2027-03-01");
  expect(dueFromWords("20 Oktober", WED)).toBe("2026-10-20");
  expect(dueFromWords("5 Agustus", WED)).toBe("2027-08-05");
  expect(dueFromWords("Oct 30", WED)).toBe("2026-10-30");
  expect(dueFromWords("November 3rd, 2026", WED)).toBe("2026-11-03");
  expect(dueFromWords("31 Nov", WED)).toBeNull();
});

test("words that name a week or no day at all give no date", () => {
  for (const said of ["minggu depan", "next week", "pekan ini", "ASAP", "secepatnya", "", null]) expect(dueFromWords(said, WED)).toBeNull();
});

test("a time written with a dot is not a date, a fraction of weeks is no count, and \"maybe\" is not May (review of #253)", () => {
  const MON = "2026-10-19";
  expect(dueFromWords("Friday 5.10", MON)).toBe("2026-10-23");
  expect(dueFromWords("Jumat 17.00", MON)).toBe("2026-10-23");
  expect(dueFromWords("1.5 minggu", MON)).toBeNull();
  expect(dueFromWords("maybe 3 days", MON)).toBe("2026-10-22");
  expect(dueFromWords("3 Mei", MON)).toBe("2027-05-03");
  expect(dueFromWords("Agustus 5", MON)).toBe("2027-08-05");
});
