import { describe, expect, test } from "bun:test";
import { splitReply, stripFiller } from "../src/discord/replyStyle";

const para = (word: string, n: number) => Array.from({ length: n }, (_, i) => `${word} line ${i}.`).join("\n");

describe("splitReply", () => {
  test("a reply that fits stays one message", () => {
    expect(splitReply("Deploy is green.\n\nNext run at 14:00.")).toEqual(["Deploy is green.\n\nNext run at 14:00."]);
  });

  test("a long reply is cut at a paragraph break, never inside a line", () => {
    const first = para("alpha", 100), second = para("beta", 100);
    const parts = splitReply(`${first}\n\n${second}`, 2000);
    expect(parts).toEqual([first, second]);
  });

  test("without a paragraph break the reply is cut at a line break", () => {
    const text = para("gamma", 10);
    expect(splitReply(text, 80)).toEqual([
      "gamma line 0.\ngamma line 1.\ngamma line 2.\ngamma line 3.\ngamma line 4.",
      "gamma line 5.\ngamma line 6.\ngamma line 7.\ngamma line 8.\ngamma line 9.",
    ]);
  });

  test("a code block split across messages is closed and reopened with its language", () => {
    const code = Array.from({ length: 8 }, (_, i) => `const v${i} = ${i};`).join("\n");
    expect(splitReply("Try this:\n```ts\n" + code + "\n```\nThen restart.", 100)).toEqual([
      "Try this:\n```ts\nconst v0 = 0;\nconst v1 = 1;\nconst v2 = 2;\nconst v3 = 3;\nconst v4 = 4;\n```",
      "```ts\nconst v5 = 5;\nconst v6 = 6;\nconst v7 = 7;\n```\nThen restart.",
    ]);
  });

  test("blank lines inside a code block are not used as paragraph breaks", () => {
    const block = "```py\n" + "a = 1\n\n".repeat(6) + "b = 2\n```";
    const parts = splitReply(block, 40);
    for (const part of parts) expect(part.startsWith("```py\n") && part.endsWith("\n```")).toBe(true);
    expect(parts.every((p) => p.length <= 40)).toBe(true);
  });

  test("a single line longer than a message is cut at a space", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const parts = splitReply(words, 60);
    expect(parts.every((p) => p.length <= 60 && !p.startsWith(" ") && !p.endsWith(" "))).toBe(true);
    expect(parts.join(" ")).toBe(words);
  });
});

describe("stripFiller", () => {
  test.each([
    ["Great question! The cache expires after 120 seconds.", "The cache expires after 120 seconds."],
    ["Sure! Restart the api service.", "Restart the api service."],
    ["Certainly. Restart the api service.", "Restart the api service."],
    ["Tentu! Cache-nya kedaluwarsa setelah 120 detik.", "Cache-nya kedaluwarsa setelah 120 detik."],
    ["Baik, berikut ringkasannya:\n- login loop\n- CSV lambat", "- login loop\n- CSV lambat"],
    ["Sure, here's the list:\n- api\n- web", "- api\n- web"],
  ])("removes the opener from %j", (input, output) => expect(stripFiller(input)).toBe(output));

  test.each([
    ["Restart the api service. Let me know if you need anything else!", "Restart the api service."],
    ["Restart the api service.\n\nHope this helps! 😊", "Restart the api service."],
    ["Restart the api service. Feel free to ask if anything is unclear.", "Restart the api service."],
    ["Restart service api. Semoga membantu!", "Restart service api."],
    ["Restart service api.\nJangan ragu untuk bertanya kalau ada yang kurang jelas.", "Restart service api."],
    ["Restart service api. Semoga membantu! Jangan ragu bertanya lagi ya 🙏", "Restart service api."],
    ["Restart service api. Ada lagi yang bisa saya bantu?", "Restart service api."],
    ["```sh\nsystemctl restart api\n```\nHope that helps.", "```sh\nsystemctl restart api\n```"],
  ])("removes the closer from %j", (input, output) => expect(stripFiller(input)).toBe(output));

  test("keeps the same words when they carry content", () => {
    for (const text of ["Sure works: run `bun test`.", "Let me know if the build fails. I will check the log then.", "Tentukan dulu repo-nya.", "Old branch is merged. Feel free to delete it.", "Jangan ragu untuk menghapus branch lama.", "Log sudah dicek. Ada lagi yang bisa dicek: log web.", "Restarted. Is there anything else in the queue?","```\nSure!\n```"]) expect(stripFiller(text)).toBe(text);
  });

  test("a reply that is only filler is left as it is", () => {
    expect(stripFiller("Sure!")).toBe("Sure!");
  });
});
