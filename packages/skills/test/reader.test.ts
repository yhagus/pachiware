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

test("a 900-line file is asked in three parallel chunks that cover it, each line numbered once", async () => {
  // 100-character numbered lines: 396 of them fill 39,996 characters of a 40,000-character chunk, the 397th would pass it.
  const lines = linesOf(900, 100), asked: Request[] = [];
  const reading = await readThrough(async (request) => { asked.push(request); return notHere; }, lines, { fromLine: 1, toLine: 900 }, { question: "Berapa liter tangki genset?" });

  const ranges = asked.map(numbersIn).map((n) => [n[0], n.at(-1)]).sort((a, b) => a[0]! - b[0]!);
  expect(ranges).toEqual([[1, 396], [397, 792], [793, 900]]);
  expect(asked.flatMap(numbersIn).sort((a, b) => a - b)).toEqual(Array.from({ length: 900 }, (_, i) => i + 1));
  expect(reading).toMatchObject({ read: { fromLine: 1, toLine: 900 } });
  expect(reading).not.toHaveProperty("unreadFrom");
});

test("the chunks are cut before the tool call must answer, with the time the call has, not a fixed budget", async () => {
  const lines = linesOf(900, 100), question = "Berapa liter tangki genset?";
  for (const left of [30_000, 200_000]) {
    const asked: Request[] = [], started = Date.now(), callDeadline = started + left;
    await readThrough(async (request) => { asked.push(request); return notHere; }, lines, { fromLine: 1, toLine: 900 }, { question, callDeadline });
    expect(asked.length).toBe(3);
    for (const { deadline } of asked) {
      expect(deadline!).toBeLessThan(callDeadline);
      expect(deadline! - started).toBeGreaterThan(left - 15_000);
    }
  }
});

test("with too little time left in the tool call, no chunk is started and the reading fails at once, saying why", async () => {
  let asked = 0;
  const reading = await readThrough(async () => { asked++; return notHere; }, linesOf(900, 100), { fromLine: 1, toLine: 900 }, { question: "Berapa liter tangki genset?", callDeadline: Date.now() + 8_000 });
  expect(asked).toBe(0);
  expect(reading).toEqual({ failed: expect.stringContaining("too little time") });
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
  })), lines, { fromLine: 1, toLine: 900 }, { question: "Berapa liter tangki genset?" });

  expect(reading).toMatchObject({
    answer: "Tangki bahan bakar genset memuat 48 liter solar.",
    quotes: [{ line: 612, text: "fuel tank holds 48 litres" }, { line: 612, text: "The generator's fuel tank" }],
    droppedQuotes: 5,
  });
});

test("a quote of a line outside the chunk its reader was given is dropped, even when the words are on that line", async () => {
  // Chunk 397-792 finds line 612 and also quotes line 100 word for word, a line it was never shown.
  const lines = linesOf(900, 100, (n) => (n === 612 ? "The generator's fuel tank holds 48 litres of diesel" : `Entry ${n} of the generator maintenance log`));
  const reading = await readThrough(async (request) => (!request.user.includes("48 litres") ? notHere : JSON.stringify({
    found: true, answer: "48 liter.", quotes: [{ line: 612, text: "fuel tank holds 48 litres" }, { line: 100, text: "Entry 100 of the generator maintenance log" }],
  })), lines, { fromLine: 1, toLine: 900 }, { question: "Berapa liter tangki genset?" });
  expect(reading).toMatchObject({ quotes: [{ line: 612, text: "fuel tank holds 48 litres" }], droppedQuotes: 1 });
});

