import { describe, expect, test } from "bun:test";
import { replyLanguage } from "../src/language";

describe("replyLanguage", () => {
  test("reads Indonesian by its function words and defaults to English when unsure", () => {
    expect(replyLanguage("tolong cek kenapa login di Safari selalu gagal")).toBe("id");
    expect(replyLanguage("why does the login fail on Safari?")).toBe("en");
    expect(replyLanguage("ok")).toBe("en");
    expect(replyLanguage("", null, "export CSV")).toBe("en");
  });
});
