import { repositories, type Message } from "@pachiware/db";
import { dropLeadingOrphans, historyOffset, storedToolResult, HISTORY_SIZE, HISTORY_STEP } from "./history.js";
import { skillRegistry, GuardrailService, audit, redact, asUntrusted, looksLikeInjection, isEnforced, closedTools, availabilityPlace, textIn, bulkTaskTurn, BULK_TASK_TOOLS, type BulkItem, type Language, type Strings, type ToolCall, type ToolResult, type SkillContext, type MemberAuth } from "@pachiware/skills";
import { llmRouter } from "../llm/router.js";
import type { ChatMessage, ImagePart } from "../llm/types.js";
import { SystemPromptBuilder, type PromptContext } from "./prompt.js";
import { summaryMessage } from "./summary.js";
import { bulkApprovalOf, patchConversationMetadata, summaryOf, type ConversationSummary } from "./conversationMetadata.js";

export interface ReActInput {
  tenantId: string;
  botId?: string;
  message: string;
  /** Sent with this turn only; `message` should already name them, since that text is what history keeps. */
  images?: ImagePart[];
  conversationId?: string;
  /** The language the person wrote in, for a refusal they read; detected from `message` when absent. `context.language` stays the place's. */
  replyLanguage?: Language;
  context: PromptContext & {
    skillContext?: Partial<SkillContext> & { member?: MemberAuth };
  };
  maxIterations?: number;
  onStep?: (step: { type: "thought" | "tool_call" | "tool_result"; payload: any }) => void;
}

type Executed = { call: ToolCall; result: ToolResult };

export interface ReActOutput {
  conversationId: string;
  reply: string;
  toolCallsExecuted: Executed[];
  iterations: number;
  imagesRejected?: boolean;
  /** Where the history window started on this turn; the caller compares it after storing the turn to see whether the window stepped. */
  historyOffset: number;
}

const MAX_TOOL_RESULT = 12000;
/** A grounded brief round takes several tool steps per point, more than a tenant's usual cap. */
export const PLAYBOOK_ITERATIONS = 20;

/** A change as the person reads it, in the turn's language: what was done and the thing it touched. */
function changeLine({ call, result }: Executed, t: Strings) {
  const data = result.data ?? {}, args = call.arguments ?? {};
  const subject = [data.task?.title, data.title, data.name, data.path, args.title, args.name, args.path, args.taskId].find((v) => typeof v === "string" && v.trim());
  const label = t.taskChange[call.name] ?? call.name;
  return subject ? `${label} "${subject.trim().slice(0, 80)}"` : label;
}

/** Runs one tool call, or answers the refusal (a tool closed here, a task write of a bulk waiting for a yes) without running it; an approved bulk's call skips the per-tool write limit. */
function executeCall(call: ToolCall, ctx: SkillContext, o: { refusal?: string; approved: boolean }): Promise<ToolResult> {
  if (o.refusal) return Promise.resolve({ toolCallId: call.id, name: call.name, success: false, error: o.refusal });
  return skillRegistry.executeTool(call, o.approved ? { ...ctx, bulkApproved: true } : ctx);
}

/** The reply to a provider failure; when changes already landed this turn it names them first, so nobody asks for them twice. */
function failureReply(failure: string, executed: Executed[], language?: Language) {
  const t = textIn(language), said = failure || t.providerFailed;
  const done = executed.filter(({ call, result }) => result.success && result.data?.success !== false && !result.data?.pending && skillRegistry.effectOf(call.name) !== "read").map((e) => changeLine(e, t));
  return redact(done.length ? `${t.doneBeforeFailure(done)}\n\n${said}` : said);
}

