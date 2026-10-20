import { repositories } from "@pachiware/db";
import { configuredLanguage, configuredTimezone, redact, shownLanguage, type ToolCall, type ToolResult } from "@pachiware/skills";
import { agentReActLoop, type TurnRow } from "../loop/react.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { discordBotManager } from "./client.js";
import { prepareReply } from "./replyStyle.js";
import { readingOnly } from "./readingOnly.js";
import { speakerTurn } from "./routing.js";

/** Who speaks in the Playground: the console's operator, no member of the server, as in web chat. */
export const OPERATOR = { id: "playground-operator", name: "Operator" };
/** How much of a tool's result a step shows. */
export const STEP_RESULT = 4000;
const NOT_POSTED = "Nothing is posted to Discord from the console's Playground.";
const NOT_CHANGED = "Not run: this is the console's read-only Playground, where nothing is changed. Say what you would have done.";

export type PlaygroundStep = { id: string; tool: string; args: unknown; ok: boolean; result: string };
export type PlaygroundAnswer = { messages: string[]; reaction: string | null; steps: PlaygroundStep[]; history: TurnRow[]; offered: string[]; ms: number };
/** What a turn shows while it runs: a tool call as it starts, then its step once it answers. */
export type PlaygroundProgress = { type: "tool"; id: string; tool: string; args: unknown } | ({ type: "result" } & PlaygroundStep);

const shown = (result: ToolResult) => {
  const text = redact(JSON.stringify(result.data ?? { error: result.error }, null, 2));
  return text.length > STEP_RESULT ? `${text.slice(0, STEP_RESULT)}\n…[${text.length - STEP_RESULT} more characters]` : text;
};

/**
 * One turn of the console's Playground: the bot answers as it would to a message in the channel, with its Profile, persona, Availability
 * and Git and Plane access there, but only tools that read are offered, nothing is posted to Discord, and no conversation is stored.
 * The caller holds the history and sends it back with each turn.
 */
export async function playgroundTurn(p: { tenantId: string; botId: string; guildId: string; channelId: string; message: string; history: TurnRow[]; sessionId: string; onProgress?: (progress: PlaygroundProgress) => void }): Promise<PlaygroundAnswer> {
  const started = Date.now();
  const [agent, guild] = await Promise.all([repositories().agentConfig.get(p.tenantId), loadGuildSettings(p.tenantId, p.botId, p.guildId)]);
  const adapter = discordBotManager.adapterOf(p.botId, p.guildId);
  const answerIn = shownLanguage(p.message), language = answerIn ?? "en";
  const calls = new Map<string, ToolCall>(), steps: PlaygroundStep[] = [];
  const output = await agentReActLoop.run({
    tenantId: p.tenantId, botId: p.botId, message: speakerTurn(p.guildId, OPERATOR.name, p.message), replyLanguage: language, maxIterations: agent?.settings?.maxReActIterations,
    readOnly: NOT_CHANGED, ephemeral: { history: p.history, cacheKey: `playground:${p.sessionId}` },
    onStep: ({ type, payload }) => {
      if (type === "tool_call") {
        calls.set(payload.id, payload);
        p.onProgress?.({ type: "tool", id: payload.id, tool: payload.name, args: payload.arguments ?? {} });
      }
      if (type !== "tool_result") return;
      const step = { id: payload.toolCallId, tool: payload.name, args: calls.get(payload.toolCallId)?.arguments ?? {}, ok: payload.success && payload.data?.success !== false, result: shown(payload) };
      steps.push(step);
      p.onProgress?.({ type: "result", ...step });
    },
    context: {
      tenantId: p.tenantId, platform: "discord", guildId: p.guildId, guildName: discordBotManager.clientOf(p.botId)?.guilds.cache.get(p.guildId)?.name,
      channelId: p.channelId, userId: OPERATOR.id, userName: OPERATOR.name, addressed: true, follows: false,
      timezone: configuredTimezone(guild, agent), language: configuredLanguage(guild, agent), answerIn,
      skillContext: { member: { roleIds: [], permissions: [] }, discord: adapter ? readingOnly(adapter, NOT_POSTED) : undefined, parentChannelId: p.channelId },
    },
  });
  const plan = prepareReply(output.reply, { addressed: true, language });
  return { messages: plan.messages, reaction: plan.reaction ?? null, steps, history: output.recorded ?? [], offered: output.offered, ms: Date.now() - started };
}
