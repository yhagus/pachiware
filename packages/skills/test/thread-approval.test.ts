import { expect, test, beforeEach, afterEach } from "bun:test";
import { grantThreadApproval, hasThreadApproval, isThreadApprovalOwner, resetThreadApprovals, revokeThreadApproval, threadApprovalKey } from "../src/threadApproval.js";
import { GuardrailService, resetGuardrailState } from "../src/guardrails.js";

const base = { tenantId: "tenant", botId: "bot", guildId: "guild", channelId: "thread", parentChannelId: "parent", userId: "owner" };

beforeEach(() => { resetThreadApprovals(); resetGuardrailState(); process.env.GIT_OWNER_DISCORD_IDS = "owner"; });
afterEach(() => { resetThreadApprovals(); delete process.env.GIT_OWNER_DISCORD_IDS; });

test("thread approval is owner-only and scoped to the concrete thread", () => {
  expect(isThreadApprovalOwner(base)).toBe(true);
  expect(grantThreadApproval({ ...base, userId: "member" })).toBe(false);
  expect(hasThreadApproval(base)).toBe(false);
  expect(grantThreadApproval(base)).toBe(true);
  expect(hasThreadApproval(base)).toBe(true);
  expect(hasThreadApproval({ ...base, channelId: "sibling" })).toBe(false);
  expect(hasThreadApproval({ ...base, guildId: "other" })).toBe(false);
  expect(revokeThreadApproval(base)).toBe(true);
  expect(hasThreadApproval(base)).toBe(false);
});

test("missing owner configuration and incomplete contexts cannot grant", () => {
  delete process.env.GIT_OWNER_DISCORD_IDS;
  expect(isThreadApprovalOwner(base)).toBe(false);
  expect(grantThreadApproval(base)).toBe(false);
  expect(threadApprovalKey({ tenantId: "tenant", botId: "bot", guildId: "guild", channelId: undefined })).toBeNull();
  expect(grantThreadApproval({ ...base, channelId: undefined })).toBe(false);
});

test("reset clears all process-local grants", () => {
  grantThreadApproval(base);
  resetThreadApprovals();
  expect(hasThreadApproval(base)).toBe(false);
});

test("generic guarded writes use the thread grant while retaining scope checks", () => {
  const skill: any = { id: "x", risk: "write", requiresConfirmation: true, tools: [], handlers: {} };
  const context: any = { ...base, db: {}, auth: { ...base, roleIds: [], permissions: [] } };
  expect(GuardrailService.checkTool(skill, "writeThing", {}, context)).toMatchObject({ allow: false, kind: "confirmation_required" });
  grantThreadApproval(base);
  expect(GuardrailService.checkTool(skill, "writeThing", {}, context)).toEqual({ allow: true });
  const sibling = { ...context, channelId: "sibling", auth: { ...context.auth, channelId: "sibling" } };
  expect(GuardrailService.checkTool(skill, "writeThing", {}, sibling)).toMatchObject({ allow: false, kind: "confirmation_required" });
});

