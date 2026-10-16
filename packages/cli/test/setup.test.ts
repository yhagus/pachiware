import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseDatabase } from "../src/database-choice";

const workspace = process.cwd();
const cli = join(workspace, "packages/cli/src/index.ts");
const dbSource = join(workspace, "packages/db/src");

function text(data: Uint8Array | undefined) {
  return new TextDecoder().decode(data).trim();
}

/** Runs `pachiware init` on a fresh target holding `files`, without the developer's keys or database URL. */
function init(args: string[], files: Record<string, string> = {}, extraEnv: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-cli-init-"));
  directories.push(directory);
  const target = join(directory, "installation");
  mkdirSync(target, { recursive: true });
  cpSync(dbSource, join(target, "packages/db/src"), { recursive: true });
  symlinkSync(join(workspace, "node_modules"), join(target, "node_modules"));
  symlinkSync(join(workspace, "packages/db/node_modules"), join(target, "packages/db/node_modules"));
  copyFileSync(join(workspace, ".env.example"), join(target, ".env.example"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(target, name), content);
  const env: Record<string, string | undefined> = { ...process.env, ...extraEnv };
  for (const key of ["DATABASE_URL", "PLATFORM_ENCRYPTION_KEY", "PLATFORM_ADMIN_KEY", "AGENT_SECRET_KEY", "PACHIWARE_RUNTIME_CONFIG"]) if (!(key in extraEnv)) delete env[key];
  const result = Bun.spawnSync({ cmd: ["bun", cli, "init", target, ...args], cwd: workspace, env });
  const read = (name: string) => (existsSync(join(target, name)) ? readFileSync(join(target, name), "utf8") : null);
  return { exitCode: result.exitCode, stdout: text(result.stdout), stderr: text(result.stderr), read, target, directory };
}

/** Answers the database question the way a person at the terminal would, keeping each question asked. */
function terminal(...answers: string[]) {
  const asked: string[] = [];
  const ask = async (question: string, fallback: string) => { asked.push(question); return answers.shift() || fallback; };
  return { asked, ask };
}
const dockerUrls = { postgres: "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent", mongodb: "mongodb://localhost:27017/pachiware?replicaSet=rs0&directConnection=true" };

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("pachiware init", () => {
  test("install script rejects an incompatible Bun before cloning or installing dependencies", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-installer-version-"));
    const bin = join(directory, "bin");
    const marker = join(directory, "unexpected-command");
    try {
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "bun"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.3.0; exit 0; fi\necho bun >> \"$PACHIWARE_TEST_MARKER\"\nexit 99\n");
      writeFileSync(join(bin, "git"), "#!/bin/sh\necho git >> \"$PACHIWARE_TEST_MARKER\"\nexit 99\n");
      chmodSync(join(bin, "bun"), 0o755);
      chmodSync(join(bin, "git"), 0o755);
      const result = Bun.spawnSync({
        cmd: ["bash", join(workspace, "install.sh")],
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          PACHIWARE_DIR: join(directory, "installation"),
          PACHIWARE_TEST_MARKER: marker,
        },
      });
      expect(result.exitCode).toBe(1);
      expect(text(result.stdout)).toContain("Bun 1.3.0 cannot read this repository lockfile. Bun 1.4.0+ is required.");
      expect(text(result.stdout)).toContain("Upgrade with bun upgrade");
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(join(directory, "installation"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("install script passes MongoDB and its URL through to pachiware init", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-installer-mongodb-"));
    directories.push(directory);
    const bin = join(directory, "bin"), home = join(directory, "home"), clone = join(directory, "clone"), calls = join(directory, "init-args");
    for (const path of [bin, home, join(clone, "apps/agent")]) mkdirSync(path, { recursive: true });
    writeFileSync(join(clone, "docker-compose.yml"), "");
    // `bun build` writes a pachiware that records its arguments and fails, so the script stops before linking anything.
    writeFileSync(join(bin, "bun"), `#!/bin/sh
case "$1" in
  --version) echo 1.4.0 ;;
  build) for arg in "$@"; do case "$arg" in --outfile=*) out="\${arg#--outfile=}" ;; esac; done
    printf '#!/bin/sh\\nfor a in "$@"; do echo "$a"; done > "${calls}"\\nexit 3\\n' > "$out"; chmod +x "$out" ;;
esac
`);
    chmodSync(join(bin, "bun"), 0o755);
    const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, PACHIWARE_DATABASE: "mongodb", PACHIWARE_MONGODB_URL: "mongodb+srv://app:s3cret@cluster0.example.mongodb.net/pachiware" };
    delete env.SUDO_USER;
    delete env.PACHIWARE_DIR;
    const result = Bun.spawnSync({ cmd: ["bash", join(workspace, "install.sh")], cwd: clone, env, stdin: "ignore" });
    expect(result.exitCode).toBe(3);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["init", realpathSync(clone), "--database", "mongodb", "--mongodb-url", "mongodb+srv://app:s3cret@cluster0.example.mongodb.net/pachiware"]);
    expect(existsSync(join(home, ".local/bin/pachiware"))).toBe(false);
  });

  test("performs the complete SQLite operator setup in an isolated target workspace", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-cli-init-"));
    const target = join(directory, "installation");
    const unrelatedWorkspace = join(directory, "unrelated-workspace");
    try {
      mkdirSync(target, { recursive: true });
      // Keep import.meta.dir in the fixture itself, while sharing only installed
      // dependencies with this checkout.
      cpSync(dbSource, join(target, "packages/db/src"), { recursive: true });
      symlinkSync(join(workspace, "node_modules"), join(target, "node_modules"));
      symlinkSync(join(workspace, "packages/db/node_modules"), join(target, "packages/db/node_modules"));
      copyFileSync(join(workspace, ".env.example"), join(target, ".env.example"));

      // The setup child must use the init target even if the invoking CLI has
      // a stale workspace variable from a shell or global installation.
      const env: Record<string, string | undefined> = { ...process.env, PACHIWARE_DIR: unrelatedWorkspace };
      delete env.DATABASE_URL;
      delete env.PLATFORM_ENCRYPTION_KEY;
      delete env.PLATFORM_ADMIN_KEY;
      delete env.AGENT_SECRET_KEY;
      const result = Bun.spawnSync({
        cmd: ["bun", cli, "init", target, "--database", "sqlite"],
        cwd: workspace,
        env,
      });

      expect(result.exitCode, text(result.stderr)).toBe(0);
      const envFile = readFileSync(join(target, ".env"), "utf8");
      const access = JSON.parse(readFileSync(join(target, "operator-access.json"), "utf8"));
      expect(text(result.stdout)).toContain("Setup complete.");
      expect(envFile).toContain('DATABASE_URL="sqlite:./data/pachiware.db"');
      expect(envFile).toMatch(/^PLATFORM_ADMIN_KEY="[a-f0-9]{64}"$/m);
      expect(envFile).toMatch(/^PLATFORM_ENCRYPTION_KEY="[A-Za-z0-9+/]{43}="$/m);
      expect(access).toMatchObject({ tenantId: expect.any(String) });
      expect(access.keyId).toBeUndefined();
      expect(access.apiKeyEncrypted).toBeUndefined();
      expect(access.platformKeyEncrypted).toMatch(/^v1:/);
      expect(lstatSync(join(target, "operator-access.json")).mode & 0o777).toBe(0o600);
      expect(existsSync(join(target, "data/pachiware.db"))).toBe(true);
      expect(existsSync(join(unrelatedWorkspace, "data/pachiware.db"))).toBe(false);
      expect(JSON.parse(readFileSync(join(target, "runtime-config.json"), "utf8"))).toEqual({ databaseEngine: "sqlite" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses another engine than the recorded one before writing anything", () => {
    const env = 'DATABASE_URL="sqlite:./data/pachiware.db"\nPLATFORM_ADMIN_KEY="kept"\n';
    const runtime = JSON.stringify({ databaseEngine: "sqlite" });
    const existing = init(["--database", "mongodb", "--mongodb-url", "mongodb://localhost:1/pachiware"], { ".env": env, "runtime-config.json": runtime });
    expect(existing.exitCode).toBe(1);
    expect(existing.stderr).toContain("This installation keeps its records in SQLite, but you chose MongoDB.");
    expect(existing.read(".env")).toBe(env);
    expect(existing.read("runtime-config.json")).toBe(runtime);

    const fresh = init(["--database", "sqlite"], { "runtime-config.json": JSON.stringify({ databaseEngine: "mongodb" }) });
    expect(fresh.exitCode).toBe(1);
    expect(fresh.stderr).toContain("This installation keeps its records in MongoDB, but you chose SQLite.");
    expect(fresh.read(".env")).toBeNull();
  });

  test.skipIf(!process.env.TEST_MONGODB_URL)("sets up an installation on a MongoDB replica set from --mongodb-url", async () => {
    const url = process.env.TEST_MONGODB_URL!.replace(/^(mongodb(?:\+srv)?:\/\/[^/?]*)\/?([^?]*)/, (_, server, name) => `${server}/${name || "pachiware"}_cli_init`);
    const { MongoClient } = require(join(workspace, "packages/db/node_modules/mongodb"));
    const client = new MongoClient(url);
    try {
      await client.db().dropDatabase();
      const result = init(["--database", "mongodb", "--mongodb-url", url]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("The database engine you choose is fixed after setup.");
      expect(result.stdout).toContain("Setup complete.");
      expect(result.read(".env")).toContain(`DATABASE_URL=${JSON.stringify(url)}`);
      expect(JSON.parse(result.read("runtime-config.json")!)).toEqual({ databaseEngine: "mongodb" });
      const { tenantId } = JSON.parse(result.read("operator-access.json")!);
      expect(await client.db().collection("tenants").findOne({ _id: tenantId })).toMatchObject({ slug: "default", status: "active" });
      expect(existsSync(join(result.target, "data/pachiware.db"))).toBe(false);
    } finally {
      await client.db().dropDatabase();
      await client.close();
    }
  }, 60_000);

  test("Docker with MongoDB starts the compose replica set and Redis, and points the installation at it", () => {
    const bin = mkdtempSync(join(tmpdir(), "pachiware-fake-docker-"));
    directories.push(bin);
    const calls = join(bin, "calls");
    // A Docker that cannot start, so setup stops before connecting anywhere.
    writeFileSync(join(bin, "docker"), `#!/bin/sh\necho "$@" >> "${calls}"\nexit 1\n`);
    chmodSync(join(bin, "docker"), 0o755);
    const result = init(["--database", "docker", "--docker-engine", "mongodb"], { ".env": "MONGO_PORT=27999\n" }, { PATH: `${bin}:${process.env.PATH}` });
    expect(result.exitCode).toBe(1);
    expect(readFileSync(calls, "utf8").trim()).toBe("compose --profile mongo up -d --wait --wait-timeout 90 mongo redis");
    expect(result.stderr).toContain("Start Docker and rerun pachiware init --database docker --docker-engine mongodb.");
    expect(result.read(".env")).toContain('DATABASE_URL="mongodb://localhost:27999/pachiware?replicaSet=rs0&directConnection=true"');
  });
});

test("doctor reports a MongoDB installation by its members, without credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-doctor-"));
  directories.push(directory);
  mkdirSync(join(directory, "apps/agent/src"), { recursive: true });
  writeFileSync(join(directory, "apps/agent/src/index.ts"), "");
  writeFileSync(join(directory, "package.json"), "{}");
  writeFileSync(join(directory, ".env"), 'DATABASE_URL="mongodb://app:s3cret@db1.internal:27017,db2.internal:27017/pachiware?replicaSet=rs0"\n');
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.PACHIWARE_DIR;
  const result = Bun.spawnSync({ cmd: ["bun", cli, "doctor"], cwd: directory, env });
  expect(text(result.stdout)).toContain("Database:           MongoDB at db1.internal:27017,db2.internal:27017");
  expect(text(result.stdout)).not.toContain("s3cret");
});

