import { describe, expect, test } from "bun:test";
import { replyLanguage, textIn } from "../src/language";

describe("replyLanguage", () => {
  test("reads Indonesian by its function words and defaults to English when unsure", () => {
    expect(replyLanguage("tolong cek kenapa login di Safari selalu gagal")).toBe("id");
    expect(replyLanguage("why does the login fail on Safari?")).toBe("en");
    expect(replyLanguage("ok")).toBe("en");
    expect(replyLanguage("", null, "export CSV")).toBe("en");
  });

  test("every Indonesian string exists where the English one does", () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k]));
    expect(keys(textIn("id"))).toEqual(keys(textIn("en")));
  });
});