export class AgentReActLoop {
  /**
   * Executes the ReAct cycle (Thought -> Action -> Observation -> Answer).
   */
  async run(input: ReActInput): Promise<ReActOutput> {
    const requestedIterations = Number(input.maxIterations) || 32;
    const maxIterations = Math.min(128, Math.max(1, input.context.playbook ? Math.max(requestedIterations, PLAYBOOK_ITERATIONS) : requestedIterations));
    const toolCallsExecuted: Executed[] = [];

    // 1. Ensure conversation exists in PostgreSQL
    let convId = input.conversationId;
    let summary: ConversationSummary | null = null;
    let approvedBulk: BulkItem[] = [];
    const { conversations } = repositories();
    if (convId) {
      const owned = await conversations.get(input.tenantId, convId);
      if (!owned) throw new Error("Conversation not found");
      summary = summaryOf(owned.metadata);
      // A refused bulk unlocks only the asker's next turn; any next turn clears it, whoever speaks.
      approvedBulk = bulkApprovalOf(owned.metadata, input.context.userId);
      if ((owned.metadata as { bulkApproval?: unknown } | null)?.bulkApproval) await patchConversationMetadata(input.tenantId, convId, { bulkApproval: undefined }, owned.metadata);
    }
    if (!convId) {
      const newConv = await conversations.create({
        tenantId: input.tenantId,
        botId: input.botId || null,
        platform: input.context.platform,
        channelId: input.context.channelId || null,
        userId: input.context.userId || null,
        metadata: { parentChannelId: input.context.skillContext?.parentChannelId ?? null },
      });
      convId = newConv.id;
    }

    if (!convId) throw new Error("Conversation creation failed");

    // Guardrail before the loop: refuse rule-rewriting messages, answer the rest however long.
    const verdict = GuardrailService.classify(input.message, input.replyLanguage);
    if (!verdict.decision.allow && isEnforced(verdict.decision.kind)) {
      const auditCtx = { tenantId: input.tenantId, botId: input.botId };
      await audit(auditCtx, verdict.decision.kind === "prompt_injection" ? "prompt_injection_detected" : "guardrail_denied", { kind: verdict.decision.kind, source: "user_message", platform: input.context.platform });
      return { conversationId: convId, reply: verdict.decision.message, toolCallsExecuted, iterations: 0, historyOffset: 0 };
    }
    else if (!verdict.decision.allow) await audit({ tenantId: input.tenantId, botId: input.botId }, "guardrail_denied", { kind: verdict.decision.kind, source: "user_message", observed: true });

    // 2. Build dynamic system prompt
    const place = availabilityPlace({ tenantId: input.tenantId, botId: input.botId, guildId: input.context.guildId, channelId: input.context.channelId, parentChannelId: input.context.skillContext?.parentChannelId });
    const available = await skillRegistry.availableAt(place);
    const systemPrompt = await SystemPromptBuilder.build({ ...input.context, tenantId: input.tenantId, botId: input.botId, off: available.off });

    // 3. Load previous messages from DB (windowed in steps so the prompt prefix stays cacheable)
    const windowOffset = historyOffset(await conversations.countMessages(input.tenantId, convId));
    const existingDbMessages = dropLeadingOrphans<Message>(await conversations.listMessages(input.tenantId, convId, { offset: windowOffset, limit: HISTORY_SIZE + HISTORY_STEP }));

    const messageHistory: ChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];
    // Before the stored rows, and rewritten only when the window steps, so the prefix stays cacheable in between; a playbook thread's own file is its record.
    if (summary && !input.context.playbook) messageHistory.push(summaryMessage(summary));

    for (const msg of existingDbMessages) {
      messageHistory.push({
        role: msg.role as any,
        content: msg.content,
        toolCalls: (msg.toolCalls as ToolCall[]) || undefined,
        toolCallId: msg.toolCallId || undefined,
      });
    }

    // 4. Append current user message
    const turn: ChatMessage = { role: "user", content: input.images?.length ? [{ type: "text", text: input.message }, ...input.images] : input.message };
    messageHistory.push(turn);
    // Per-turn context is a separate trailing message that is never stored, so the stored history re-reads identically next turn and the cached prefix survives.
    messageHistory.push({ role: "user", content: `[Context for this turn, not written by the user]\n${await SystemPromptBuilder.buildDynamic({ ...input.context, tenantId: input.tenantId, botId: input.botId })}` });

    await conversations.addMessage({
      tenantId: input.tenantId,
      conversationId: convId,
      role: "user",
      content: input.message,
    });

    // 5. Retrieve active tools
    // Availability rules for this place first, then a playbook may close tools in its threads, and a skill may hide tools the place does not support
    // (see SkillModule.hiddenTools); a call to any of them is refused even when the model names it anyway.
    const closed = closedTools(input.context.playbook);

    // 6. Build execution context for tools
    const skillContext: SkillContext = {
      tenantId: input.tenantId,
      botId: input.botId,
      discord: input.context.skillContext?.discord,
      guildId: input.context.guildId,
      channelId: input.context.channelId,
      guildName: input.context.guildName,
      channelName: input.context.channelName,
      userName: input.context.userName,
      parentChannelId: input.context.skillContext?.parentChannelId,
      privateThread: input.context.skillContext?.privateThread,
      userId: input.context.userId,
      timezone: input.context.timezone,
      language: input.context.language,
      complete: async ({ system, user }) => {
        const response = await llmRouter.complete([{ role: "system", content: system }, { role: "user", content: user }], { tenantId: input.tenantId, botId: input.botId, tools: [], language: input.context.language }).catch(() => null);
        return response && response.finishReason !== "error" ? response.content : null;
      },
      metadata: input.context.skillContext?.metadata,
      auth: {
        tenantId: input.tenantId, botId: input.botId, userId: input.context.userId, guildId: input.context.guildId, channelId: input.context.channelId,
        parentChannelId: input.context.skillContext?.parentChannelId,
        roleIds: input.context.skillContext?.member?.roleIds ?? [], permissions: input.context.skillContext?.member?.permissions ?? [],
      },
    };

    const hidden = await skillRegistry.hiddenTools(skillContext);
    const activeTools = available.tools.filter((t) => !closed.has(t.name) && !hidden.has(t.name));

