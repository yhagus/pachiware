import type { Completion, Language } from "@pachiware/skills";
import { llmRouter } from "./router.js";

/**
 * One tool-free call to a bot's own model; null when the provider failed. With a turn's `deadline` (epoch ms), a call made past it
 * returns null without reaching the provider, and the router cuts one in flight there and starts no retry or fallback past it.
 */
export const botCompletion = (tenantId: string, botId: string | undefined, language?: Language, deadline?: number): Completion => async ({ system, user }) => {
  if (deadline !== undefined && Date.now() >= deadline) return null;
  const response = await llmRouter.complete([{ role: "system", content: system }, { role: "user", content: user }], { tenantId, botId, tools: [], language, deadline }).catch(() => null);
  return response && response.finishReason !== "error" ? response.content : null;
};
