import { describe, expect, test } from "bun:test";
import { engineTargets } from "./engines-run.ts";

describe("engine test targets", () => {
  test("with nothing set, each engine is a test database on its compose service", () => {
    expect(engineTargets({})).toEqual([
      { kind: "postgres", variable: "TEST_POSTGRES_URL", url: "postgres://pachiware:pachiware_secret@localhost:5432/pachiware_test", service: "postgres" },
      { kind: "replicaSet", variable: "TEST_MONGODB_URL", url: "mongodb://localhost:27017/pachiware_test?replicaSet=rs0&directConnection=true", service: "mongo" },
      { kind: "standalone", variable: "TEST_MONGODB_STANDALONE_URL", url: "mongodb://localhost:27018/pachiware_test?directConnection=true", service: "mongo-standalone" },
    ]);
  });

  test("follows the compose settings for the PostgreSQL account and every port", () => {
    const urls = engineTargets({
      POSTGRES_USER: "admin",
      POSTGRES_PASSWORD: "p@ss/word",
      POSTGRES_PORT: "6543",
      MONGO_PORT: "27100",
      MONGO_STANDALONE_PORT: "27101",
    }).map((target) => target.url);
    expect(urls).toEqual([
      "postgres://admin:p%40ss%2Fword@localhost:6543/pachiware_test",
      "mongodb://localhost:27100/pachiware_test?replicaSet=rs0&directConnection=true",
      "mongodb://localhost:27101/pachiware_test?directConnection=true",
    ]);
  });

  test("a URL set in the environment is used as it is, with no compose service to start", () => {
    const targets = engineTargets({
      TEST_POSTGRES_URL: "postgres://ci:ci@db.internal:5432/ci_test",
      TEST_MONGODB_URL: "",
    });
    expect(targets[0]).toEqual({ kind: "postgres", variable: "TEST_POSTGRES_URL", url: "postgres://ci:ci@db.internal:5432/ci_test" });
    expect(targets[1]).toMatchObject({ url: "mongodb://localhost:27017/pachiware_test?replicaSet=rs0&directConnection=true", service: "mongo" });
  });

  test("a URL from the environment that names a real database is refused before anything starts", () => {
    expect(() => engineTargets({ TEST_POSTGRES_URL: "postgres://app:secret@localhost:5432/pachiware_agent" }))
      .toThrow('TEST_POSTGRES_URL names the database "pachiware_agent", which is not a test database');
    expect(() => engineTargets({ TEST_MONGODB_URL: "mongodb://localhost:27017/?replicaSet=rs0" }))
      .toThrow('TEST_MONGODB_URL names the database "pachiware"');
  });
});
