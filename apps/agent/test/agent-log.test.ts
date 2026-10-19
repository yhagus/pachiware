import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLog, installAgentLog, logAt, logDir } from "../src/logs/agentLog";

const dirs: string[] = [];
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), "pachiware-logs-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A clock the test moves by hand. */
function clock(iso: string) {
  let t = Date.parse(iso);
  return { now: () => new Date(t), set: (next: string) => { t = Date.parse(next); } };
}
const lines = (dir: string, name: string) => readFileSync(join(dir, name), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("a line kept in the agent log", () => {
  test("keeps its level, its leading tag as the source, and its text without colors", () => {
    const log = new AgentLog(fresh());
    expect(log.record("info", ["[HTTP] GET /api/admin/tenants - 200 (3ms)"])).toMatchObject({ level: "info", source: "http", text: "GET /api/admin/tenants - 200 (3ms)" });
    expect(log.record("info", ["  [+] Registered skill: Plane"])).toMatchObject({ source: "agent", text: "  [+] Registered skill: Plane" });
    expect(log.record("warn", ["[daily-log] could not write c1 2026-10-18"])).toMatchObject({ level: "warn", source: "daily-log" });
    expect(log.record("error", ["\x1b[31mboom\x1b[0m"]).text).toBe("boom");
    expect(log.record("info", ["%d of %s done", 3, "five"]).text).toBe("3 of five done");
    const failed = log.record("error", ["Fatal startup error in Pachiware Agent:", new Error("kaput")]);
    expect(failed.text).toStartWith("Fatal startup error in Pachiware Agent: Error: kaput");
    expect(failed.text).toContain("\n");
  });

  test("text shaped like a credential is masked before it is kept, in memory and in the file", () => {
    const dir = fresh();
    const log = new AgentLog(dir, 7, 5000, () => new Date("2026-10-19T08:00:00Z"));
    const key = "pk_live_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
    expect(log.record("info", [`Bootstrap API key (shown once): ${key}`]).text).toBe("Bootstrap API key (shown once): pk_live_••••");
    expect(log.record("info", ["Authorization: Bearer abcdefghijklmnopqrstuv"]).text).toBe("Authorization: Bearer ••••");
    // Put together here, so the source holds nothing shaped like a real token for secret scanners to flag.
    const botToken = ["A".repeat(24), "B".repeat(6), "C".repeat(38)].join(".");
    expect(log.record("info", [`token ${botToken} used`]).text).toBe("token •••• used");
    expect(readFileSync(join(dir, "agent-2026-10-19.jsonl"), "utf8")).not.toContain(key);
  });

  test("goes to the file of its UTC day", () => {
    const dir = fresh(), c = clock("2026-10-19T23:59:59Z");
    const log = new AgentLog(dir, 7, 5000, c.now);
    log.record("info", ["late"]);
    c.set("2026-10-20T00:00:01Z");
    log.record("info", ["early"]);
    expect(readdirSync(dir).sort()).toEqual(["agent-2026-10-19.jsonl", "agent-2026-10-20.jsonl"]);
    expect(lines(dir, "agent-2026-10-19.jsonl").map((e) => e.text)).toEqual(["late"]);
    expect(lines(dir, "agent-2026-10-20.jsonl")[0]).toMatchObject({ text: "early", seq: 2, time: "2026-10-20T00:00:01.000Z", run: log.run });
  });

  test("that cannot be written to its file stays in memory, and the failure is told once until a write works", () => {
    const blocker = join(fresh(), "not-a-folder");
    writeFileSync(blocker, "");
    const log = new AgentLog(blocker);
    const told: string[] = [];
    log.onFileError = (e) => told.push(e.message);
    log.record("info", ["one"]);
    log.record("info", ["two"]);
    expect(told.length).toBe(1);
    expect(log.recent(log.run, 0).map((e) => e.text)).toEqual(["one", "two"]);
  });
});

describe("the newest lines in memory", () => {
  test("are kept up to the limit; this run's are replayed after a seq, and all of them for another run", () => {
    const log = new AgentLog(fresh(), 7, 3);
    for (const n of [1, 2, 3, 4, 5]) log.record("info", [`line ${n}`]);
    expect(log.recent(log.run, 0).map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(log.recent(log.run, 4).map((e) => e.seq)).toEqual([5]);
    expect(log.recent("an-earlier-run", 4).map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(log.cursor).toBe(5);
  });

  test("reach every subscriber until it unsubscribes", () => {
    const log = new AgentLog(fresh());
    const got: string[] = [];
    const off = log.subscribe((e) => got.push(e.text));
    log.record("info", ["a"]);
    off();
    log.record("info", ["b"]);
    expect(got).toEqual(["a"]);
  });
});

describe("a query over the day files", () => {
  async function twoDays() {
    const dir = fresh(), c = clock("2026-10-18T10:00:00Z");
    const log = new AgentLog(dir, 7, 5000, c.now);
    log.record("info", ["[HTTP] GET /api/admin/tenants - 200 (2ms)"]);
    c.set("2026-10-18T22:00:00Z");
    log.record("warn", ["[llm] Provider request failed."]);
    c.set("2026-10-19T01:00:00Z");
    log.record("error", ["[turn] tenant t1 bot b1 channel c1 failed: Timeout"]);
    c.set("2026-10-19T02:00:00Z");
    log.record("info", ["[HTTP] POST /api/admin/bots - 201 (9ms)"]);
    c.set("2026-10-19T03:00:00Z");
    log.record("error", ["[llm] Provider rejected the request (401)."]);
    return log;
  }
  const texts = (page: { entries: { text: string }[] }) => page.entries.map((e) => e.text);

  test("reads every day it touches, oldest first, and leaves out lines outside the range", async () => {
    const log = await twoDays();
    expect(texts(await log.query({ limit: 100 }))).toEqual([
      "GET /api/admin/tenants - 200 (2ms)", "Provider request failed.", "tenant t1 bot b1 channel c1 failed: Timeout", "POST /api/admin/bots - 201 (9ms)", "Provider rejected the request (401).",
    ]);
    const night = await log.query({ from: new Date("2026-10-18T20:00:00Z"), to: new Date("2026-10-19T02:00:00Z"), limit: 100 });
    expect(texts(night)).toEqual(["Provider request failed.", "tenant t1 bot b1 channel c1 failed: Timeout", "POST /api/admin/bots - 201 (9ms)"]);
    expect(night.sources).toEqual(["http", "llm", "turn"]);
  });

  test("filters by level, source and words, and names every source in the range whatever the filters", async () => {
    const log = await twoDays();
    expect(texts(await log.query({ levels: ["error"], limit: 100 }))).toEqual(["tenant t1 bot b1 channel c1 failed: Timeout", "Provider rejected the request (401)."]);
    const llm = await log.query({ sources: ["llm"], limit: 100 });
    expect(texts(llm)).toEqual(["Provider request failed.", "Provider rejected the request (401)."]);
    expect(llm.sources).toEqual(["http", "llm", "turn"]);
    expect(texts(await log.query({ q: "PROVIDER", limit: 100 }))).toEqual(["Provider request failed.", "Provider rejected the request (401)."]);
    expect(texts(await log.query({ q: "PROVIDER", caseSensitive: true, limit: 100 }))).toEqual([]);
    expect(texts(await log.query({ q: "\\((401|403)\\)", regex: true, limit: 100 }))).toEqual(["Provider rejected the request (401)."]);
    expect(texts(await log.query({ q: "turn", limit: 100 }))).toEqual(["tenant t1 bot b1 channel c1 failed: Timeout"]);
  });

  test("keeps the newest matches up to the limit and says it cut", async () => {
    const log = await twoDays();
    const page = await log.query({ limit: 2 });
    expect(texts(page)).toEqual(["POST /api/admin/bots - 201 (9ms)", "Provider rejected the request (401)."]);
    expect(page.truncated).toBe(true);
    expect((await log.query({ limit: 5 })).truncated).toBe(false);
  });

  test("throws on a regular expression that does not compile", async () => {
    const log = await twoDays();
    await expect(log.query({ q: "(", regex: true, limit: 10 })).rejects.toThrow();
  });
});

describe("old day files", () => {
  test("are removed past the retention, today counting as one day; other files stay", () => {
    const dir = fresh();
    for (const day of ["2026-10-10", "2026-10-12", "2026-10-13", "2026-10-19"]) writeFileSync(join(dir, `agent-${day}.jsonl`), "");
    writeFileSync(join(dir, "notes.txt"), "keep");
    const log = new AgentLog(dir, 7, 5000, () => new Date("2026-10-19T12:00:00Z"));
    expect(log.prune().map((p) => p.slice(dir.length + 1))).toEqual(["agent-2026-10-10.jsonl", "agent-2026-10-12.jsonl"]);
    expect(readdirSync(dir).sort()).toEqual(["agent-2026-10-13.jsonl", "agent-2026-10-19.jsonl", "notes.txt"]);
  });
});

describe("installing the agent log", () => {
  test("sends console lines to the log as well as the terminal, prunes at once, and restoring puts console back", () => {
    const dir = fresh();
    writeFileSync(join(dir, "agent-2020-01-01.jsonl"), "");
    const log = new AgentLog(dir);
    const restore = installAgentLog(log);
    try {
      console.warn("[llm] Provider request failed.");
      console.debug("details");
    } finally {
      restore();
    }
    console.log("after restore");
    expect(log.recent(log.run, 0).map(({ level, source, text }) => ({ level, source, text }))).toEqual([
      { level: "warn", source: "llm", text: "Provider request failed." },
      { level: "debug", source: "agent", text: "details" },
    ]);
    expect(readdirSync(dir)).not.toContain("agent-2020-01-01.jsonl");
  });
});

describe("logAt", () => {
  test("keeps the line at its level while the terminal gets it on standard output, as console.log would", () => {
    const real = { log: console.log, warn: console.warn };
    const terminal: string[] = [];
    console.log = (...args: unknown[]) => { terminal.push(`stdout ${args.join(" ")}`); };
    console.warn = (...args: unknown[]) => { terminal.push(`stderr ${args.join(" ")}`); };
    const log = new AgentLog(fresh());
    try {
      const restore = installAgentLog(log);
      logAt("warn", "[HTTP] GET /api/admin/nope - 404 (1ms)");
      restore();
      logAt("error", "not installed");
    } finally {
      Object.assign(console, real);
    }
    expect(terminal).toEqual(["stdout [HTTP] GET /api/admin/nope - 404 (1ms)", "stdout not installed"]);
    expect(log.recent(log.run, 0).map(({ level, source, text }) => ({ level, source, text }))).toEqual([{ level: "warn", source: "http", text: "GET /api/admin/nope - 404 (1ms)" }]);
  });
});

describe("the log folder", () => {
  test("is LOG_DIR resolved against PACHIWARE_DIR, or data/logs there", () => {
    expect(logDir({ PACHIWARE_DIR: "/srv/pachiware" })).toBe("/srv/pachiware/data/logs");
    expect(logDir({ PACHIWARE_DIR: "/srv/pachiware", LOG_DIR: "logs" })).toBe("/srv/pachiware/logs");
    expect(logDir({ PACHIWARE_DIR: "/srv/pachiware", LOG_DIR: "/var/log/pachiware" })).toBe("/var/log/pachiware");
  });
});
