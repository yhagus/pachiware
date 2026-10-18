import { afterEach, beforeEach, expect, test } from "bun:test";
import { confirmWrite } from "../src/writeConfirmation.js";
import { actionKey, markDone, resetGuardrailState } from "../src/guardrails.js";

const place = { tenantId: "tenant", botId: "bot", guildId: "guild", channelId: "channel", userId: "member" };
const prepared = () => ({ summary: "Close issue #1", run: async () => "closed" });

beforeEach(() => { resetGuardrailState(); delete process.env.TRUSTED_DISCORD_IDS; delete process.env.GIT_OWNER_DISCORD_IDS; });
afterEach(() => resetGuardrailState());

const REFUSALS = {
  en: {
    trusted: "This action is limited to Trusted members (Discord ids in TRUSTED_DISCORD_IDS). Tell the user they are not allowed to request it.",
    noConfirmer: "This action needs a person to confirm it, which only works in a Discord channel.",
    duplicate: "That exact action just ran. It was not repeated.",
  },
  id: {
    trusted: "Aksi ini hanya untuk Trusted member (id Discord di TRUSTED_DISCORD_IDS). Sampaikan bahwa dia tidak boleh memintanya.",
    noConfirmer: "Aksi ini perlu dikonfirmasi seseorang, dan itu hanya bisa di channel Discord.",
    duplicate: "Aksi yang persis sama baru saja dijalankan. Tidak saya ulangi.",
  },
} as const;

for (const language of ["en", "id"] as const) {
  test(`a git or Plane write is refused in the place's language (${language})`, async () => {
    const want = REFUSALS[language];
    await expect(confirmWrite({ ...place, language }, { tool: "repoDelete", args: {}, access: "trusted" }, prepared)).rejects.toThrow(want.trusted);
    await expect(confirmWrite({ tenantId: "tenant", language }, { tool: "issueClose", args: {} }, prepared)).rejects.toThrow(want.noConfirmer);
    const ctx = { ...place, language, confirmed: true };
    markDone(actionKey("issueClose", { number: 1 }, ctx));
    await expect(confirmWrite(ctx, { tool: "issueClose", args: { number: 1 } }, prepared)).rejects.toThrow(want.duplicate);
  });
}
