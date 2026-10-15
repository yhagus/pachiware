import { expect, test } from "bun:test";
import { languageOf, replyLanguage } from "../../../packages/skills/src/language";

// #135: a task's short id is hex, and its letter runs ("a", "be") were counted as English words.
test("letters inside an id or a hash are not words", () => {
  const listed = (id: string) => `Jatuh tempo minggu ini:\npending | due 2026-10-16 | unassigned | ${id} | Kirim invoice ke Pak Budi`;
  expect(languageOf(listed("a1a2a3b4"))).not.toBe("en");
  expect(languageOf(listed("be4a7a01"))).not.toBe("en");
  expect(replyLanguage("tolong cek commit a1b2a3 ke main")).toBe("id");
});

test("words still count beside numbers and punctuation", () => {
  expect(languageOf("The build is green, and the 3 tests on main pass.")).toBe("en");
  expect(languageOf("Tolong cek yang ini, sudah 2 kali gagal di main.")).toBe("id");
});
