import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireTestDatabase } from "../../../packages/db/test/test-database.ts";

const workspace = process.cwd();
const agent = join(workspace, "apps/agent/src/index.ts");
const READY = "Agent REST API starting";
const directories: string[] = [];
const testMongoUrl = process.env.TEST_MONGODB_URL ? requireTestDatabase("TEST_MONGODB_URL", process.env.TEST_MONGODB_URL) : undefined;

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Starts the agent the way `pachiware start` does, in its own process, and stops it once it serves. */
async function startAgent({ databaseUrl, runtimeConfig }: { databaseUrl: string; runtimeConfig?: Record<string, unknown> }) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-engine-"));
  directories.push(directory);
  const installation = join(directory, "installation");
  mkdirSync(installation);
  const runtimeFile = join(directory, "runtime-config.json");
  if (runtimeConfig) writeFileSync(runtimeFile, JSON.stringify(runtimeConfig).replaceAll("<dir>", directory));

  const child = Bun.spawn({
    cmd: ["bun", agent],
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.replaceAll("<dir>", directory),
      PACHIWARE_DIR: installation,
      PACHIWARE_RUNTIME_CONFIG: runtimeFile,
      AGENT_PORT: "0",
      AGENT_HOST: "127.0.0.1",
      REDIS_URL: "redis://127.0.0.1:1",
      PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 41).toString("base64"),
      PLATFORM_ADMIN_KEY: "engine-test-key",
      NODE_ENV: "test",
    },
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  const reader = child.stdout.getReader();
  let output = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += new TextDecoder().decode(value);
    if (output.includes(READY)) break;
  }
  const started = output.includes(READY);
  child.kill();
  clearTimeout(timer);
  await child.exited;
  const errors = await new Response(child.stderr).text();
  return {
    started,
    errors,
    runtimeConfig: existsSync(runtimeFile) ? JSON.parse(readFileSync(runtimeFile, "utf8")) : null,
    installationFiles: readdirSync(installation, { recursive: true }).map(String),
    directory,
  };
}

/** The same server as a test MongoDB URL, in a database of its own. */
function testDatabase(url: string, suffix: string) {
  return url.replace(/^(mongodb(?:\+srv)?:\/\/[^/?]*)\/?([^?]*)/, (_, server, name) => `${server}/${name || "pachiware"}_${suffix}`);
}

type Request = { method: string; path: string; body?: unknown };

/** Sends requests to the agent's server in its own process, as the platform admin, and returns each status and body. */
function serverRequests(databaseUrl: string, requests: Request[], directory = mkdtempSync(join(tmpdir(), "pachiware-server-"))) {
  directories.push(directory);
  const result = Bun.spawnSync({
    cmd: ["bun", "--eval", `
      const { createServer } = await import(${JSON.stringify(join(workspace, "apps/agent/src/server.ts"))});
      const app = createServer();
      const admin = { "X-Platform-Key": "server-key", "Content-Type": "application/json" };
      const responses = [];
      for (const { method, path, body } of ${JSON.stringify(requests)}) {
        const res = await app.request(path, { method, headers: admin, body: body && JSON.stringify(body) });
        responses.push({ status: res.status, body: await res.text() });
      }
      console.log(JSON.stringify(responses));
      // An open MongoDB client would keep the process alive.
      process.exit(0);
    `],
    cwd: workspace,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PACHIWARE_RUNTIME_CONFIG: join(directory, "runtime-config.json"),
      PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 43).toString("base64"),
      PLATFORM_ADMIN_KEY: "server-key",
      NODE_ENV: "test",
    },
  });
  const output = new TextDecoder().decode(result.stdout).trim().split("\n").at(-1)!;
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return { responses: JSON.parse(output) as { status: number; body: string }[], files: readdirSync(directory) };
}

/** Calls the admin infrastructure API in its own process, against a database URL that is never connected to. */
function infrastructureApi(databaseUrl: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-infra-"));
  const other = { databaseUrl: `sqlite:${directory}/other.db` };
  const { responses: [get, change, test], files } = serverRequests(databaseUrl, [
    { method: "GET", path: "/api/admin/infrastructure" },
    { method: "PUT", path: "/api/admin/infrastructure", body: other },
    { method: "POST", path: "/api/admin/infrastructure/test-db", body: other },
  ], directory);
  return { get: get!, change: change!, test: test!, files };
}