describe("the database question", () => {
  test("lists SQLite, PostgreSQL, MongoDB and Docker, and Docker asks which engine it runs", async () => {
    const person = terminal("4", "2");
    const choice = await chooseDatabase({ dockerUrls }, person.ask);
    expect(person.asked[0]).toBe("Database: 1) SQLite  2) PostgreSQL  3) MongoDB  4) Docker");
    expect(person.asked[1]).toBe("Docker runs: 1) PostgreSQL 18  2) MongoDB 8.0");
    expect(choice).toMatchObject({ engine: "mongodb", url: dockerUrls.mongodb, docker: true });

    expect(await chooseDatabase({ dockerUrls }, terminal("docker", "").ask)).toMatchObject({ engine: "postgres", url: dockerUrls.postgres, docker: true });
  });

  test("MongoDB takes the URL typed at the prompt, and refuses one of another scheme", async () => {
    const replicaSet = "mongodb://app:s3cret@db1.internal:27017,db2.internal:27017/pachiware?replicaSet=rs0";
    expect(await chooseDatabase({ dockerUrls }, terminal("3", replicaSet).ask)).toEqual({ engine: "mongodb", url: replicaSet, label: "MongoDB (external)", docker: false });
    await expect(chooseDatabase({ dockerUrls }, terminal("mongodb", "mysql://db.internal/pachiware").ask)).rejects.toThrow("starts with mongodb:// or mongodb+srv://");
  });

  test("an answer already given on the command line is not asked again", async () => {
    const person = terminal();
    const atlas = "mongodb+srv://app:s3cret@cluster0.example.mongodb.net/pachiware";
    expect(await chooseDatabase({ mongodbUrl: atlas, dockerUrls }, person.ask)).toMatchObject({ engine: "mongodb", url: atlas });
    expect(await chooseDatabase({ database: "docker", dockerEngine: "mongodb", dockerUrls }, person.ask)).toMatchObject({ engine: "mongodb", docker: true });
    expect(person.asked).toEqual([]);
  });
});
