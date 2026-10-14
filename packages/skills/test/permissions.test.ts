import { describe, expect, test } from "bun:test";
import { hasPermission, permissionName } from "../src/permissions";

const withPerms = (permissions: string[]) => ({ auth: { tenantId: "t", botId: "b", userId: "u", permissions } as any });

describe("permissions", () => {
  test("permissionName spells a flag as Discord's settings page does", () => {
    expect(permissionName("ReadMessageHistory")).toBe("Read Message History");
    expect(permissionName("SendMessagesInThreads")).toBe("Send Messages in Threads");
    expect(permissionName("ManageGuild")).toBe("Manage Guild");
  });

  test("hasPermission takes any of the names, Administrator always passes, and no auth never does", () => {
    expect(hasPermission(withPerms(["ManageMessages"]), "ManageMessages")).toBe(true);
    expect(hasPermission(withPerms(["ManageGuild"]), "ManageMessages", "ManageGuild")).toBe(true);
    expect(hasPermission(withPerms(["Administrator"]), "ManageMessages")).toBe(true);
    expect(hasPermission(withPerms(["SendMessages"]), "ManageMessages")).toBe(false);
    expect(hasPermission(withPerms([]), "ManageMessages")).toBe(false);
    expect(hasPermission({}, "ManageMessages")).toBe(false);
  });
});
