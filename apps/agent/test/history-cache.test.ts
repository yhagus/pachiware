import { expect } from "bun:test";
import { discordScenario, type HttpRequest, type Scenario } from "./support/discordScenario";

// Anthropic caches the stored history, and the turn that runs out of actions keeps its tools with tool_choice none and is stored (#219).

const CACHED = { type: "ephemeral" };

/** The bot answers through a Profile of this provider and format; the real router runs and the provider is faked at fetch. */
async function answerWith(s: Scenario, profile: { provider: string; model: string; apiFormat?: string; baseUrl?: string }) {
  const { repositories, encryptSecret } = await import(process.cwd() + "/packages/db/src/index.ts");
  const created = await repositories().profiles.create(s.tenant.id, { name: profile.model, apiKeyEncrypted: encryptSecret("key"), ...profile });
  await repositories().bots.update(s.bot.id, { profileId: created.id });
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.unlimited(s.discord.alice);
  s.model.live();
}

const budget = async (s: Scenario, iterations: number) => {
  const { repositories } = await import(process.cwd() + "/packages/db/src/index.ts");
  await repositories().agentConfig.update(s.tenant.id, { settings: { maxReActIterations: iterations } });
};

/** Anthropic answers from a queue: a string is a text reply, an object a tool call. */
function anthropic(s: Scenario, replies: (string | { tool: string })[]) {
  const sent: any[] = [];
  let id = 0;
  s.http.on("POST api.anthropic.com/v1/messages", (req: HttpRequest) => {
    sent.push(req.body);
    const next = replies.shift() ?? "unscripted";
    return typeof next === "string"
      ? { content: [{ type: "text", text: next }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 2 } }
      : { content: [{ type: "tool_use", id: `toolu_${++id}`, name: next.tool, input: {} }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 2 } };
  });
  return sent;
}

const marked = (blocks: any[]) => blocks.filter((b) => b && typeof b === "object" && "cache_control" in b);

discordScenario("an Anthropic request with stored history marks the last history message, the last tool and the last system block", async (s) => {
  await answerWith(s, { provider: "anthropic", model: "claude-sonnet-5-5" });
  const sent = anthropic(s, ["Release 2.4 moves to 14 October.", "Yes, after the audio fix."]);
  await s.discord.send(`${s.discord.mention} when is release 2.4?`);
  await s.discord.send(`${s.discord.mention} is that final?`);

  const second = sent[1];
  expect(second.tools.at(-1).cache_control).toEqual(CACHED);
  expect(second.system.at(-1).cache_control).toEqual(CACHED);
  // The stored history is the first turn: the person's message and the bot's answer. The answer is its last message.
  expect(second.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Release 2.4 moves to 14 October.", cache_control: CACHED }] });
  // Nothing after the history is marked: the current turn and its per-turn context change every time.
  expect(marked(second.messages.slice(2).flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])))).toEqual([]);
  // Four breakpoints at most.
  expect(marked([...second.tools, ...second.system, ...second.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))])).toHaveLength(3);
});

discordScenario("a first turn with no stored history has no message breakpoint", async (s) => {
  await answerWith(s, { provider: "anthropic", model: "claude-sonnet-5-5" });
  const sent = anthropic(s, ["Hello."]);
  await s.discord.send(`${s.discord.mention} hello`);

  expect(marked(sent[0].messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : [])))).toEqual([]);
});

discordScenario("two consecutive turns within one history step send the same prefix up to the history breakpoint", async (s) => {
  await answerWith(s, { provider: "anthropic", model: "claude-sonnet-5-5" });
  const sent = anthropic(s, ["One.", "Two.", "Three."]);
  await s.discord.send(`${s.discord.mention} first`);
  await s.discord.send(`${s.discord.mention} second`);
  await s.discord.send(`${s.discord.mention} third`);

  const [, second, third] = sent;
  expect(JSON.stringify(third.tools)).toBe(JSON.stringify(second.tools));
  expect(JSON.stringify(third.system)).toBe(JSON.stringify(second.system));
  const breakpoint = second.messages.findIndex((m: any) => Array.isArray(m.content) && marked(m.content).length > 0);
  expect(breakpoint).toBe(1);
  // The mark moves forward to the newest stored message; everything before it is byte for byte the same, and so is its text.
  expect(JSON.stringify(third.messages.slice(0, breakpoint))).toBe(JSON.stringify(second.messages.slice(0, breakpoint)));
  expect(third.messages[breakpoint]).toEqual({ role: "assistant", content: "One." });
  expect(third.messages[3]).toEqual({ role: "assistant", content: [{ type: "text", text: "Two.", cache_control: CACHED }] });
});

