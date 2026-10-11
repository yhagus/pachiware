import { db, conversations, messages as messagesTable, type Message } from "@pachiware/db";
import { eq, and, sql } from "drizzle-orm";
import { dropLeadingOrphans, historyOffset, HISTORY_SIZE, HISTORY_STEP } from "./history.js";
import { skillRegistry, GuardrailService, audit, redact, asUntrusted, looksLikeInjection, isEnforced, type ToolCall, type ToolResult, type SkillContext, type MemberAuth } from "@pachiware/skills";
import { llmRouter } from "../llm/router.js";
import type { ChatMessage, ImagePart } from "../llm/types.js";
import { SystemPromptBuilder, type PromptContext } from "./prompt.js";

export interface ReActInput {
  tenantId: string;
  botId?: string;
  message: string;
  /** Sent with this turn only; `message` should already name them, since that text is what history keeps. */
  images?: ImagePart[];
  conversationId?: string;
  context: PromptContext & {
    skillContext?: Partial<SkillContext> & { member?: MemberAuth };
  };
  maxIterations?: number;
  onStep?: (step: { type: "thought" | "tool_call" | "tool_result"; payload: any }) => void;
}

export interface ReActOutput {
  conversationId: string;
  reply: string;
  toolCallsExecuted: { call: ToolCall; result: ToolResult }[];
  iterations: number;
  imagesRejected?: boolean;
}

const MAX_TOOL_RESULT = 12000;

export class AgentReActLoop {
  /**
   * Executes the ReAct cycle (Thought -> Action -> Observation -> Answer).
   */
  async run(input: ReActInput): Promise<ReActOutput> {
    const requestedIterations = Number(input.maxIterations) || 12;
    const maxIterations = Math.min(32, Math.max(1, requestedIterations));
    const toolCallsExecuted: { call: ToolCall; result: ToolResult }[] = [];

    // 1. Ensure conversation exists in PostgreSQL
    let convId = input.conversationId;
    if (convId) {
      const [owned] = await db.select().from(conversations).where(and(eq(conversations.id, convId), eq(conversations.tenantId, input.tenantId))).limit(1);
      if (!owned) throw new Error("Conversation not found");
    }
    if (!convId) {
      const [newConv] = await db
        .insert(conversations)
        .values({
          tenantId: input.tenantId,
          botId: input.botId || null,
          platform: input.context.platform,
          channelId: input.context.channelId || null,
          userId: input.context.userId || null,
          metadata: { parentChannelId: input.context.skillContext?.parentChannelId ?? null },
        })
        .returning();
      convId = newConv.id;
    }

    if (!convId) throw new Error("Conversation creation failed");

    // Guardrail before the loop: refuse oversized or rule-rewriting messages and actions no active skill can serve, answer the rest.
    const verdict = GuardrailService.classify(input.message, await skillRegistry.getActiveSkills(input.tenantId));
    // A playbook turn was started on purpose; its brief may be long or mention a skill that is off (git is optional), so it is only logged.
    if (!verdict.decision.allow && isEnforced(verdict.decision.kind) && !input.context.playbook) {
      const auditCtx = { db, tenantId: input.tenantId, botId: input.botId };
      await audit(auditCtx, verdict.decision.kind === "prompt_injection" ? "prompt_injection_detected" : "guardrail_denied", { kind: verdict.decision.kind, source: "user_message", platform: input.context.platform });
      return { conversationId: convId, reply: verdict.decision.message, toolCallsExecuted, iterations: 0 };
    }
    else if (!verdict.decision.allow) await audit({ db, tenantId: input.tenantId, botId: input.botId }, "guardrail_denied", { kind: verdict.decision.kind, source: "user_message", observed: true });

    // 2. Build dynamic system prompt
    const systemPrompt = await SystemPromptBuilder.build({ ...input.context, tenantId: input.tenantId, botId: input.botId });

    // 3. Load previous messages from DB (windowed in steps so the prompt prefix stays cacheable)
    const scope = and(eq(messagesTable.conversationId, convId), eq(messagesTable.tenantId, input.tenantId));
    const [{ n: total }] = await db.select({ n: sql<number>`count(*)` }).from(messagesTable).where(scope);
    const existingDbMessages = dropLeadingOrphans<Message>(await db
      .select()
      .from(messagesTable)
      .where(scope)
      .orderBy(messagesTable.createdAt)
      .offset(historyOffset(Number(total)))
      .limit(HISTORY_SIZE + HISTORY_STEP) as Message[]);

    const messageHistory: ChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];

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

    await db.insert(messagesTable).values({
      tenantId: input.tenantId,
      conversationId: convId,
      role: "user",
      content: input.message,
    });

    // 5. Retrieve active tools
    const activeTools = await skillRegistry.getActiveTools(input.tenantId);

    // 6. Build execution context for tools
    const skillContext: SkillContext = {
      db,
      tenantId: input.tenantId,
      botId: input.botId,
      discord: input.context.skillContext?.discord,
      guildId: input.context.guildId,
      channelId: input.context.channelId,
      guildName: input.context.guildName,
      channelName: input.context.channelName,
      userName: input.context.userName,
      parentChannelId: input.context.skillContext?.parentChannelId,
      userId: input.context.userId,
      metadata: input.context.skillContext?.metadata,
      auth: {
        tenantId: input.tenantId, botId: input.botId, userId: input.context.userId, guildId: input.context.guildId, channelId: input.context.channelId,
        parentChannelId: input.context.skillContext?.parentChannelId,
        roleIds: input.context.skillContext?.member?.roleIds ?? [], permissions: input.context.skillContext?.member?.permissions ?? [],
      },
    };

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
      });

      if (response.imagesRejected) { imagesRejected = true; turn.content = input.message; }

      if (response.content) {
        input.onStep?.({ type: "thought", payload: response.content });
      }

      // Record assistant message
      messageHistory.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      await db.insert(messagesTable).values({
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

      // Action Step: Execute each tool call
      for (const toolCall of response.toolCalls) {
        input.onStep?.({ type: "tool_call", payload: toolCall });

        const result = await skillRegistry.executeTool(toolCall, skillContext);
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

        await db.insert(messagesTable).values({
          tenantId: input.tenantId,
        conversationId: convId,
          role: "tool",
          content: toolResultContent,
          toolCallId: toolCall.id,
        });
      }
    }

    if (iterations >= maxIterations && !finalReply) {
      finalReply = "I completed several actions, but reached the maximum reasoning iterations.";
      await audit(skillContext, "guardrail_denied", { kind: "limit", source: "iterations" });
    }

    return {
      conversationId: convId,
      reply: finalReply,
      toolCallsExecuted,
      iterations,
      imagesRejected,
    };
  }
}

export const agentReActLoop = new AgentReActLoop();
