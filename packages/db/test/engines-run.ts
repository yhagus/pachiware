import { join } from "node:path";
import { MongoClient } from "mongodb";
import postgres from "postgres";
import { postgresTestDatabase, requireTestDatabase } from "./test-database.ts";

/** The tests that read the TEST_*_URL variables. `bun run test:engines` runs these, locally and in CI. */
export const ENGINE_TEST_PATHS = ["./packages/db", "./packages/cli", "./apps/agent/test/database-engine.test.ts"];

/** A TEST_*_URL to run against, and the compose service that serves it when the URL is the default one. */
export type EngineTarget = { kind: "postgres" | "replicaSet" | "standalone"; variable: string; url: string; service?: string };

export function engineTargets(env: Record<string, string | undefined>): EngineTarget[] {
  // The same defaults as docker-compose.yml, which reads the same variables from .env.
  const user = encodeURIComponent(env.POSTGRES_USER || "pachiware");
  const password = encodeURIComponent(env.POSTGRES_PASSWORD || "pachiware_secret");
  const target = (kind: EngineTarget["kind"], variable: string, url: string, service: string): EngineTarget => {
    const given = env[variable];
    if (!given) return { kind, variable, url, service };
    // A standalone server is refused before anything is written, so its database name doesn't matter.
    return { kind, variable, url: kind === "standalone" ? given : requireTestDatabase(variable, given) };
  };
  return [
    target("postgres", "TEST_POSTGRES_URL", `postgres://${user}:${password}@localhost:${env.POSTGRES_PORT || 5432}/pachiware_test`, "postgres"),
    target("replicaSet", "TEST_MONGODB_URL", `mongodb://localhost:${env.MONGO_PORT || 27017}/pachiware_test?replicaSet=rs0&directConnection=true`, "mongo"),
    target("standalone", "TEST_MONGODB_STANDALONE_URL", `mongodb://localhost:${env.MONGO_STANDALONE_PORT || 27018}/pachiware_test?directConnection=true`, "mongo-standalone"),
  ];
}

/** Whether the server answers and, for the replica set, has its member elected primary. */
async function isReady({ kind, url }: EngineTarget): Promise<boolean> {
  try {
    if (kind === "postgres") {
      const sql = postgres(postgresTestDatabase(url).serverUrl, { max: 1, connect_timeout: 2, onnotice: () => {} });
      try {
        await sql`SELECT 1`;
        return true;
      } finally {
        await sql.end({ timeout: 1 });
      }
    }
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 2000 });
    try {
      const hello = await client.db("admin").command({ hello: 1 });
      return kind !== "replicaSet" || hello.isWritablePrimary === true;
    } finally {
      await client.close();
    }
  } catch {
    return false;
  }
}

function docker(args: string[]): string {
  const result = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`docker ${args.join(" ")} failed:\n${result.stderr.toString()}`);
  return result.stdout.toString();
}

/**
 * Starts a compose service. A container of that name from another checkout is started rather than created
 * again; its name is returned, since it may use other credentials or ports than this checkout's .env.
 */
function startService(service: string): string | undefined {
  const container: string | undefined = JSON.parse(docker(["compose", "config", "--format", "json", service])).services[service]?.container_name;
  if (container && Bun.spawnSync(["docker", "container", "inspect", container], { stdout: "ignore", stderr: "ignore" }).exitCode === 0) {
    docker(["start", container]);
    return container;
  }
  docker(["compose", "up", "--detach", service]);
}

async function ensureServing(target: EngineTarget) {
  if (await isReady(target)) return;
  if (!target.service) throw new Error(`${target.variable} does not answer.`);
  console.log(`Starting the compose ${target.service} service`);
  const reused = startService(target.service);
  // The replica set is initiated by the service's health check, which runs every few seconds.
  for (const deadline = Date.now() + 120_000; Date.now() < deadline; await Bun.sleep(1000)) {
    if (await isReady(target)) return;
  }
  const notReady = `The compose ${target.service} service did not become ready for ${target.variable}.`;
  if (!reused) throw new Error(notReady);
  throw new Error(
    `${notReady} It started the existing container "${reused}", which another checkout may have created with different credentials or ports. ` +
      `Remove it (docker rm -f ${reused}) to create it from this checkout.`,
  );
}

async function ensurePostgresDatabase(url: string) {
  const { name, serverUrl } = postgresTestDatabase(url);
  const sql = postgres(serverUrl, { max: 1, onnotice: () => {} });
  try {
    const [found] = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!found) await sql`CREATE DATABASE ${sql(name)}`;
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const targets = engineTargets(process.env);
  for (const target of targets) await ensureServing(target);
  await ensurePostgresDatabase(targets.find((target) => target.kind === "postgres")!.url);
  const child = Bun.spawn(["bun", "test", ...ENGINE_TEST_PATHS, ...process.argv.slice(2)], {
    cwd: join(import.meta.dir, "../../.."),
    env: { ...process.env, ...Object.fromEntries(targets.map((target) => [target.variable, target.url])) },
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await child.exited);
}
