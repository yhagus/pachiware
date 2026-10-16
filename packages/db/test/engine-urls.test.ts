import { describe, expect, test } from "bun:test";
import { detectEngine, redactedDatabaseHost, sqlitePathOf } from "../src/engine.ts";
import { engineOfUrl, mongoHosts, sqlitePathOf as cliSqlitePathOf } from "../../cli/src/database-choice.ts";

// The CLI cannot load this package, so it keeps its own copy of the URL rules; both must read a URL the same way.
const URLS: [string, "sqlite" | "postgres" | "mongodb"][] = [
  ["", "sqlite"],
  ["sqlite:./data/pachiware.db", "sqlite"],
  ["sqlite://./data/pachiware.db", "sqlite"],
  ["sqlite3:/var/lib/pachiware.db", "sqlite"],
  ["file:///var/lib/pachiware.db", "sqlite"],
  ["SQLITE:./Data/Pachiware.db", "sqlite"],
  ["./data/pachiware.db", "sqlite"],
  ["/srv/pachiware.sqlite3", "sqlite"],
  ["postgres://app:secret@db.internal:5432/pachiware", "postgres"],
  ["postgresql://app@localhost/pachiware", "postgres"],
  ["  POSTGRESQL://localhost/pachiware  ", "postgres"],
  ["mongodb://localhost:27017/pachiware?replicaSet=rs0", "mongodb"],
  ["mongodb://app:s3cret@db1.internal:27017,db2.internal:27017/pachiware?replicaSet=rs0", "mongodb"],
  ["mongodb+srv://app:s3cret@cluster0.example.mongodb.net/pachiware", "mongodb"],
  ["MongoDB+SRV://cluster0.example.mongodb.net", "mongodb"],
];

describe("the CLI and the database package read a database URL alike", () => {
  test.each(URLS)("%p is %p", (url, engine) => {
    expect(detectEngine(url)).toBe(engine);
    expect(engineOfUrl(url)).toBe(engine);
  });

  test.each(URLS.filter(([url, engine]) => engine === "sqlite" && url))("%p names the same SQLite file", (url) => {
    expect(cliSqlitePathOf(url)).toBe(sqlitePathOf(url));
  });

  test("the hosts of a MongoDB URL leave out credentials and the database", () => {
    for (const [url, engine] of URLS) if (engine === "mongodb") expect(mongoHosts(url)).toBe(redactedDatabaseHost(url));
    expect(redactedDatabaseHost("mongodb://app:s3cret@db1.internal:27017,db2.internal:27017/pachiware?replicaSet=rs0")).toBe("db1.internal:27017,db2.internal:27017");
    expect(sqlitePathOf("sqlite://./data/pachiware.db")).toBe("./data/pachiware.db");
    expect(sqlitePathOf("file:///var/lib/pachiware.db")).toBe("/var/lib/pachiware.db");
  });

  test("an unknown scheme is the one difference: the agent refuses it, the CLI leaves that to the agent", () => {
    expect(() => detectEngine("mysql://db.internal/pachiware")).toThrow('Unknown database URL scheme "mysql:"');
    expect(engineOfUrl("mysql://db.internal/pachiware")).toBe("sqlite");
  });
});
