import { describe, expect, test } from "bun:test";
import type { PlaneAccount, PlaneWorkspace } from "@pachiware/db";
import { computePlaneAccess, pickPlaneAccess, PLANE_NOT_ENABLED } from "../src/plane/scope.ts";
import { accountForTool, type PlaneToolPolicy } from "../src/plane/workspace.ts";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

const account = (name: string, workspaces: PlaneWorkspace[]) => ({ id: name.toLowerCase(), name, workspaces, planeVersion: "1.3.1" } as PlaneAccount);
const rule = (accountId: string, workspaceSlug: string, projectIds: string[], channelId = "") => ({ planeAccountId: accountId, workspaceSlug, channelId, projectIds });
const on = (slug: string): PlaneWorkspace => ({ slug, enabled: true });
const off = (slug: string): PlaneWorkspace => ({ slug, enabled: false });
const entries = (list: ReturnType<typeof computePlaneAccess>) => list.map((a) => [a.name, a.workspace, a.sets]);
const refusal = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as Error).message; } };

describe("Plane access per Plane workspace", () => {
  test("each switched-on workspace with a guild rule is one entry, named by its account alone when that is its only one here", () => {
    const main = account("Main", [on("acme"), on("beta")]);
    const list = computePlaneAccess([main], [rule("main", "acme", ["*"]), rule("main", "beta", [P1])], "c1");
    expect(entries(list)).toEqual([["Main/acme", "acme", [["*"]]], ["Main/beta", "beta", [[P1]]]]);
    expect(entries(computePlaneAccess([main], [rule("main", "beta", [P1])], "c1"))).toEqual([["Main", "beta", [[P1]]]]);
  });

  test("a switched-off workspace is not an entry, even with its rules kept", () => {
    const main = account("Main", [on("acme"), off("beta")]);
    expect(entries(computePlaneAccess([main], [rule("main", "acme", ["*"]), rule("main", "beta", ["*"])], "c1"))).toEqual([["Main", "acme", [["*"]]]]);
    // A rule for a slug the account no longer lists counts for nothing.
    expect(computePlaneAccess([account("Main", [on("acme")])], [rule("main", "gone", ["*"])], "c1")).toEqual([]);
  });

  test("a channel rule narrows its own workspace; a channel whose rules are all for switched-off workspaces gets no Plane at all", () => {
    const main = account("Main", [on("acme"), on("beta")]);
    const guild = [rule("main", "acme", ["*"]), rule("main", "beta", ["*"])];
    expect(entries(computePlaneAccess([main], [...guild, rule("main", "beta", [P2], "c1")], "c1"))).toEqual([["Main", "beta", [["*"], [P2]]]]);
    // A thread follows its parent channel's rule.
    expect(entries(computePlaneAccess([main], [...guild, rule("main", "beta", [P2], "c1")], "t1", "c1"))).toEqual([["Main", "beta", [["*"], [P2]]]]);
    // Switching beta off must not open acme in c1, whose rule names only beta.
    const offBeta = account("Main", [on("acme"), off("beta")]);
    expect(computePlaneAccess([offBeta], [...guild, rule("main", "beta", [P2], "c1")], "c1")).toEqual([]);
    expect(entries(computePlaneAccess([offBeta], [...guild, rule("main", "beta", [P2], "c1")], "c2"))).toEqual([["Main", "acme", [["*"]]]]);
  });
});

describe("naming a Plane workspace", () => {
  const main = account("Main", [on("acme"), on("beta")]);
  const lab = account("Lab", [on("lab")]);
  const both = computePlaneAccess([main, lab], [rule("main", "acme", ["*"]), rule("main", "beta", ["*"]), rule("lab", "lab", ["*"])]);

  test("account/workspace always picks one, a bare name only when it is unambiguous, and none named only when one is usable", () => {
    expect(pickPlaneAccess(both, "main/BETA").workspace).toBe("beta");
    expect(pickPlaneAccess(both, " lab ").name).toBe("Lab");
    expect(pickPlaneAccess(both, "Lab/lab").name).toBe("Lab");
    expect(refusal(() => pickPlaneAccess(both, "main"))).toBe('Plane account "Main" has several Plane workspaces here; pass "account" with one of: Main/acme, Main/beta');
    expect(refusal(() => pickPlaneAccess(both, undefined))).toBe('Several Plane accounts are available; pass "account" with one of: Main/acme, Main/beta, Lab');
    expect(refusal(() => pickPlaneAccess(both, "main/gamma"))).toBe('Unknown Plane account "main/gamma"; available: Main/acme, Main/beta, Lab');
    expect(refusal(() => pickPlaneAccess([], "main"))).toBe(PLANE_NOT_ENABLED);
  });

  test("checking a tool's Plane version reads the same names", () => {
    const policy: Record<string, PlaneToolPolicy> = { workItemGet: { effect: "read" } };
    expect(accountForTool(both, "workItemGet", "main/acme", policy)).toBeNull();
    expect(refusal(() => accountForTool(both, "workItemGet", "main", policy))).toBe('Plane account "Main" has several Plane workspaces here; pass "account" with one of: Main/acme, Main/beta');
  });
});
