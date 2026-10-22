import { expect, test } from "bun:test";
import { elapsed, stageIndex, stageLine, stepLine, stepOf } from "../src/progress.js";

test("a step reads as what it touched, never the tool: a file by its name without folders or extension", () => {
  expect(stepOf("repoReadFile", { repo: "emonev/api", path: "src/app/controller/http-client.controller.ts", ref: "abc" })).toEqual({ kind: "read", subject: "http-client.controller" });
  expect(stepOf("repoFindDefinition", { name: "updateRequest" })).toEqual({ kind: "definition", subject: "updateRequest" });
  expect(stepOf("putChangelogOperation", { method: "patch", path: "/requests/{id}" })).toEqual({ kind: "record", subject: "PATCH /requests/{id}" });
  // Steps a person need not see have no phrase.
  expect(stepOf("readPlaybookFile", { path: "checklist.md" })).toBeNull();
  expect(stepOf("putChangelogNotes", {})).toBeNull();
});

test("steps of one kind in a row read as one line: the subject for one, how many for several, in the asker's language", () => {
  expect(stepLine("read", ["http-client.controller"], "id")).toBe("Membaca http-client.controller");
  expect(stepLine("read", ["a", "b", "c", "d", "e"], "id")).toBe("Membaca 5 file");
  expect(stepLine("read", ["a", "a"], "en")).toBe("Reading a");
  expect(stepLine("search", ["HttpClientPaginationDTO"], "id")).toBe("Mencari pemakaian HttpClientPaginationDTO");
  expect(stepLine("repository", ["emonev/api-consolidator"], "en")).toBe("Opening the repository emonev/api-consolidator");
  expect(stepLine("record", ["PATCH /a", "POST /b"], "en")).toBe("Recording 2 endpoints");
});

test("contract-diff's stage only moves forward, and tracing counts the endpoints recorded; other work has no stage", () => {
  let at = -1;
  for (const tool of ["startChangelog", "readPlaybookFile", "repoFileDiff", "repoSearchCode", "repoReadFile"]) at = stageIndex("contract-diff", tool, at);
  expect(stageLine("contract-diff", at, 0, "id")).toBe("Menelusuri endpoint");
  expect(stageLine("contract-diff", at, 2, "id")).toBe("Menelusuri endpoint · 2 endpoint tercatat");
  expect(stageLine("contract-diff", stageIndex("contract-diff", "publishOpenApi", at), 2, "en")).toBe("Publishing the preview");
  expect(stageLine("contract-diff", stageIndex("contract-diff", "repoReadFile", -1), 0, "en")).toBe("Reading the changes");
  expect(stageLine(undefined, stageIndex(undefined, "repoReadFile", -1), 0, "en")).toBeNull();
});

test("time reads in seconds under a minute and in whole minutes after", () => {
  expect(elapsed(12_400, "id")).toBe("12 detik");
  expect(elapsed(254_000, "id")).toBe("4 menit");
  expect(elapsed(61_000, "en")).toBe("1 min");
});
