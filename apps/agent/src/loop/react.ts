import { repositories } from "@pachiware/db";
import { historyWindow, storedToolResult } from "./history.js";
import { skillRegistry, GuardrailService, audit, redact, asUntrusted, looksLikeInjection, isEnforced, closedTools, availabilityPlace, textIn, bulkTaskTurn, BULK_TASK_TOOLS, type BulkItem, type Language, type Strings, type ToolCall, type ToolDefinition, type ToolResult, type SkillContext, type MemberAuth } from "@pachiware/skills";
import { llmRouter } from "../llm/router.js";
import { botCompletion } from "../llm/completion.js";
import type { ChatMessage, ImagePart } from "../llm/types.js";
import { SystemPromptBuilder, type PromptContext } from "./prompt.js";
import { summaryMessage } from "./summary.js";
import { checkLinks, citationsIn, renderCitations } from "./citations.js";
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

/** The longest a tool call may take before the model is told it did not answer; tests shorten it. */
export const toolTimeout = { ms: 90_000 };

/**
 * When a running tool call gives up; a call that runs nested calls (recall) is moved past each nested call's own ceiling,
 * but never past `cap`, twice the ceiling from its start, so nested calls one after another cannot hold the turn without bound.
 */
type Ceiling = { until: number; cap: number };
const TIMED_OUT = Symbol("timed out");
/** Results of calls that did not answer in time: whether their change happened is unknown. */
const timedOut = new WeakSet<ToolResult>();

/** Runs a tool call within the ceiling; one that has not answered by then gets the timeout error and is audited, and its late result is dropped. */
async function withinCeiling(call: ToolCall, ctx: SkillContext, run: (ceiling: Ceiling) => Promise<ToolResult>): Promise<ToolResult> {
  const ceiling: Ceiling = { until: Date.now() + toolTimeout.ms, cap: Date.now() + 2 * toolTimeout.ms };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    const arm = () => { timer = setTimeout(() => (Date.now() >= ceiling.until ? resolve(TIMED_OUT) : arm()), Math.max(0, ceiling.until - Date.now())); };
    arm();
  });
  try {
    const out = await Promise.race([run(ceiling), expired]);
    if (out !== TIMED_OUT) return out;
  } finally { clearTimeout(timer); }
  await audit(ctx, "guardrail_denied", { kind: "limit", reason: "tool_timeout", tool: call.name });
  const result = { toolCallId: call.id, name: call.name, success: false, error: textIn(ctx.language).toolTimedOut };
  timedOut.add(result);
  return result;
}

/** Runs one tool call, or answers the refusal (a tool closed here, a task write of a bulk waiting for a yes) without running it; an approved bulk's call skips the per-tool write limit. */
function executeCall(call: ToolCall, ctx: SkillContext, o: { refusal?: string; approved: boolean; running: (ceiling?: Ceiling) => void }): Promise<ToolResult> {
  if (o.refusal) return Promise.resolve({ toolCallId: call.id, name: call.name, success: false, error: o.refusal });
  return withinCeiling(call, ctx, (ceiling) => { o.running(ceiling); return skillRegistry.executeTool(call, o.approved ? { ...ctx, bulkApproved: true } : ctx); })
    .finally(() => o.running(undefined));
}

/**
 * A final reply with the refs tools gave rendered as their label and link, unknown refs removed, and any link that appears in no
 * tool result of the turn and no message the model was sent removed too, unless the guardrail mode only observes (ADR 0014).
 */
async function cite(reply: string, executed: Executed[], sent: ChatMessage[], ctx: SkillContext): Promise<string> {
  const results = executed.map(({ result }) => result.data ?? result.error ?? null);
  const rendered = renderCitations(reply, citationsIn(results));
  if (rendered.unknown.length) await audit(ctx, "guardrail_denied", { kind: "citation", reason: "unknown_ref", count: rendered.unknown.length });
  const known = [JSON.stringify(results), ...sent.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))].join("\n");
  const enforced = isEnforced("citation");
  const checked = checkLinks(rendered.text, known, !enforced);
  if (checked.dropped.length) await audit(ctx, "guardrail_denied", { kind: "citation", reason: "link_not_found", count: checked.dropped.length, observed: !enforced });
  return checked.text;
}

