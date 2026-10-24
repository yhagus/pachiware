import { expect, test } from "bun:test";
import { draftProgress, elapsed, stageIndex, stageLine, stepLine, stepOf } from "../src/progress.js";

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

/** The latest results of a changelog's tracing: one changed endpoint, one unchanged, one unverified. */
const LATEST = [
  { endpoint: "POST /api/v2/users", recorded: ["POST /api/v2/users"], impact: "breaking", changes: 4 },
  { endpoint: "GET /api/v2/users/export", unchanged: true as const },
  { endpoint: "DELETE /api/v2/sessions", failed: "Its route is registered from config at runtime." },
];

test("a changelog's candidates traced read as how many of all, split into changed, unchanged and unverified, the latest results under them (#367)", () => {
  const candidates = { waiting: 33, changed: 21, unchanged: 6, failed: 1, latest: LATEST };
  expect(draftProgress({ candidates }, "id")).toBe([
    "28 dari 61 kandidat ditelusuri: 21 berubah, 6 tidak berubah, 1 tidak terverifikasi",
    "-# POST /api/v2/users · breaking, 4 perubahan",
    "-# GET /api/v2/users/export · tidak berubah",
    "-# DELETE /api/v2/sessions · tidak terverifikasi: Its route is registered from config at runtime.",
  ].join("\n"));
  expect(draftProgress({ candidates }, "en")).toBe([
    "28 of 61 candidates traced: 21 changed, 6 unchanged, 1 unverified",
    "-# POST /api/v2/users · breaking, 4 changes",
    "-# GET /api/v2/users/export · no change",
    "-# DELETE /api/v2/sessions · unverified: Its route is registered from config at runtime.",
  ].join("\n"));
});

test("a part of the traced split that is zero is left out, and so is the split before any candidate is traced (#367)", () => {
  expect(draftProgress({ candidates: { waiting: 3, changed: 0, unchanged: 2, failed: 0, latest: [] } }, "id")).toBe("2 dari 5 kandidat ditelusuri: 2 tidak berubah");
  expect(draftProgress({ candidates: { waiting: 0, changed: 1, unchanged: 0, failed: 1, latest: [] } }, "en")).toBe("2 of 2 candidates traced: 1 changed, 1 unverified");
  expect(draftProgress({ candidates: { waiting: 1, changed: 0, unchanged: 0, failed: 0, latest: [] } }, "en")).toBe("0 of 1 candidate traced");
});

test("time reads in seconds under a minute and in whole minutes after", () => {
  expect(elapsed(12_400, "id")).toBe("12 detik");
  expect(elapsed(254_000, "id")).toBe("4 menit");
  expect(elapsed(61_000, "en")).toBe("1 min");
});
