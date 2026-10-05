import { db, conversations, messages as messagesTable } from "@pachiware/db";
import { eq, desc, and } from "drizzle-orm";
import { skillRegistry, type ToolCall, type ToolResult, type SkillContext } from "@pachiware/skills";
import { llmRouter } from "../llm/router.js";
import type { ChatMessage } from "../llm/types.js";
import { SystemPromptBuilder, type PromptContext } from "./prompt.js";

export interface ReActInput {
  tenantId: string;
  botId?: string;
  message: string;
  conversationId?: string;
  context: PromptContext & {
    skillContext?: Partial<SkillContext>;
  };
  maxIterations?: number;
  onStep?: (step: { type: "thought" | "tool_call" | "tool_result"; payload: any }) => void;
}

export interface ReActOutput {
  conversationId: string;
  reply: string;
  toolCallsExecuted: { call: ToolCall; result: ToolResult }[];
  iterations: number;
}

export class AgentReActLoop {
  /**
   * Executes the ReAct cycle (Thought -> Action -> Observation -> Answer).
   */
  async run(input: ReActInput): Promise<ReActOutput> {
    const requestedIterations = Number(input.maxIterations) || 8;
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
        })
        .returning();
      convId = newConv.id;
    }

    if (!convId) throw new Error("Conversation creation failed");

    // 2. Build dynamic system prompt
    const systemPrompt = await SystemPromptBuilder.build({ ...input.context, tenantId: input.tenantId });

    // 3. Load previous messages from DB
    const existingDbMessages = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.conversationId, convId), eq(messagesTable.tenantId, input.tenantId)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(30);

    const messageHistory: ChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of existingDbMessages.reverse()) {
      messageHistory.push({
        role: msg.role as any,
        content: msg.content,
        toolCalls: (msg.toolCalls as ToolCall[]) || undefined,
        toolCallId: msg.toolCallId || undefined,
      });
    }

    // 4. Append current user message
    messageHistory.push({
      role: "user",
      content: input.message,
    });

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
      userId: input.context.userId,
      metadata: input.context.skillContext?.metadata,
    };

    let iterations = 0;
    let finalReply = "";

    // 7. ReAct execution cycle
    while (iterations < maxIterations) {
      iterations++;

      // LLM Step (Thinking & Tool Decision)
      const response = await llmRouter.complete(messageHistory, {
        tenantId: input.tenantId,
        botId: input.botId,
        tools: activeTools,
      });

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
        finalReply = response.content || "I have processed your request.";
        break;
      }

      // Action Step: Execute each tool call
      for (const toolCall of response.toolCalls) {
        input.onStep?.({ type: "tool_call", payload: toolCall });

        const result = await skillRegistry.executeTool(toolCall, skillContext);
        toolCallsExecuted.push({ call: toolCall, result });

        input.onStep?.({ type: "tool_result", payload: result });

        const toolResultContent = JSON.stringify(result.data || { error: result.error });

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
    }

    return {
      conversationId: convId,
      reply: finalReply,
      toolCallsExecuted,
      iterations,
    };
  }
}

export const agentReActLoop = new AgentReActLoop();