const CUT_TOOL_CALL = "This tool call was cut off at the output limit and was not run. Make it smaller, for example by splitting the content over several calls.";
const CONTINUE = "Your last answer was cut off at the output limit. Continue exactly where you stopped, without repeating anything you already wrote.";

/**
 * Asks once for the rest of an answer cut at the output limit and joins the two parts; `stillCut` when the rest is cut too or never came.
 * The continuation request is not stored: only the joined answer is.
 */
async function continueCut(partial: string, sent: ChatMessage[], tools: ToolDefinition[], convId: string, historyEnd: number | undefined, input: ReActInput, ctx: SkillContext) {
  await audit(ctx, "guardrail_denied", { kind: "limit", reason: "output_cut", part: "text" });
  if (!partial.trim()) return { text: partial, stillCut: true };
  const rest = await llmRouter.complete([...sent, { role: "assistant", content: partial }, { role: "user", content: CONTINUE }], {
    tenantId: input.tenantId, botId: input.botId, cacheKey: convId, historyEnd, tools, language: input.context.language,
  });
  if (rest.finishReason === "error") return { text: partial, stillCut: true };
  if (rest.finishReason === "length") await audit(ctx, "guardrail_denied", { kind: "limit", reason: "output_cut", part: "text" });
  return { text: partial + (rest.content ?? ""), stillCut: rest.finishReason === "length" };
}

