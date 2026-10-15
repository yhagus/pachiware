import { Hono } from "hono";
import os from "node:os";
import { statfs, readFile } from "node:fs/promises";
import { db, bots, repositories } from "@pachiware/db";
import { redis, isRedisConnected, memoryCache } from "../../cache/redis.js";
import { ne, sql } from "drizzle-orm";
export const statsAdminRoutes = new Hono();

// CPU and disk I/O are rates, so a single background sampler computes them; requests just read the latest sample.
let prevCpu = cpuTimes();
let cpuPercent = 0;
let ioRate: { readBps: number; writeBps: number } | null = null;
let prevIo: { at: number; read: number; write: number } | null = null;
function cpuTimes() {
  let idle = 0, total = 0;
  for (const { times } of os.cpus()) { idle += times.idle; total += times.user + times.nice + times.sys + times.idle + times.irq; }
  return { idle, total };
}
// ponytail: disk I/O comes from /proc/diskstats (Linux only, 512-byte sectors); null elsewhere. Add `iostat` parsing for macOS if needed.
async function diskIo() {
  try {
    let read = 0, write = 0;
    for (const line of (await readFile("/proc/diskstats", "utf8")).split("\n")) {
      const f = line.trim().split(/\s+/);
      if (f.length > 9 && /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(f[2])) { read += +f[5] * 512; write += +f[9] * 512; }
    }
    const now = Date.now(), prev = prevIo;
    prevIo = { at: now, read, write };
    if (!prev || now === prev.at) return null;
    const s = (now - prev.at) / 1000;
    return { readBps: Math.max(0, (read - prev.read) / s), writeBps: Math.max(0, (write - prev.write) / s) };
  } catch { return null; }
}

setInterval(async () => {
  const cpu = cpuTimes();
  const dTotal = cpu.total - prevCpu.total;
  if (dTotal > 0) cpuPercent = (1 - (cpu.idle - prevCpu.idle) / dTotal) * 100;
  prevCpu = cpu;
  ioRate = await diskIo();
}, 2000).unref();

async function cacheSize(): Promise<number | null> {
  if (!isRedisConnected()) return memoryCache.size();
  try {
    const m = /used_memory:(\d+)/.exec(await redis.info("memory"));
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

statsAdminRoutes.get("/stats", async (c) => {
  const disk = await statfs(process.cwd());
  const diskTotal = disk.blocks * disk.bsize;
  const count = async (table: any, col: any) => Number((await db.select({ n: sql<number>`count(*)` }).from(table).where(ne(col, "deleted")))[0]?.n ?? 0);
  return c.json({
    success: true,
    tenants: await repositories().tenants.count(),
    bots: await count(bots, bots.connectionStatus),
    storage: { dbBytes: await repositories().stats.databaseBytes(), cacheBytes: await cacheSize() },
    system: {
      cpu: { percent: Math.round(cpuPercent * 10) / 10, cores: os.cpus().length },
      memory: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
      disk: { used: diskTotal - disk.bavail * disk.bsize, total: diskTotal },
      diskIo: ioRate,
    },
  });
});
