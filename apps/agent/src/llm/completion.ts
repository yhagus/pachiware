import type { Completion, Language } from "@pachiware/skills";
import { llmRouter } from "./router.js";

/** One tool-free call to a bot's own model; null when the provider failed. */
export const botCompletion = (tenantId: string, botId: string | undefined, language?: Language): Completion => async ({ system, user }) => {
  const response = await llmRouter.complete([{ role: "system", content: system }, { role: "user", content: user }], { tenantId, botId, tools: [], language }).catch(() => null);
  return response && response.finishReason !== "error" ? response.content : null;
};
