import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { agentLog, logLine, LOG_LEVELS, type LogEntry, type LogLevel, type LogQuery } from "../../logs/agentLog.js";

/** The agent's own logs for the Console page: history from the day files, and the live tail (ADR 0017). */
export const logAdminRoutes = new Hono();

const bad = (message: string) => new HTTPException(400, { message });
const JSON_LIMIT = 5000, TEXT_LIMIT = 100_000;
/** A comment line now and then keeps an idle stream open through proxies, and tells a dead client apart. */
const HEARTBEAT_MS = 15_000;
/** Lines held for a client that reads slower than the agent logs; past this the oldest are dropped. */
const MAX_QUEUED = 5000;

function time(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad(`${name} must be a date and time, such as 2026-10-19T08:00:00Z`);
  return d;
}

const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function queryOf(c: { req: { query(name: string): string | undefined } }, max: number): LogQuery {
  const levels = list(c.req.query("level"));
  const unknown = levels.filter((l) => !LOG_LEVELS.includes(l as LogLevel));
  if (unknown.length) throw bad(`level must be among ${LOG_LEVELS.join(", ")}`);
  const q = c.req.query("q") || undefined, regex = c.req.query("regex") === "1";
  if (q && q.length > 500) throw bad("q must be at most 500 characters");
  if (q && regex) { try { new RegExp(q); } catch { throw bad("q is not a valid regular expression"); } }
  const limit = Number(c.req.query("limit") ?? max);
  if (!Number.isInteger(limit) || limit < 1) throw bad("limit must be a whole number above 0");
  return {
    from: time(c.req.query("from"), "from"), to: time(c.req.query("to"), "to"),
    levels: levels as LogLevel[], sources: list(c.req.query("source")).map((s) => s.toLowerCase()),
    q, regex, caseSensitive: c.req.query("case") === "1", limit: Math.min(limit, max),
  };
}

// The newest matching lines in the range, oldest first. `run` and `cursor` say where the live tail should start, so nothing
// logged while the files were read is missed (a line may come twice; its id tells).
logAdminRoutes.get("/logs", async (c) => {
  const text = c.req.query("format") === "text";
  const query = queryOf(c, text ? TEXT_LIMIT : JSON_LIMIT);
  const log = agentLog();
  const cursor = log.cursor;
  const page = await log.query(query);
  if (text) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return c.body(page.entries.map(logLine).join("\n") + (page.entries.length ? "\n" : ""), 200, {
      "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="pachiware-agent-${stamp}.log"`,
    });
  }
  return c.json({ success: true, ...page, run: log.run, cursor, retentionDays: log.retentionDays, dir: log.dir });
});

// Server-sent events: `hello` with the run, every line of this run after `after` (all lines in memory after a restart), then
// each new line as `log`.
logAdminRoutes.get("/logs/stream", (c) => {
  const log = agentLog();
  const after = Number(c.req.query("after") ?? 0) || 0;
  // Bun closes a quiet connection after its idle timeout; this one is meant to stay open.
  (c.env as { timeout?: (req: Request, seconds: number) => void } | undefined)?.timeout?.(c.req.raw, 0);
  return streamSSE(c, async (stream) => {
    const queue: LogEntry[] = log.recent(c.req.query("run"), after);
    let wake: (() => void) | null = null;
    const off = log.subscribe((entry) => {
      queue.push(entry);
      if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
      wake?.();
    });
    let open = true;
    stream.onAbort(() => { open = false; wake?.(); });
    try {
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ run: log.run }) });
      while (open) {
        while (open && queue.length) {
          const entry = queue.shift()!;
          await stream.writeSSE({ event: "log", id: entry.id, data: JSON.stringify(entry) });
        }
        if (!open) break;
        const woke = await Promise.race([new Promise<boolean>((r) => { wake = () => r(true); }), stream.sleep(HEARTBEAT_MS).then(() => false)]);
        wake = null;
        if (!woke && open) await stream.write(": ping\n\n");
      }
    } finally {
      off();
    }
  });
});