describe("admin infrastructure API", () => {
  test("shows the engine and the host without credentials, and cannot change or test the database", () => {
    const api = infrastructureApi("postgresql://pachiware:hunter2-secret@db.example.internal:6543/pachiware_agent");
    expect(api.get.status).toBe(200);
    expect(JSON.parse(api.get.body).infrastructure).toMatchObject({ databaseEngine: "postgres", databaseHost: "db.example.internal:6543" });
    expect(api.get.body).not.toContain("hunter2-secret");
    expect(api.get.body).not.toContain("pachiware_agent");
    expect(api.change.status).toBe(400);
    expect(JSON.parse(api.change.body).error).toContain("cannot be changed");
    expect(api.test.status).toBe(404);
    expect(api.files).toEqual([]);
  });

  test("a MongoDB replica set shows every member, without credentials or database name", () => {
    const api = infrastructureApi("mongodb://app:hunter2-secret@db1.internal:27017,db2.internal:27018/pachiware_prod?replicaSet=rs0");
    expect(JSON.parse(api.get.body).infrastructure).toMatchObject({ databaseEngine: "mongodb", databaseHost: "db1.internal:27017,db2.internal:27018" });
    expect(api.get.body).not.toContain("hunter2-secret");
    expect(api.get.body).not.toContain("pachiware_prod");
  });

  test("a SQLite installation has no host to show", () => {
    const api = infrastructureApi("sqlite::memory:");
    expect(JSON.parse(api.get.body).infrastructure).toMatchObject({ databaseEngine: "sqlite", databaseHost: null });
  });

  test.skipIf(!testMongoUrl)("on MongoDB the health check reports the database answering, and stats show its size", () => {
    const { responses: [health, stats] } = serverRequests(testDatabase(testMongoUrl!, "server"), [
      { method: "GET", path: "/api/health" },
      { method: "GET", path: "/api/admin/stats" },
    ]);
    expect(JSON.parse(health!.body).services).toMatchObject({ database: "healthy", databaseEngine: "mongodb" });
    expect(stats!.status, stats!.body).toBe(200);
    expect(JSON.parse(stats!.body)).toMatchObject({ tenants: 0, bots: 0 });
    // Nothing migrated this database, so it may hold no bytes yet; null would mean the size could not be read.
    expect(JSON.parse(stats!.body).storage.dbBytes).toBeNumber();
  }, 30_000);
});

