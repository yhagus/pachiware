import { describe, expect, test } from "bun:test";
import { replyLanguage, textIn } from "../src/language";

describe("replyLanguage", () => {
  test("reads Indonesian by its function words and defaults to English when unsure", () => {
    expect(replyLanguage("tolong cek kenapa login di Safari selalu gagal")).toBe("id");
    expect(replyLanguage("why does the login fail on Safari?")).toBe("en");
    expect(replyLanguage("ok")).toBe("en");
    expect(replyLanguage("", null, "export CSV")).toBe("en");
  });
});

describe("provider refusals", () => {
  test("say an admin has to add the key or base URL first, without pointing at the console", () => {
    for (const language of ["en", "id"] as const) {
      const t = textIn(language);
      for (const text of [t.providerNoKey("openai"), t.providerNoBaseUrl]) {
        expect(text).not.toMatch(/console|konsol/i);
        expect(text).toMatch(language === "en" ? /An admin has to add the (API key|base URL) first\.$/ : /Admin perlu menambahkan (API key|base URL)-nya dulu\.$/);
      }
    }
  });
});
