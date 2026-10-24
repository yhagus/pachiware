// A provider's answer as one JSON value. Every request says stream: false, but some routers stream anyway;
// their server-sent events are assembled into the body the same API returns without streaming, so one reader serves both.
// Events of another API come back as {}, so the reader reports the shape it got instead of an empty reply.
import type { ApiFormat } from "./providers.js";

type Event = { name: string | null; data: any };

const streamed = (raw: string, contentType: string | null) =>
  (contentType ?? "").includes("text/event-stream") || /^\s*(event|data):/.test(raw);

function eventsOf(raw: string): Event[] {
  const events: Event[] = [];
  for (const block of raw.replace(/\r\n?/g, "\n").split(/\n\n+/)) {
    let name: string | null = null;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    const text = data.join("\n");
    if (!text || text === "[DONE]") continue;
    let event: any;
    try { event = JSON.parse(text); } catch { continue; }
    // Some proxies wrap each event as {"event": name, "data": event} instead of sending the name on its own line.
    if (event && typeof event.event === "string" && event.data && typeof event.data === "object" && !("type" in event)) ({ event: name, data: event } = event);
    events.push({ name, data: event });
  }
  return events;
}

function chatCompletion(events: Event[]) {
  let content = "", finishReason: string | null = null, usage: any, seen = false;
  const calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
  for (const { data } of events) {
    usage = data?.usage ?? usage;
    const choice = data?.choices?.[0];
    if (!choice) continue;
    seen = true;
    const delta = choice.delta ?? choice.message ?? {};
    if (typeof delta.content === "string") content += delta.content;
    for (const tc of delta.tool_calls ?? []) {
      const call = (calls[tc.index ?? calls.length] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.function.name ||= tc.function.name;
      if (typeof tc.function?.arguments === "string") call.function.arguments += tc.function.arguments;
    }
    finishReason = choice.finish_reason ?? finishReason;
  }
  if (!seen) return {};
  const toolCalls = calls.filter(Boolean);
  return { choices: [{ message: { role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason }], usage };
}

// The final response event usually carries the whole output; when it does not, the items come from their own done events.
function response(events: Event[]) {
  let final: any = null, text = "";
  const items: any[] = [];
  for (const { data } of events) {
    if (data?.response) final = data.response;
    if (data?.type === "response.output_item.done" && data.item) items.push(data.item);
    if (data?.type === "response.output_text.delta" && typeof data.delta === "string") text += data.delta;
  }
  if (!final && !items.length && !text) return {};
  const output = final?.output?.length ? final.output
    : items.length ? items
    : text ? [{ type: "message", content: [{ type: "output_text", text }] }]
    : [];
  return { ...final, output };
}

function message(events: Event[]) {
  let result: any = { content: [] }, seen = false;
  const json: Record<number, string> = {};
  for (const { data } of events) {
    const block = result.content[data?.index];
    if (data?.type === "message_start" || data?.type === "content_block_start") seen = true;
    switch (data?.type) {
      case "message_start": result = { ...data.message, content: [] }; break;
      case "content_block_start": result.content[data.index] = { ...data.content_block }; break;
      case "content_block_delta":
        if (!block) break;
        if (data.delta?.type === "text_delta") block.text = (block.text ?? "") + data.delta.text;
        else if (data.delta?.type === "input_json_delta") json[data.index] = (json[data.index] ?? "") + data.delta.partial_json;
        break;
      case "content_block_stop":
        if (block?.type === "tool_use" && json[data.index]) {
          try { block.input = JSON.parse(json[data.index]); } catch { block.input = { raw: json[data.index] }; }
        }
        break;
      case "message_delta":
        result.stop_reason = data.delta?.stop_reason ?? result.stop_reason;
        result.usage = { ...result.usage, ...data.usage };
        break;
    }
  }
  if (!seen) return {};
  result.content = result.content.filter(Boolean);
  return result;
}

const ASSEMBLE: Record<ApiFormat, (events: Event[]) => any> = { chat_completions: chatCompletion, responses: response, messages: message };

/** The answer body as JSON, assembled from server-sent events when the server streamed; null when it is neither. */
export function answerOf(format: ApiFormat, raw: string, contentType: string | null): any {
  if (streamed(raw, contentType)) {
    const events = eventsOf(raw);
    return events.length ? ASSEMBLE[format](events) : null;
  }
  try { return JSON.parse(raw); } catch { return null; }
}

/** A Response's answer body; throws when it is neither JSON nor a stream, so the caller's fallback applies. */
export async function readAnswer(format: ApiFormat, response: Response): Promise<any> {
  const data = answerOf(format, await response.text(), response.headers.get("content-type"));
  if (data === null) throw new Error("The provider's answer is neither JSON nor a stream of events.");
  return data;
}
