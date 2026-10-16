import { describe, expect, test } from "bun:test";
import { requireTestDatabase } from "./test-database.ts";

describe("a test URL must name a test database", () => {
  test.each([
    "postgres://localhost:5432/pachiware_test",
    "postgresql://app:secret@db.internal:5432/test_pachiware?sslmode=disable",
    "postgres://localhost/Pachiware_TEST",
    "mongodb://localhost:27017/pachiware_test?replicaSet=rs0&directConnection=true",
    "mongodb://app:s3cret@db1.internal:27017,db2.internal:27017/contract-test?replicaSet=rs0",
    "mongodb+srv://app:s3cret@cluster0.example.mongodb.net/pachiware_test?retryWrites=true",
  ])("%p is accepted as it is", (url) => {
    expect(requireTestDatabase("TEST_URL", url)).toBe(url);
  });

  test("a database name without test is refused, naming the variable and the database", () => {
    expect(() => requireTestDatabase("TEST_POSTGRES_URL", "postgres://app:secret@db.internal:5432/pachiware")).toThrow(
      'TEST_POSTGRES_URL names the database "pachiware", which is not a test database',
    );
  });

  test("the error explains the drop and never shows the password", () => {
    let message = "";
    try {
      requireTestDatabase("TEST_MONGODB_URL", "mongodb://app:s3cret@localhost:27017/pachiware?replicaSet=rs0");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('TEST_MONGODB_URL names the database "pachiware"');
    expect(message).toContain("contain \"test\"");
    expect(message).toContain("drop");
    expect(message).not.toContain("s3cret");
  });

  test.each([
    // test only in the query string, the credentials or the host: the database itself is the real one.
    ["postgres://localhost:5432/pachiware?application_name=test", "pachiware"],
    ["postgres://test:test@test-db.internal:5432/pachiware", "pachiware"],
    ["mongodb://localhost:27017/pachiware?replicaSet=rs0&appName=test", "pachiware"],
    ["mongodb+srv://tester:test@test.example.mongodb.net/prod", "prod"],
    ["mongodb://test-a:27017,test-b:27017/live?replicaSet=test", "live"],
  ])("%p is refused: its database is %p", (url, name) => {
    expect(() => requireTestDatabase("TEST_URL", url)).toThrow(`TEST_URL names the database "${name}"`);
  });

  test("a MongoDB URL without a database is refused, because the agent's own pachiware database is the default", () => {
    expect(() => requireTestDatabase("TEST_MONGODB_URL", "mongodb://localhost:27017/?replicaSet=rs0")).toThrow('names the database "pachiware"');
    expect(() => requireTestDatabase("TEST_MONGODB_URL", "mongodb://localhost:27017")).toThrow('names the database "pachiware"');
  });

  test("a PostgreSQL URL without a database is refused, since the driver would pick one from the environment", () => {
    expect(() => requireTestDatabase("TEST_POSTGRES_URL", "postgres://test@localhost:5432")).toThrow("TEST_POSTGRES_URL names no database");
    expect(() => requireTestDatabase("TEST_POSTGRES_URL", "postgres://test@localhost:5432/?sslmode=disable")).toThrow("TEST_POSTGRES_URL names no database");
  });

  test("a MongoDB database name is read percent-decoded, as the connection opens it", () => {
    expect(requireTestDatabase("TEST_URL", "mongodb://localhost/my%20test")).toBe("mongodb://localhost/my%20test");
  });

  test("a URL that is not PostgreSQL or MongoDB is refused", () => {
    expect(() => requireTestDatabase("TEST_POSTGRES_URL", "sqlite:./data/test.db")).toThrow("TEST_POSTGRES_URL is not a PostgreSQL or MongoDB URL");
  });
});

describe("the contract harness", () => {
  /** Runs one small contract suite in its own process with these test URLs. */
  function runContract(env: Record<string, string>) {
    const result = Bun.spawnSync({
      cmd: ["bun", "test", "packages/db/test/contract/stats.contract.test.ts"],
      cwd: `${import.meta.dir}/../../..`,
      env: { ...process.env, TEST_POSTGRES_URL: "", TEST_MONGODB_URL: "", ...env },
    });
    return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
  }

  // Nothing listens on port 1: a run that got as far as connecting would fail on the connection instead.
  test.each([
    ["TEST_POSTGRES_URL", "postgres://localhost:1/pachiware"],
    ["TEST_MONGODB_URL", "mongodb://localhost:1/pachiware?replicaSet=rs0&serverSelectionTimeoutMS=500"],
  ])("refuses %p naming a real database before connecting", (variable, url) => {
    const { exitCode, output } = runContract({ [variable]: url });
    expect(exitCode).not.toBe(0);
    expect(output).toContain(`${variable} names the database "pachiware", which is not a test database`);
  }, 30_000);
});