describe("database engine lock at start-up", () => {
  test("a fresh install records its engine after the first successful migration", async () => {
    const result = await startAgent({ databaseUrl: "sqlite:<dir>/pachiware.db" });
    expect(result.started, result.errors).toBe(true);
    expect(result.runtimeConfig).toEqual({ databaseEngine: "sqlite" });
  }, 30_000);

  test("an existing install records the engine it uses today on its first start after upgrading", async () => {
    // Switched from the Web GUI earlier: the runtime file's URL wins over .env.
    const result = await startAgent({
      databaseUrl: "postgresql://pachiware:secret@127.0.0.1:1/pachiware_agent",
      runtimeConfig: { databaseUrl: "sqlite:<dir>/switched.db", gitAllowedHosts: ["gitlab.corp.example"] },
    });
    expect(result.started, result.errors).toBe(true);
    expect(result.runtimeConfig).toEqual({ databaseUrl: `sqlite:${result.directory}/switched.db`, gitAllowedHosts: ["gitlab.corp.example"], databaseEngine: "sqlite" });
  }, 30_000);

  test("a URL of another engine stops the start before connecting, naming both engines", async () => {
    const toPostgres = await startAgent({ databaseUrl: "postgresql://pachiware:secret@127.0.0.1:1/pachiware_agent", runtimeConfig: { databaseEngine: "sqlite" } });
    expect(toPostgres.started).toBe(false);
    expect(toPostgres.errors).toContain("This installation keeps its records in SQLite, but the database URL points at PostgreSQL.");
    expect(toPostgres.errors).toContain("Moving between database engines is not supported.");

    const toSqlite = await startAgent({ databaseUrl: "sqlite:./data/pachiware.db", runtimeConfig: { databaseEngine: "postgres" } });
    expect(toSqlite.started).toBe(false);
    expect(toSqlite.errors).toContain("keeps its records in PostgreSQL, but the database URL points at SQLite.");
    expect(toSqlite.installationFiles).toEqual([]);
    expect(toSqlite.runtimeConfig).toEqual({ databaseEngine: "postgres" });
  }, 60_000);

  test("a new address on the same engine starts normally", async () => {
    const sqlite = await startAgent({ databaseUrl: "sqlite:<dir>/moved.db", runtimeConfig: { databaseEngine: "sqlite" } });
    expect(sqlite.started, sqlite.errors).toBe(true);
    expect(sqlite.runtimeConfig).toEqual({ databaseEngine: "sqlite" });

    // Unreachable, so the agent starts in setup mode; the lock lets it through.
    const postgres = await startAgent({ databaseUrl: "postgresql://pachiware:rotated@127.0.0.1:1/pachiware_agent", runtimeConfig: { databaseEngine: "postgres" } });
    expect(postgres.started, postgres.errors).toBe(true);
    expect(postgres.runtimeConfig).toEqual({ databaseEngine: "postgres" });
  }, 60_000);

  test("an unknown scheme fails with a clear error and creates no file", async () => {
    const result = await startAgent({ databaseUrl: "mysql://pachiware:secret@localhost/pachiware" });
    expect(result.started).toBe(false);
    expect(result.errors).toContain('Unknown database URL scheme "mysql:"');
    expect(result.errors).not.toContain("secret");
    expect(result.installationFiles).toEqual([]);
    expect(result.runtimeConfig).toBeNull();
  }, 30_000);

  test("switching to or from MongoDB after records exist stops the start, naming both engines", async () => {
    const toMongo = await startAgent({ databaseUrl: "mongodb+srv://pachiware:secret@cluster0.example.net/pachiware", runtimeConfig: { databaseEngine: "sqlite" } });
    expect(toMongo.started).toBe(false);
    expect(toMongo.errors).toContain("keeps its records in SQLite, but the database URL points at MongoDB.");
    expect(toMongo.errors).not.toContain("secret");

    const fromMongo = await startAgent({ databaseUrl: "postgresql://pachiware:secret@127.0.0.1:1/pachiware_agent", runtimeConfig: { databaseEngine: "mongodb" } });
    expect(fromMongo.started).toBe(false);
    expect(fromMongo.errors).toContain("keeps its records in MongoDB, but the database URL points at PostgreSQL.");
    expect(fromMongo.runtimeConfig).toEqual({ databaseEngine: "mongodb" });
  }, 60_000);

  test("a new MongoDB address passes the lock, and an unreachable one starts in setup mode", async () => {
    const result = await startAgent({ databaseUrl: "mongodb://pachiware:rotated@127.0.0.1:1/pachiware?serverSelectionTimeoutMS=500", runtimeConfig: { databaseEngine: "mongodb" } });
    expect(result.started, result.errors).toBe(true);
    expect(result.runtimeConfig).toEqual({ databaseEngine: "mongodb" });
  }, 30_000);

  test.skipIf(!testMongoUrl)("a fresh install on a MongoDB replica set starts and records its engine", async () => {
    const result = await startAgent({ databaseUrl: testDatabase(testMongoUrl!, "agent_start") });
    expect(result.started, result.errors).toBe(true);
    expect(result.runtimeConfig).toEqual({ databaseEngine: "mongodb" });
    expect(result.installationFiles).not.toContain(join("data", "pachiware.db"));
  }, 30_000);

  test.skipIf(!process.env.TEST_MONGODB_STANDALONE_URL)("a standalone MongoDB stops the start, saying a replica set is required", async () => {
    const result = await startAgent({ databaseUrl: process.env.TEST_MONGODB_STANDALONE_URL! });
    expect(result.started).toBe(false);
    expect(result.errors).toContain("MongoDB must run as a replica set");
    expect(result.runtimeConfig).toBeNull();
  }, 30_000);

  test("an empty URL still uses the SQLite default", async () => {
    const result = await startAgent({ databaseUrl: "" });
    expect(result.started, result.errors).toBe(true);
    expect(result.installationFiles).toContain(join("data", "pachiware.db"));
    expect(result.runtimeConfig).toEqual({ databaseEngine: "sqlite" });
  }, 30_000);
});