discordScenario("on Anthropic the turn that runs out of actions keeps the same tools, sends tool_choice none, and its reply is stored", async (s) => {
  await answerWith(s, { provider: "anthropic", model: "claude-sonnet-5-5" });
  await budget(s, 2);
  const sent = anthropic(s, [{ tool: "listTasks" }, { tool: "listTasks" }, "No tasks are open yet; the next step is to add the first one.", "Sure."]);
  await s.discord.send(`${s.discord.mention} check the tasks twice`);

  const [first, , forced] = sent;
  expect(JSON.stringify(forced.tools)).toBe(JSON.stringify(first.tools));
  expect(forced.tool_choice).toEqual({ type: "none" });
  expect(first.tool_choice).toBeUndefined();
  expect(s.discord.botMessages.at(-1)!.content).toBe("No tasks are open yet; the next step is to add the first one.");

  await s.discord.send(`${s.discord.mention} thanks`);
  // The history ends with the forced reply, not with tool results, and carries the history breakpoint.
  expect(sent[3].messages.at(-2)).toEqual({ role: "assistant", content: [{ type: "text", text: "No tasks are open yet; the next step is to add the first one.", cache_control: CACHED }] });
});

/** A Chat Completions server answering from a queue: a string is a text reply, an object a tool call, a number an error status. */
function chatCompletions(s: Scenario, url: string, replies: (string | number | { tool: string })[]) {
  const sent: any[] = [];
  let id = 0;
  s.http.on(`POST ${url}`, (req: HttpRequest) => {
    sent.push(req.body);
    const next = replies.shift() ?? "unscripted";
    if (typeof next === "number") return Response.json({ error: { message: "tool_choice is not supported" } }, { status: next });
    return typeof next === "string"
      ? { choices: [{ message: { content: next }, finish_reason: "stop" }] }
      : { choices: [{ message: { content: null, tool_calls: [{ id: `call_${++id}`, type: "function", function: { name: next.tool, arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
  });
  return sent;
}

discordScenario("on OpenAI Chat Completions the turn that runs out of actions keeps the same tools and sends tool_choice none", async (s) => {
  await answerWith(s, { provider: "openai", model: "gpt-5" });
  await budget(s, 1);
  const sent = chatCompletions(s, "api.openai.com/v1/chat/completions", [{ tool: "listTasks" }, "Nothing is open yet."]);
  await s.discord.send(`${s.discord.mention} check the tasks`);

  expect(JSON.stringify(sent[1].tools)).toBe(JSON.stringify(sent[0].tools));
  expect(sent[1].tool_choice).toBe("none");
  expect(s.discord.botMessages.at(-1)!.content).toBe("Nothing is open yet.");
});

discordScenario("a custom server that answers 400 to tool_choice none gets one retry without tools", async (s) => {
  await answerWith(s, { provider: "custom", model: "local-llm", baseUrl: "https://llm.example/v1", apiFormat: "chat_completions" });
  await budget(s, 1);
  const sent = chatCompletions(s, "llm.example/v1/chat/completions", [{ tool: "listTasks" }, 400, "Nothing is open yet."]);
  await s.discord.send(`${s.discord.mention} check the tasks`);

  expect(sent).toHaveLength(3);
  expect(sent[1].tool_choice).toBe("none");
  expect(sent[2].tools).toBeUndefined();
  expect(sent[2].tool_choice).toBeUndefined();
  expect(s.discord.botMessages.at(-1)!.content).toBe("Nothing is open yet.");
});

discordScenario("on the Responses format the turn that runs out of actions keeps the same tools and sends tool_choice none", async (s) => {
  await answerWith(s, { provider: "custom", model: "local-llm", baseUrl: "https://llm.example/v1", apiFormat: "responses" });
  await budget(s, 1);
  const sent: any[] = [];
  const replies: any[] = [
    { status: "completed", output: [{ type: "function_call", call_id: "fc_1", name: "listTasks", arguments: "{}" }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Nothing is open yet." }] }] },
  ];
  s.http.on("POST llm.example/v1/responses", (req: HttpRequest) => { sent.push(req.body); return replies.shift(); });
  await s.discord.send(`${s.discord.mention} check the tasks`);

  expect(JSON.stringify(sent[1].tools)).toBe(JSON.stringify(sent[0].tools));
  expect(sent[1].tool_choice).toBe("none");
  expect(s.discord.botMessages.at(-1)!.content).toBe("Nothing is open yet.");
});
