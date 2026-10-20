import { describe, expect, test } from "bun:test";
import { FIRST_PLANE_VERSION, type PlaneAccount } from "@pachiware/db";
import { PLANE_VERSIONS, findPlaneVersion, parseRelease, versionForRelease, versionNote } from "../src/plane/versions.ts";
import { hiddenPlaneToolsFor, hiddenPlaneReasonFor, accountForTool, type PlaneToolPolicy } from "../src/plane/workspace.ts";
import { planeToolPolicy } from "../src/builtin/plane.ts";
import type { PlaneAccess } from "../src/plane/scope.ts";

// A second version exists only here, so the gating is checked before a real one ships.
const VERSIONS = [PLANE_VERSIONS[0]!, { ...PLANE_VERSIONS[0]!, id: "9.9", label: "Plane 9.9", releases: { from: "9.9.0", before: "10.0.0" } }];
const P1 = "11111111-1111-4111-8111-111111111111";

const policy: Record<string, PlaneToolPolicy> = {
  planeAccounts: { effect: "read" },
  workItemGet: { effect: "read" },
  newTool: { effect: "read", versions: ["9.9"] },
  oldTool: { effect: "read", versions: ["1.3.1"] },
  workspaceMembers: { effect: "read", workspaceLevel: true },
  oldWorkspaceTool: { effect: "read", workspaceLevel: true, versions: ["1.3.1"] },
};

const access = (name: string, planeVersion: string, projectIds = ["*"]): PlaneAccess => ({
  account: { id: name.toLowerCase(), name, planeVersion } as PlaneAccount,
  workspace: "acme",
  name,
  sets: [projectIds],
});
const hidden = (...list: PlaneAccess[]) => hiddenPlaneToolsFor(list, policy, VERSIONS);
const refusal = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as Error).message; } };

describe("Plane tools offered by Plane version", () => {
  test("a tool listed for a version no usable account is on is hidden, and offered once one account is", () => {
    expect(hidden(access("Work", "1.3.1"))).toEqual(["newTool"]);
    expect(hidden(access("Work", "1.3.1"), access("Lab", "9.9"))).toEqual([]);
    expect(hidden(access("Lab", "9.9"))).toEqual(["oldTool", "oldWorkspaceTool"]);
  });

  test("with no usable account every tool but planeAccounts is hidden", () => {
    expect(hidden()).toEqual(["workItemGet", "newTool", "oldTool", "workspaceMembers", "oldWorkspaceTool"]);
  });

  test("a workspace-level tool needs one account that has both the version and every Plane project open", () => {
    // Work is on 1.3 but limited to one Plane project; Lab has every project but is on 9.9.
    expect(hidden(access("Work", "1.3.1", [P1]), access("Lab", "9.9"))).toEqual(["oldWorkspaceTool"]);
    expect(hidden(access("Work", "1.3.1", [P1]))).toEqual(["newTool", "workspaceMembers", "oldWorkspaceTool"]);
  });

  test("an account on a version this server does not know offers nothing", () => {
    expect(hidden(access("Old", "0.9"))).toEqual(["workItemGet", "newTool", "oldTool", "workspaceMembers", "oldWorkspaceTool"]);
    expect(hidden(access("Old", "0.9"), access("Work", "1.3.1"))).toEqual(["newTool"]);
  });
});

describe("why a hidden Plane tool is refused", () => {
  test("it names each usable account and its version", () => {
    expect(hiddenPlaneReasonFor([access("Work", "1.3.1"), access("Home", "1.3.1")], "newTool", policy, VERSIONS))
      .toBe('No Plane account usable here has newTool on its Plane version: "Work" is on Plane 1.3.1; "Home" is on Plane 1.3.1.');
  });

  test("an unknown version says an admin can choose another", () => {
    expect(hiddenPlaneReasonFor([access("Old", "0.9")], "workItemGet", policy, VERSIONS))
      .toBe('No Plane account usable here has workItemGet on its Plane version: "Old" is set to Plane version "0.9", which this server does not know. An admin can choose a supported version in the console.');
  });

  test("a version that has the tool leaves the whole-workspace and not-enabled reasons", () => {
    expect(hiddenPlaneReasonFor([access("Work", "1.3.1", [P1])], "workspaceMembers", policy, VERSIONS))
      .toBe("This needs the whole Plane workspace, and this channel is limited to specific Plane projects.");
    expect(hiddenPlaneReasonFor([], "workItemGet", policy, VERSIONS))
      .toBe("Plane is not enabled here. An admin can enable a Plane account for this server, and its Plane projects, in the console.");
  });
});