test("the quotes of a chunk that found no answer are dropped, true as their words may be", async () => {
  const lines = linesOf(900, 100, (n) => (n === 612 ? "The generator's fuel tank holds 48 litres of diesel" : `Entry ${n} of the generator maintenance log`));
  const reading = await readThrough(async (request) => JSON.stringify(request.user.includes("48 litres")
    ? { found: true, answer: "48 liter.", quotes: [{ line: 612, text: "fuel tank holds 48 litres" }] }
    : { found: false, answer: "Bagian ini tidak menyebutnya.", quotes: [{ line: 5, text: "Entry 5 of the generator maintenance log" }] }), lines, { fromLine: 1, toLine: 900 }, { question: "Berapa liter tangki genset?" });
  expect(reading).toMatchObject({ quotes: [{ line: 612, text: "fuel tank holds 48 litres" }], droppedQuotes: 2 });
});

test("a quote of fewer than three words is dropped unless it is the whole line, whitespace aside", async () => {
  const lines = linesOf(900, 100, (n) => (n === 612 ? "Fill the generator's fuel tank: it holds 48 litres of diesel" : `Entry ${n} of the generator maintenance log`));
  // Line 613 is two words and nothing else, so quoting it whole holds.
  lines[612] = "48   litres";
  const reading = await readThrough(async (request) => (!request.user.includes("48 litres") ? notHere : JSON.stringify({
    found: true, answer: "48 liter.",
    quotes: [{ line: 612, text: "48" }, { line: 612, text: "the" }, { line: 612, text: "48 litres" }, { line: 612, text: "holds 48 litres" }, { line: 613, text: "48 litres" }],
  })), lines, { fromLine: 1, toLine: 900 }, { question: "Berapa liter tangki genset?" });
  expect(reading).toMatchObject({ quotes: [{ line: 612, text: "holds 48 litres" }, { line: 613, text: "48 litres" }], droppedQuotes: 3 });
});

test("when no chunk answers, the answer says the lines read, or the whole file, do not answer the question, not what one chunk said", async () => {
  const lines = linesOf(900, 100), noAnswer = async () => notHere, question = "Berapa liter tangki genset?";
  expect(await readThrough(noAnswer, lines, { fromLine: 1, toLine: 900 }, { question })).toMatchObject({ answer: "The whole file was read: it does not answer the question.", quotes: [] });
  expect(await readThrough(noAnswer, lines, { fromLine: 600, toLine: 620 }, { question })).toMatchObject({ answer: "Lines 600-620 were read: they do not answer the question.", quotes: [] });
});

test("a line longer than a chunk is reported as cut, not dropped unseen", async () => {
  // Line 3 is 50,000 characters, more than one 40,000-character chunk holds: the reader sees only its start.
  const lines = linesOf(30, 100);
  lines[2] = "A minified table row " + "x".repeat(50_000);
  const reading = await readThrough(async () => notHere, lines, { fromLine: 1, toLine: 30 }, { question: "Apa isi baris tiga?" });
  expect(reading).toMatchObject({ read: { fromLine: 1, toLine: 30 }, cutLines: [3] });
  expect(await readThrough(async () => notHere, linesOf(900, 100), { fromLine: 1, toLine: 900 }, { question: "Apa isi baris tiga?" })).not.toHaveProperty("cutLines");
});

test("at most 8 chunks are read; the rest is reported as unreadFrom, the first line not read, because of that limit", async () => {
  // 999-character numbered lines: 40 of them fill a chunk, so 400 lines would take 10 chunks.
  const lines = linesOf(400, 999), asked: Request[] = [];
  const reading = await readThrough(async (request) => { asked.push(request); return notHere; }, lines, { fromLine: 1, toLine: 400 }, { question: "Kapan servis terakhir?" });
  expect(asked.length).toBe(8);
  expect(reading).toMatchObject({ read: { fromLine: 1, toLine: 320 }, unreadFrom: 321, unreadBecause: "one readFile reads at most 8 chunks" });
});

