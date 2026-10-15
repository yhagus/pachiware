import { expect, test } from "bun:test";
import { documentText, MAX_TEXT_BYTES } from "../src/workspace/extract";

test("a CSV whose text is exactly the size cap is kept whole, without the clipped note", async () => {
  const text = [...Array.from({ length: MAX_TEXT_BYTES / 10 - 1 }, (_, i) => `r${String(i).padStart(5, "0")},ab\n`), "last,1234!"].join("");
  expect(Buffer.byteLength(text)).toBe(MAX_TEXT_BYTES);
  expect(await documentText("data.csv", new TextEncoder().encode(text))).toBe(`${text}\n`);
});