    const bulk = bulkTaskTurn(approvedBulk);
    let iterations = 0;
    let finalReply = "";
    let imagesRejected = false;

    // 7. ReAct execution cycle
    while (iterations < maxIterations) {
      iterations++;

      // LLM Step (Thinking & Tool Decision)
      const response = await llmRouter.complete(messageHistory, {
        tenantId: input.tenantId,
        botId: input.botId,
        cacheKey: convId,
        tools: activeTools,
        language: input.context.language,
      });

      if (response.imagesRejected) { imagesRejected = true; turn.content = input.message; }

      // The failure text is the host's, not the model's: kept out of history so later turns never read it as something the bot said.
      if (response.finishReason === "error") {
        finalReply = failureReply(response.content ?? "", toolCallsExecuted, input.context.language);
        break;
      }

      if (response.content) {
        input.onStep?.({ type: "thought", payload: response.content });
      }

      // Record assistant message
      messageHistory.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      await conversations.addMessage({
        tenantId: input.tenantId,
        conversationId: convId,
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : null,
        tokensUsed: response.usage?.totalTokens || null,
      });

      // If no tool calls, this is the final answer!
      if (!response.toolCalls || response.toolCalls.length === 0) {
        finalReply = redact(response.content || "I have processed your request.");
        break;
      }

      // Guardrail on the whole response: too many task writes this turn and none of them run until the user says yes.
      const bulkDecision = bulk.check(response.toolCalls);
      const bulkRefusal = !bulkDecision.allow && isEnforced(bulkDecision.kind) ? bulkDecision.message : null;
      if (!bulkDecision.allow) {
        await audit(skillContext, bulkRefusal ? "confirmation_requested" : "guardrail_denied", { kind: "bulk_task", count: bulkDecision.batch.length, ...(bulkRefusal ? {} : { observed: true }) });
        if (bulkRefusal && input.context.userId) await patchConversationMetadata(input.tenantId, convId, { bulkApproval: { userId: input.context.userId, items: bulkDecision.batch } });
      }

      // Action Step: Execute each tool call
      for (const toolCall of response.toolCalls) {
        input.onStep?.({ type: "tool_call", payload: toolCall });

        const refusal = closed.get(toolCall.name) ?? (bulkRefusal && BULK_TASK_TOOLS.has(toolCall.name) ? bulkRefusal : undefined);
        const approved = bulkDecision.allow && bulkDecision.approved.has(toolCall.id);
        const result = await executeCall(toolCall, skillContext, { refusal, approved });
        toolCallsExecuted.push({ call: toolCall, result });

        input.onStep?.({ type: "tool_result", payload: result });

        // Tool output is data: clean of secrets and paths, flagged if it tries to give orders, and wrapped so the model reads it as data.
        const cleaned = redact(JSON.stringify(result.data || { error: result.error }));
        if (looksLikeInjection(cleaned)) await audit(skillContext, "prompt_injection_detected", { source: "tool_result", tool: toolCall.name });
        const raw = cleaned;
        // A big listing would crowd out the rest of the conversation; the model can page or narrow instead.
        const toolResultContent = asUntrusted(`tool:${toolCall.name}`, raw.length > MAX_TOOL_RESULT ? `${raw.slice(0, MAX_TOOL_RESULT)}\n[truncated ${raw.length - MAX_TOOL_RESULT} characters; ask for a narrower query or the next page]` : raw);

        // Observation Step: Feed result back into conversation
        messageHistory.push({
          role: "tool",
          content: toolResultContent,
          toolCallId: toolCall.id,
          name: toolCall.name,
        });

        await conversations.addMessage({
          tenantId: input.tenantId,
          conversationId: convId,
          role: "tool",
          content: asUntrusted(`tool:${toolCall.name} (short form)`, redact(storedToolResult(result))),
          toolCallId: toolCall.id,
        });
      }
    }

    if (iterations >= maxIterations && !finalReply) {
      // Give the model one tool-free turn to turn completed work into a useful answer.
      // This prevents the safety budget from surfacing as an opaque failure message.
      messageHistory.push({
        role: "user",
        content: "The action budget for this turn is exhausted. Summarize what was completed, mention any unfinished work, and give the next concrete step. Do not call tools.",
      });
      const boundary = await llmRouter.complete(messageHistory, {
        tenantId: input.tenantId,
        botId: input.botId,
        cacheKey: convId,
        tools: [],
        language: input.context.language,
      });
      finalReply = boundary.finishReason === "error"
        ? failureReply(boundary.content ?? "", toolCallsExecuted, input.context.language)
        : redact(boundary.content || "I completed the available actions. Please continue this task in your next message.");
      await audit(skillContext, "guardrail_denied", { kind: "limit", source: "iterations", synthesized: true });
    }

    return {
      conversationId: convId,
      reply: finalReply,
      toolCallsExecuted,
      iterations,
      imagesRejected,
      historyOffset: windowOffset,
    };
  }
}

export const agentReActLoop = new AgentReActLoop();
