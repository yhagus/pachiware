import type { Completion, Language } from "@pachiware/skills";
import { llmRouter } from "./router.js";

/** The bot whose own model answers, and the language its provider errors come in. */
export type CompletionBot = { tenantId: string; botId?: string; language?: Language };

/**
 * One tool-free call to a bot's own model; null when the provider failed. With a turn's `deadline` (epoch ms), or a request's own
 * when it is earlier, a call made past it returns null without reaching the provider, and the router cuts one in flight there and
 * starts no retry or fallback past it.
 */
export const botCompletion = ({ tenantId, botId, language }: CompletionBot, turnDeadline?: number): Completion => async ({ system, user, deadline: own }) => {
  const deadline = turnDeadline === undefined ? own : own === undefined ? turnDeadline : Math.min(turnDeadline, own);
  if (deadline !== undefined && Date.now() >= deadline) return null;
  const response = await llmRouter.complete([{ role: "system", content: system }, { role: "user", content: user }], { tenantId, botId, tools: [], language, deadline }).catch(() => null);
  return response && response.finishReason !== "error" ? response.content : null;
};
