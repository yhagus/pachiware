import { expect, test } from "bun:test";
import { readThrough } from "../src/workspace/reader";

// The reader of long files (#266): a file over READ_LIMIT is read by the bot's own model in chunks of about 40,000 characters.

type Request = { system: string; user: string; deadline?: number };
/** The line numbers a chunk request shows, read from its "<n>: " numbering. */
const numbersIn = (request: Request) => [...request.user.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]));
/** Lines whose numbered form, "<n>: <text>", is exactly `width` characters. */
const linesOf = (count: number, width: number, text = (n: number) => `Entry ${n} of the generator maintenance log`) =>
  Array.from({ length: count }, (_, i) => { const n = i + 1, head = `${n}: `; return text(n).padEnd(width - head.length, ".").slice(0, width - head.length); });
const notHere = JSON.stringify({ found: false, answer: "Bagian ini tidak menyebutnya.", quotes: [] });

test("a 900-line file is asked in three parallel chunks that cover it, each line numbered once, each within the 90 s tool ceiling", async () => {
  // 100-character numbered lines: 396 of them fill 39,996 characters of a 40,000-character chunk, the 397th would pass it.
  const lines = linesOf(900, 100), asked: Request[] = [], started = Date.now();
  const reading = await readThrough(async (request) => { asked.push(request); return notHere; }, lines, { fromLine: 1, toLine: 900, question: "Berapa liter tangki genset?" });

  const ranges = asked.map(numbersIn).map((n) => [n[0], n.at(-1)]).sort((a, b) => a[0]! - b[0]!);
  expect(ranges).toEqual([[1, 396], [397, 792], [793, 900]]);
  expect(asked.flatMap(numbersIn).sort((a, b) => a - b)).toEqual(Array.from({ length: 900 }, (_, i) => i + 1));
  for (const { deadline } of asked) {
    expect(deadline! - started).toBeGreaterThan(0);
    expect(deadline! - started).toBeLessThan(90_000);
  }
  expect(reading).toMatchObject({ read: { fromLine: 1, toLine: 900 } });
  expect(reading).not.toHaveProperty("unreadFrom");
});

test("a quote is kept only when its words are on the line it names, whitespace aside; the rest are dropped and counted", async () => {
  const lines = linesOf(900, 100, (n) => (n === 612 ? "The generator's fuel tank holds 48 litres of diesel" : `Entry ${n} of the generator maintenance log`));
  const reading = await readThrough(async (request) => (!request.user.includes("48 litres") ? notHere : JSON.stringify({
    found: true,
    answer: "Tangki bahan bakar genset memuat 48 liter solar.",
    quotes: [
      { line: 612, text: "fuel  tank holds\t48 litres" },
      { line: 612, text: "612: The generator's fuel tank" },
      { line: 611, text: "fuel tank holds 48 litres" },
      { line: 612, text: "fuel tank holds 60 litres" },
      { line: 4000, text: "Entry" },
      { line: 612, text: "" },
      "fuel tank",
    ],
  })), lines, { fromLine: 1, toLine: 900, question: "Berapa liter tangki genset?" });

  expect(reading).toMatchObject({
    answer: "Tangki bahan bakar genset memuat 48 liter solar.",
    quotes: [{ line: 612, text: "fuel tank holds 48 litres" }, { line: 612, text: "The generator's fuel tank" }],
    droppedQuotes: 5,
  });
});

test("at most 8 chunks are read; the rest is reported as unreadFrom, the first line not read", async () => {
  // 999-character numbered lines: 40 of them fill a chunk, so 400 lines would take 10 chunks.
  const lines = linesOf(400, 999), asked: Request[] = [];
  const reading = await readThrough(async (request) => { asked.push(request); return notHere; }, lines, { fromLine: 1, toLine: 400, question: "Kapan servis terakhir?" });
  expect(asked.length).toBe(8);
  expect(reading).toMatchObject({ read: { fromLine: 1, toLine: 320 }, unreadFrom: 321 });
});

test("when the model could not read a chunk, the reading stops before it and reports it as unreadFrom; with no chunk read there is no reading", async () => {
  const lines = linesOf(900, 100, (n) => (n === 100 ? "Last service: 2 September 2026, oil and filter changed" : `Entry ${n} of the generator maintenance log`));
  const second = (answer: string | null) => async (request: Request) => (numbersIn(request)[0] === 397 ? answer
    : request.user.includes("Last service") ? JSON.stringify({ found: true, answer: "Servis terakhir 2 September 2026.", quotes: [{ line: 100, text: "2 September 2026" }] }) : notHere);

  expect(await readThrough(second(null), lines, { fromLine: 1, toLine: 900, question: "Kapan servis terakhir?" })).toEqual({
    answer: "Servis terakhir 2 September 2026.", quotes: [{ line: 100, text: "2 September 2026" }], read: { fromLine: 1, toLine: 396 }, unreadFrom: 397,
  });
  expect(await readThrough(second("Sorry, I cannot help with that."), lines, { fromLine: 1, toLine: 900, question: "Kapan servis terakhir?" })).toMatchObject({ read: { fromLine: 1, toLine: 396 }, unreadFrom: 397 });
  expect(await readThrough(async () => null, lines, { fromLine: 1, toLine: 900, question: "Kapan servis terakhir?" })).toBeNull();
});

test("answers from several chunks are joined in file order, each labelled with its lines, without another model call", async () => {
  const lines = linesOf(900, 100, (n) => (n === 100 ? "Oil changed on 2 March 2026" : n === 700 ? "Oil changed on 2 September 2026" : `Entry ${n} of the generator maintenance log`));
  let calls = 0;
  const reading = await readThrough(async (request) => {
    calls++;
    const day = ["2 March 2026", "2 September 2026"].find((d) => request.user.includes(d));
    return day ? JSON.stringify({ found: true, answer: `Oli diganti ${day}.`, quotes: [] }) : notHere;
  }, lines, { fromLine: 1, toLine: 900, question: "Kapan oli diganti?" });
  expect(calls).toBe(3);
  expect(reading!.answer).toBe("[lines 1-396] Oli diganti 2 March 2026.\n\n[lines 397-792] Oli diganti 2 September 2026.");
});

test("without a question each chunk gives a summary and an outline; sections outside their chunk are dropped", async () => {
  const lines = linesOf(900, 100), asked: Request[] = [];
  const reading = await readThrough(async (request) => {
    asked.push(request);
    const [first, last] = [numbersIn(request)[0]!, numbersIn(request).at(-1)!];
    return "```json\n" + JSON.stringify({ summary: `Log entries ${first} to ${last}.`, outline: [{ title: `Entries from ${first}`, fromLine: first, toLine: last }, { title: "Invented", fromLine: last, toLine: last + 50 }] }) + "\n```";
  }, lines, { fromLine: 1, toLine: 900 });
  expect(asked.some((r) => r.user.includes("Question:"))).toBe(false);
  expect(reading).toEqual({
    answer: "[lines 1-396] Log entries 1 to 396.\n\n[lines 397-792] Log entries 397 to 792.\n\n[lines 793-900] Log entries 793 to 900.",
    outline: [{ title: "Entries from 1", fromLine: 1, toLine: 396 }, { title: "Entries from 397", fromLine: 397, toLine: 792 }, { title: "Entries from 793", fromLine: 793, toLine: 900 }],
    read: { fromLine: 1, toLine: 900 },
  });
});
