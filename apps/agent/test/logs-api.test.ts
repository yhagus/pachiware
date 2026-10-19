import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const src = (path: string) => JSON.stringify(join(workspace, path));

// Each scenario runs in its own process, with its own database and log folder, as the agent would.
function scenario(name: string, body: string) {
  test(name, () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-logs-api-"));
    try {
      const result = Bun.spawnSync({
        cmd: ["bun", "--eval", `
          const assert = (condition, message) => { if (!condition) throw new Error(message); };
          const { runMigrations } = await import(${src("packages/db/src/migrate.ts")}); const { runSeed } = await import(${src("packages/db/src/seed.ts")});
          await runMigrations(); await runSeed();
          const { agentLog, installAgentLog } = await import(${src("apps/agent/src/logs/agentLog.ts")});
          const { createServer } = await import(${src("apps/agent/src/server.ts")}); const app = createServer();
          const admin = { "X-Platform-Key": "logs-admin-key" };
          const get = (path, headers = admin) => app.request("/api/admin" + path, { headers });
          const read = async (path) => { const res = await get(path); const json = await res.json(); assert(res.status === 200, path + " gave " + res.status + " " + JSON.stringify(json)); return json; };
          const log = agentLog();
          ${body}
          console.log(JSON.stringify({ ok: true }));
        `],
        cwd: workspace,
        env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "logs.db")}`, LOG_DIR: join(directory, "logs"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 43).toString("base64"), PLATFORM_ADMIN_KEY: "logs-admin-key", NODE_ENV: "test" },
      });
      const out = new TextDecoder().decode(result.stdout), err = new TextDecoder().decode(result.stderr);
      expect(result.exitCode, err + out).toBe(0);
      expect(out.trim().split("\n").at(-1)).toBe(JSON.stringify({ ok: true }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30000);
}

scenario("the history is only for the platform admin, filtered on the server, newest kept, and downloadable as text", `
  assert((await get("/logs", {})).status === 401 || (await get("/logs", {})).status === 403, "logs readable without the platform key");
  log.record("info", ["[HTTP] GET /api/admin/tenants - 200 (2ms)"]);
  log.record("warn", ["[llm] Provider request failed."]);
  log.record("error", ["[llm] Provider rejected the request (401)."]);
  const all = await read("/logs");
  assert(all.entries.map((e) => e.text).join("|") === "GET /api/admin/tenants - 200 (2ms)|Provider request failed.|Provider rejected the request (401).", "history wrong: " + JSON.stringify(all.entries));
  assert(all.run === log.run && all.cursor === 3 && all.truncated === false && all.sources.join() === "http,llm" && all.retentionDays === 7 && all.dir === process.env.LOG_DIR, "page fields wrong: " + JSON.stringify({ ...all, entries: undefined }));
  assert((await read("/logs?level=error")).entries.map((e) => e.text).join() === "Provider rejected the request (401).", "level filter");
  assert((await read("/logs?source=HTTP")).entries.length === 1, "source filter");
  assert((await read("/logs?q=" + encodeURIComponent("\\\\(40[13]\\\\)") + "&regex=1")).entries.length === 1, "regex search");
  const newest = await read("/logs?limit=1");
  assert(newest.entries[0].text === "Provider rejected the request (401)." && newest.truncated === true, "limit keeps the newest");
  assert((await read("/logs?from=2100-01-01T00:00:00Z")).entries.length === 0, "from filter");
  for (const [path, words] of [["/logs?level=loud", "level"], ["/logs?q=(&regex=1", "regular expression"], ["/logs?from=yesterday", "from"], ["/logs?limit=0", "limit"]]) {
    const res = await get(path);
    const json = await res.json();
    assert(res.status === 400 && json.error.includes(words), path + " gave " + res.status + " " + JSON.stringify(json));
  }
  const text = await get("/logs?format=text&level=warn,error");
  const body = await text.text();
  assert(text.headers.get("content-type").startsWith("text/plain") && /^attachment; filename="pachiware-agent-[0-9-]+\\.log"$/.test(text.headers.get("content-disposition")), "download headers: " + JSON.stringify([...text.headers]));
  const rows = body.trim().split("\\n");
  assert(rows.length === 2 && /^\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z WARN  \\[llm\\] Provider request failed\\.$/.test(rows[0]) && rows[1].includes("ERROR [llm] Provider rejected"), "download lines: " + body);
`);

scenario("the stream replays this run's lines after the cursor, then sends each new line as it is logged", `
  log.record("info", ["before the page"]);
  const page = await read("/logs");
  log.record("info", ["while the page loaded"]);
  const res = await get("/logs/stream?run=" + page.run + "&after=" + page.cursor);
  assert(res.status === 200 && res.headers.get("content-type").startsWith("text/event-stream"), "stream not opened: " + res.status);
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const next = async (event) => {
    for (;;) {
      const at = buffer.indexOf("\\n\\n");
      if (at >= 0) {
        const block = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
        if (name === event) return JSON.parse(data);
        continue;
      }
      const { value, done } = await Promise.race([reader.read(), Bun.sleep(3000).then(() => { throw new Error("no " + event + " event within 3 s; got " + buffer); })]);
      if (done) throw new Error("stream ended");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  assert((await next("hello")).run === log.run, "hello names another run");
  assert((await next("log")).text === "while the page loaded", "the line logged while the page loaded was not replayed");
  log.record("warn", ["[discord] Notice during bot startup: offline"]);
  const live = await next("log");
  assert(live.text === "Notice during bot startup: offline" && live.source === "discord" && live.level === "warn" && live.id === log.run + "-3", "live line wrong: " + JSON.stringify(live));
  await reader.cancel();
  await Bun.sleep(20);
  log.record("info", ["after the page closed"]);
`);

scenario("the HTTP log leaves out the Console page's own requests, and a refused request is a warning", `
  const restore = installAgentLog(log);
  await get("/logs");
  await get("/tenants");
  await get("/tenants", {});
  await get("/no-such-route");
  restore();
  const http = log.recent(log.run, 0).filter((e) => e.source === "http").map((e) => e.level + " " + e.text.replace(/ \\(\\d+ms\\)$/, ""));
  assert(JSON.stringify(http) === JSON.stringify(["info GET /api/admin/tenants - 200", "warn GET /api/admin/tenants - 401", "warn GET /api/admin/no-such-route - 404"]), "HTTP lines: " + JSON.stringify(http));
`);
