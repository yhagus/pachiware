import { expect, test, beforeEach, afterEach } from "bun:test";
import { grantThreadConfirmation, hasThreadConfirmation, isGitWriteConfirmationOwner, resetThreadConfirmations, revokeThreadConfirmation, threadConfirmationKey } from "../src/threadConfirmation.js";
import { GuardrailService, resetGuardrailState } from "../src/guardrails.js";

const base = { tenantId: "tenant", botId: "bot", guildId: "guild", channelId: "thread", parentChannelId: "parent", userId: "owner" };

beforeEach(() => { resetThreadConfirmations(); resetGuardrailState(); process.env.GIT_OWNER_DISCORD_IDS = "owner"; });
afterEach(() => { resetThreadConfirmations(); delete process.env.GIT_OWNER_DISCORD_IDS; });

test("thread confirmation is owner-only and scoped to the concrete thread", () => {
  expect(isGitWriteConfirmationOwner(base)).toBe(true);
  expect(grantThreadConfirmation({ ...base, userId: "member" })).toBe(false);
  expect(hasThreadConfirmation(base)).toBe(false);
  expect(grantThreadConfirmation(base)).toBe(true);
  expect(hasThreadConfirmation(base)).toBe(true);
  expect(hasThreadConfirmation({ ...base, channelId: "sibling" })).toBe(false);
  expect(hasThreadConfirmation({ ...base, guildId: "other" })).toBe(false);
  expect(revokeThreadConfirmation(base)).toBe(true);
  expect(hasThreadConfirmation(base)).toBe(false);
});

test("missing owner configuration and incomplete contexts cannot grant", () => {
  delete process.env.GIT_OWNER_DISCORD_IDS;
  expect(isGitWriteConfirmationOwner(base)).toBe(false);
  expect(grantThreadConfirmation(base)).toBe(false);
  expect(threadConfirmationKey({ tenantId: "tenant", botId: "bot", guildId: "guild", channelId: undefined })).toBeNull();
  expect(grantThreadConfirmation({ ...base, channelId: undefined })).toBe(false);
});

test("reset clears all process-local grants", () => {
  grantThreadConfirmation(base);
  resetThreadConfirmations();
  expect(hasThreadConfirmation(base)).toBe(false);
});

test("generic guarded writes use the thread grant while retaining scope checks", () => {
  const skill: any = { id: "x", effect: "write", requiresConfirmation: true, tools: [], handlers: {} };
  const context: any = { ...base, db: {}, auth: { ...base, roleIds: [], permissions: [] } };
  expect(GuardrailService.checkTool(skill, "writeThing", {}, context)).toMatchObject({ allow: false, kind: "confirmation_required" });
  grantThreadConfirmation(base);
  expect(GuardrailService.checkTool(skill, "writeThing", {}, context)).toEqual({ allow: true });
  const sibling = { ...context, channelId: "sibling", auth: { ...context.auth, channelId: "sibling" } };
  expect(GuardrailService.checkTool(skill, "writeThing", {}, sibling)).toMatchObject({ allow: false, kind: "confirmation_required" });
});
