import { expect, test } from "bun:test";
import { titleDate } from "../src/workspace/search";

// The date a Document's first line gives, which recall labels it with when its name has none (#242).

test("a date in the first line, written in English, Indonesian or ISO, is read as that day", () => {
  expect(titleDate("Call with Sinar Printing, 6 October 2026\nPresent: Alice, Bob")).toBe("2026-10-06");
  expect(titleDate("# Notulen rapat vendor 2 Oktober 2026\n\n- Brosur")).toBe("2026-10-02");
  expect(titleDate("\n\nRapat koordinasi 17 Agustus 2026")).toBe("2026-08-17");
  expect(titleDate("Kickoff notes, March 3, 2026")).toBe("2026-03-03");
  expect(titleDate("Weekly sync 2026-09-28")).toBe("2026-09-28");
  expect(titleDate("Agenda 12 items 2026-10-06")).toBe("2026-10-06");
  expect(titleDate("Review 9 Des 2025")).toBe("2025-12-09");
  expect(titleDate("---\ntitle: \"Sync\"\n---\nSync of 1 Mei 2026")).toBe("2026-05-01");
});

test("no date, a date after the first line, or a day that does not exist gives none", () => {
  expect(titleDate("Brochure prices\nUpdated 1 September 2026")).toBeNull();
  expect(titleDate("Budget 2026")).toBeNull();
  expect(titleDate("Meeting 31 June 2026")).toBeNull();
  expect(titleDate("Sprint 2026-02-30")).toBeNull();
  expect(titleDate("Marketing 12 Marketers 2026")).toBeNull();
  expect(titleDate("")).toBeNull();
});
