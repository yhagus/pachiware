import { expect, test } from "bun:test";
import { contract } from "./engines.ts";

contract("Platform stats and health", (use) => {
  test("an open database answers a ping", async () => {
    expect(await use().repos.stats.ping()).toBe(true);
  });

  test("the database size is a positive number of bytes", async () => {
    const bytes = await use().repos.stats.databaseBytes();
    expect(typeof bytes).toBe("number");
    expect(bytes!).toBeGreaterThan(0);
  });
});