test("when the model could not read a chunk, the reading stops before it and reports it as unreadFrom, because the model failed; with no chunk read the reading fails, saying so", async () => {
  const lines = linesOf(900, 100, (n) => (n === 100 ? "Last service: 2 September 2026, oil and filter changed" : `Entry ${n} of the generator maintenance log`));
  const second = (answer: string | null) => async (request: Request) => (numbersIn(request)[0] === 397 ? answer
    : request.user.includes("Last service") ? JSON.stringify({ found: true, answer: "Servis terakhir 2 September 2026.", quotes: [{ line: 100, text: "2 September 2026" }] }) : notHere);

  expect(await readThrough(second(null), lines, { fromLine: 1, toLine: 900 }, { question: "Kapan servis terakhir?" })).toEqual({
    answer: "Servis terakhir 2 September 2026.", quotes: [{ line: 100, text: "2 September 2026" }], read: { fromLine: 1, toLine: 396 }, unreadFrom: 397,
    unreadBecause: "the model failed or ran out of time on the part from this line",
  });
  expect(await readThrough(second("Sorry, I cannot help with that."), lines, { fromLine: 1, toLine: 900 }, { question: "Kapan servis terakhir?" })).toMatchObject({ read: { fromLine: 1, toLine: 396 }, unreadFrom: 397 });
  expect(await readThrough(async () => null, lines, { fromLine: 1, toLine: 900 }, { question: "Kapan servis terakhir?" })).toEqual({ failed: "the model could not read the file" });
});

test("answers from several chunks are joined in file order, each labelled with its lines, without another model call", async () => {
  const lines = linesOf(900, 100, (n) => (n === 100 ? "Oil changed on 2 March 2026" : n === 700 ? "Oil changed on 2 September 2026" : `Entry ${n} of the generator maintenance log`));
  let calls = 0;
  const reading = await readThrough(async (request) => {
    calls++;
    const day = ["2 March 2026", "2 September 2026"].find((d) => request.user.includes(d));
    return day ? JSON.stringify({ found: true, answer: `Oli diganti ${day}.`, quotes: [] }) : notHere;
  }, lines, { fromLine: 1, toLine: 900 }, { question: "Kapan oli diganti?" });
  expect(calls).toBe(3);
  expect(reading).toMatchObject({ answer: "[lines 1-396] Oli diganti 2 March 2026.\n\n[lines 397-792] Oli diganti 2 September 2026." });
});

test("a summary is asked in the place's language, not the file's", async () => {
  const systems = async (language: "id" | "en") => {
    const asked: Request[] = [];
    await readThrough(async (request) => { asked.push(request); return JSON.stringify({ summary: "Log.", outline: [] }); }, linesOf(900, 100), { fromLine: 1, toLine: 900 }, { language });
    return asked.map((r) => r.system);
  };
  for (const system of await systems("id")) expect(system).toContain("in Indonesian");
  for (const system of await systems("en")) expect(system).toContain("in English");
  for (const system of [...await systems("id"), ...await systems("en")]) expect(system).not.toContain("language of the file");
});

test("without a question each chunk gives a summary and an outline; sections outside their chunk are dropped", async () => {
  const lines = linesOf(900, 100), asked: Request[] = [];
  const reading = await readThrough(async (request) => {
    asked.push(request);
    const [first, last] = [numbersIn(request)[0]!, numbersIn(request).at(-1)!];
    return "```json\n" + JSON.stringify({ summary: `Log entries ${first} to ${last}.`, outline: [{ title: `Entries from ${first}`, fromLine: first, toLine: last }, { title: "Invented", fromLine: last, toLine: last + 50 }] }) + "\n```";
  }, lines, { fromLine: 1, toLine: 900 }, {});
  expect(asked.some((r) => r.user.includes("Question:"))).toBe(false);
  expect(reading).toEqual({
    answer: "[lines 1-396] Log entries 1 to 396.\n\n[lines 397-792] Log entries 397 to 792.\n\n[lines 793-900] Log entries 793 to 900.",
    outline: [{ title: "Entries from 1", fromLine: 1, toLine: 396 }, { title: "Entries from 397", fromLine: 397, toLine: 792 }, { title: "Entries from 793", fromLine: 793, toLine: 900 }],
    read: { fromLine: 1, toLine: 900 },
  });
});