/** The reply to a provider failure; when changes already landed this turn it names them first, so nobody asks for them twice. */
function failureReply(failure: string, executed: Executed[], language?: Language) {
  const t = textIn(language), said = failure || t.providerFailed;
  const change = ({ call }: Executed) => skillRegistry.effectOf(call.name) !== "read";
  const done = executed.filter((e) => e.result.success && e.result.data?.success !== false && !e.result.data?.pending && change(e)).map((e) => changeLine(e, t));
  const uncertain = executed.filter((e) => timedOut.has(e.result) && change(e)).map((e) => changeLine(e, t));
  return redact([done.length ? t.doneBeforeFailure(done) : "", uncertain.length ? t.uncertainBeforeFailure(uncertain) : "", said].filter(Boolean).join("\n\n"));
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
    const { offset: windowOffset, rows: existingDbMessages } = await historyWindow(input.tenantId, convId);

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
    const historyEnd = existingDbMessages.length ? messageHistory.length - 1 : undefined;

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
      complete: botCompletion(input.tenantId, input.botId, input.context.language),
      metadata: input.context.skillContext?.metadata,
      auth: {
        tenantId: input.tenantId, botId: input.botId, userId: input.context.userId, guildId: input.context.guildId, channelId: input.context.channelId,
        parentChannelId: input.context.skillContext?.parentChannelId,
        roleIds: input.context.skillContext?.member?.roleIds ?? [], permissions: input.context.skillContext?.member?.permissions ?? [],
      },
    };

    const hidden = await skillRegistry.hiddenTools(skillContext);
    const activeTools = available.tools.filter((t) => !closed.has(t.name) && !hidden.has(t.name));
    // A tool that combines others (recall) runs them as the model would here: only the tools offered, each through the registry's checks.
    // Nested calls get the same ceiling, and the call running them is given until theirs has passed, so a hung part is reported as such.
    let running: Ceiling | undefined;
    const setRunning = (ceiling?: Ceiling) => { running = ceiling; };
    skillContext.tools = {
      here: new Set(activeTools.map((t) => t.name)),
      run: (name, args) => {
        if (running) running.until = Math.min(running.cap, Math.max(running.until, Date.now() + toolTimeout.ms * 1.1));
        const call = { id: `${name}-in-turn`, name, arguments: args };
        return withinCeiling(call, skillContext, () => skillRegistry.executeTool(call, skillContext));
      },
    };

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
        historyEnd,
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

      // A response cut at the output limit is unfinished: its text is continued once, and its tool calls are refused below.
      const cut = response.finishReason === "length";
      const final = !response.toolCalls || response.toolCalls.length === 0;
      let answer = response.content, stillCut = false;
      if (cut && final) ({ text: answer, stillCut } = await continueCut(response.content ?? "", messageHistory, activeTools, convId, historyEnd, input, skillContext));

      // The final answer gets its citations rendered and its links checked before it is stored, so later turns read real links.
      const content = final && answer ? await cite(answer, toolCallsExecuted, messageHistory, skillContext) : answer;

      // Record assistant message
      messageHistory.push({
        role: "assistant",
        content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      await conversations.addMessage({
        tenantId: input.tenantId,
        conversationId: convId,
        role: "assistant",
        content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : null,
        tokensUsed: response.usage?.totalTokens || null,
      });

      // If no tool calls, this is the final answer!
      // The cut-off note is the host's, not the model's, so it goes to the person but not into history.
      if (final) {
        finalReply = redact(content || (stillCut ? "" : textIn(input.context.language).emptyAnswer));
        if (stillCut) finalReply = finalReply ? `${finalReply}\n\n${textIn(input.context.language).outputCut}` : textIn(input.context.language).outputCut;
        break;
      }

      // Guardrail on the whole response: too many task writes this turn and none of them run until the user says yes. Cut calls never run, so they never count.
      const bulkDecision = cut ? { allow: true as const, approved: new Set<string>() } : bulk.check(response.toolCalls);
      const bulkRefusal = !bulkDecision.allow && isEnforced(bulkDecision.kind) ? bulkDecision.message : null;
      if (!bulkDecision.allow) {
        await audit(skillContext, bulkRefusal ? "confirmation_requested" : "guardrail_denied", { kind: "bulk_task", count: bulkDecision.batch.length, ...(bulkRefusal ? {} : { observed: true }) });
        if (bulkRefusal && input.context.userId) await patchConversationMetadata(input.tenantId, convId, { bulkApproval: { userId: input.context.userId, items: bulkDecision.batch } });
      }

      // Action Step: Execute each tool call
      for (const toolCall of response.toolCalls) {
        input.onStep?.({ type: "tool_call", payload: toolCall });

        if (cut) await audit(skillContext, "guardrail_denied", { kind: "limit", reason: "output_cut", part: "tool_call", tool: toolCall.name });
        const refusal = cut ? CUT_TOOL_CALL : closed.get(toolCall.name) ?? (bulkRefusal && BULK_TASK_TOOLS.has(toolCall.name) ? bulkRefusal : undefined);
        const approved = bulkDecision.allow && bulkDecision.approved.has(toolCall.id);
        const result = await executeCall(toolCall, skillContext, { refusal, approved, running: setRunning });
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
      // One more call with the same tools and tool_choice none, so the cached prefix holds and completed work becomes a useful answer
      // instead of an opaque failure. The instruction is not stored; the answer is, so the next turn builds on it.
      const request = [...messageHistory, {
        role: "user" as const,
        content: "The action budget for this turn is exhausted. Summarize what was completed, mention any unfinished work, and give the next concrete step. Do not call tools.",
      }];
      const options = { tenantId: input.tenantId, botId: input.botId, cacheKey: convId, historyEnd, language: input.context.language };
      // A server that refuses tool_choice is asked once more without tools by the router, before any fallback Profile.
      const boundary = await llmRouter.complete(request, { ...options, tools: activeTools, toolChoice: "none" });
      if (boundary.finishReason === "error") finalReply = failureReply(boundary.content ?? "", toolCallsExecuted, input.context.language);
      else {
        const content = boundary.content ? await cite(boundary.content, toolCallsExecuted, request, skillContext) : "";
        if (content) await conversations.addMessage({ tenantId: input.tenantId, conversationId: convId, role: "assistant", content, toolCalls: null, tokensUsed: boundary.usage?.totalTokens || null });
        finalReply = redact(content || textIn(input.context.language).budgetSpent);
      }
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