describe("the account a Plane tool call runs with", () => {
  const both = [access("Work", "1.3.1"), access("Lab", "9.9")];

  test("a named account whose version lacks the tool is refused, naming the ones that have it", () => {
    expect(refusal(() => accountForTool(both, "newTool", "Work", policy, VERSIONS)))
      .toBe('newTool is not available on Plane account "Work": it is on Plane 1.3.1. Use one of: Lab.');
    expect(refusal(() => accountForTool([access("Old", "0.9"), access("Work", "1.3.1")], "workItemGet", "old", policy, VERSIONS)))
      .toBe('workItemGet is not available on Plane account "Old": it is set to Plane version "0.9", which this server does not know. Use one of: Work.');
    expect(refusal(() => accountForTool([access("Old", "0.9")], "workItemGet", "Old", policy, VERSIONS)))
      .toBe('workItemGet is not available on Plane account "Old": it is set to Plane version "0.9", which this server does not know. An admin can choose a supported version in the console.');
  });

  test("with none named, the only account offering the tool is used", () => {
    expect(accountForTool(both, "newTool", undefined, policy, VERSIONS)).toBe("Lab");
    expect(accountForTool(both, "oldTool", "", policy, VERSIONS)).toBe("Work");
  });

  test("otherwise the arguments are left for the handler", () => {
    expect(accountForTool(both, "workItemGet", undefined, policy, VERSIONS)).toBeNull();
    expect(accountForTool([access("Work", "1.3.1")], "workItemGet", undefined, policy, VERSIONS)).toBeNull();
    expect(accountForTool(both, "newTool", "lab", policy, VERSIONS)).toBeNull();
    expect(accountForTool(both, "newTool", "nope", policy, VERSIONS)).toBeNull();
  });
});

describe("the shipped Plane versions", () => {
  test("Plane 1.3.1 sends the key in X-Api-Key, as Plane v1.3.1's API reads it", () => {
    expect(findPlaneVersion("1.3.1")?.headers("k")).toEqual({ "X-Api-Key": "k" });
  });

  test("accounts made before versions existed are on a version that exists", () => {
    expect(findPlaneVersion(FIRST_PLANE_VERSION)?.label).toBe("Plane 1.3.1");
  });

  test("every version a Plane tool lists is a shipped one", () => {
    const ids = new Set(PLANE_VERSIONS.map((v) => v.id));
    const unknown = Object.entries(planeToolPolicy).flatMap(([tool, p]) => (p.versions ?? []).filter((v) => !ids.has(v)).map((v) => `${tool}: ${v}`));
    expect(unknown).toEqual([]);
  });
});

describe("the release a Plane server reports", () => {
  test("is read with or without a leading v and with a suffix; anything else is not a release", () => {
    expect(parseRelease("v1.3.1")).toEqual([1, 3, 1]);
    expect(parseRelease("1.3.1")).toEqual([1, 3, 1]);
    expect(parseRelease("v1.3.2-ce")).toEqual([1, 3, 2]);
    expect(parseRelease("abc")).toBeNull();
    expect(parseRelease("")).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });

  test("falls in the Plane version whose range covers it, from inclusive and before exclusive", () => {
    expect(versionForRelease("1.3.1")?.id).toBe("1.3.1");
    expect(versionForRelease("v1.3.1")?.id).toBe("1.3.1");
    // Plane 1.3.1 is that release alone: the patch releases around it are not covered.
    expect(versionForRelease("v1.3.2-ce")).toBeNull();
    expect(versionForRelease("1.3.0")).toBeNull();
    expect(versionForRelease("1.4.0")).toBeNull();
    expect(versionForRelease("v1.2.9")).toBeNull();
    expect(versionForRelease("abc")).toBeNull();
    expect(versionForRelease("v9.9.3", VERSIONS)?.id).toBe("9.9");
  });

  test("outside the account's version, it gives a note naming the host and the version that covers it, if any", () => {
    const account = { baseUrl: "https://plane.acme.id", planeVersion: "1.3.1", planeServerVersion: "v1.4.0" };
    expect(versionNote(account)).toBe("Plane at plane.acme.id reports v1.4.0; this account is set to Plane 1.3.1 (checked against v1.3.1). Some tools may fail.");
    expect(versionNote({ ...account, baseUrl: null, planeServerVersion: "v9.9.0" }, VERSIONS)).toBe("Plane's cloud reports v9.9.0; this account is set to Plane 1.3.1 (checked against v1.3.1). Choose Plane 9.9.");
    expect(versionNote({ ...account, planeServerVersion: "1.3.1" })).toBeNull();
    expect(versionNote({ ...account, planeServerVersion: null })).toBeNull();
    expect(versionNote({ ...account, planeVersion: "0.9" })).toBeNull();
  });
});
