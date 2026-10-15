// The profile Test checklist and Playground: one request at a time against a profile's connection, reported step by step.
// Requests carry the same parameters the router sends, so a passing Test means the bot's own requests are accepted too.
import type { ContentPart } from "./types.js";
import { API_FORMAT_NAMES, API_FORMAT_PATHS, formatHeaders, type ApiFormat } from "./providers.js";
import { anthropicBlocks, openAIContent, responsesContent, DEFAULT_TEMPERATURE } from "./router.js";

export type ProfileConnection = { provider: string; format: ApiFormat; baseUrl: string; key: string | null; model: string };
export type CheckStatus = "ok" | "warning" | "failed" | "skipped";
export type Check = { status: CheckStatus; message: string; reply?: string };
export type ProfileChecks = { url: Check; key: Check; model: Check; text: Check; image: Check };
export type Sent =
  | { ok: true; reply: string; finishReason: string | null; usage: { input: number; output: number } | null; ms: number }
  | { ok: false; status?: number; error: string; ms: number };

// An 8x8 solid red PNG, rgb(208, 64, 48), small enough for every provider's image limits.
const PROBE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mO44GCAFTEMLQkAaplQAWdwh5oAAAAASUVORK5CYII=";
// The probe colour sits between red and orange, so either answer counts as seeing it.
const SAW_RED = /\b(red|orange|scarlet|crimson|vermilion|tomato|merah|oranye)\b/i;
const REFUSED = (status?: number) => status === 401 || status === 403;
const timedOut = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
const reasonOf = (data: any) => (typeof data?.error?.message === "string" ? data.error.message : typeof data?.error === "string" ? data.error : "").slice(0, 200);
const quote = (text: string) => `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
export const modelIds = (data: any): string[] | null => {
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : null;
  return list && list.map((m: any) => (typeof m === "string" ? m : m?.id)).filter((m: unknown): m is string => typeof m === "string" && !!m);
};
// OpenAI-compatible servers return the message as a string, null (nothing said), or an array of text parts.
const chatReply = (message: any): string | null =>
  !message || typeof message !== "object" ? null
  : typeof message.content === "string" ? message.content
  : Array.isArray(message.content) ? message.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("")
  : "";
// Per format: the request body (stream: false, because some routers such as 9router stream unless told not to), and the reply, finish reason, and token counts read back. A reply of null means the answer has another shape.
const WIRE: Record<ApiFormat, {
  body: (model: string, content: string | ContentPart[], system: string | undefined, maxTokens: number) => object;
  read: (data: any) => { reply: string | null; finishReason: string | null; usage: { input: number; output: number } | null };
}> = {
  chat_completions: {
    body: (model, content, system, maxTokens) => ({ model, max_tokens: maxTokens, temperature: DEFAULT_TEMPERATURE, stream: false, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: openAIContent(content) }] }),
    read: (data) => ({ reply: chatReply(data?.choices?.[0]?.message), finishReason: data?.choices?.[0]?.finish_reason ?? null, usage: data?.usage ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 } : null }),
  },
  responses: {
    body: (model, content, system, maxTokens) => ({ model, max_output_tokens: maxTokens, temperature: DEFAULT_TEMPERATURE, store: false, stream: false, input: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: responsesContent(content) }] }),
    read: (data) => ({
      reply: !Array.isArray(data?.output) ? null : data.output.filter((i: any) => i?.type === "message").flatMap((i: any) => i.content ?? []).filter((c: any) => c?.type === "output_text").map((c: any) => c.text).join(""),
      finishReason: data?.incomplete_details?.reason ?? data?.status ?? null,
      usage: data?.usage ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 } : null,
    }),
  },
  messages: {
    body: (model, content, system, maxTokens) => ({ model, max_tokens: maxTokens, stream: false, ...(system ? { system } : {}), messages: [{ role: "user", content: typeof content === "string" ? content : anthropicBlocks(content) }] }),
    read: (data) => ({
      reply: Array.isArray(data?.content) ? data.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("") : null,
      finishReason: data?.stop_reason ?? null,
      usage: data?.usage ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 } : null,
    }),
  },
};
const shapeOf = (data: any): ApiFormat | null =>
  Array.isArray(data?.choices) ? "chat_completions" : Array.isArray(data?.output) ? "responses" : Array.isArray(data?.content) ? "messages" : null;
// Says what came back instead, and which format to pick when the answer has another known shape.
function wrongShape(c: ProfileConnection, res: Response, raw: string, data: any): string {
  const expected = `the answer is not in the ${API_FORMAT_NAMES[c.format]} format`;
  const other = shapeOf(data);
  if (other && other !== c.format) return `${expected}; it looks like ${API_FORMAT_NAMES[other]}${c.provider === "custom" ? ", so pick that API format" : ""}`;
  const type = (res.headers.get("content-type") ?? "no content type").split(";")[0];
  const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${expected}; the server sent ${type}${snippet ? ` starting with ${quote(snippet)}` : " with an empty body"}`;
}

/** One user message, with an optional system prompt, in the connection's request and response shape. */
export async function sendToProfile(c: ProfileConnection, content: string | ContentPart[], opts: { system?: string; maxTokens: number; timeoutMs: number }): Promise<Sent> {
  const wire = WIRE[c.format];
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  let res: Response, raw: string;
  try {
    res = await fetch(`${c.baseUrl}/${API_FORMAT_PATHS[c.format]}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...formatHeaders(c.provider, c.format, c.key) },
      body: JSON.stringify(wire.body(c.model, content, opts.system, opts.maxTokens)), signal: AbortSignal.timeout(opts.timeoutMs),
    });
    raw = await res.text();
  } catch (err) {
    return { ok: false, error: timedOut(err) ? `no answer within ${opts.timeoutMs / 1000} seconds` : "the provider could not be reached", ms: ms() };
  }
  let data: any = null;
  try { data = JSON.parse(raw); } catch {}
  if (!res.ok) {
    const reason = reasonOf(data);
    return { ok: false, status: res.status, error: `${res.status}${reason ? `: ${reason}` : ""}`, ms: ms() };
  }
  const { reply, finishReason, usage } = wire.read(data);
  if (reply === null) return { ok: false, error: wrongShape(c, res, raw, data), ms: ms() };
  return { ok: true, reply: reply.trim(), finishReason, usage, ms: ms() };
}

/** The Test checklist. It stops at the first step that blocks the rest; the model list only informs, because not every server has one. */
export async function checkProfile(c: ProfileConnection): Promise<ProfileChecks> {
  const notTried = (because: string): Check => ({ status: "skipped", message: `Not tried, because ${because}.` });
  const host = (() => { try { return new URL(c.baseUrl).host; } catch { return c.baseUrl; } })();

  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}/models${c.format === "messages" ? "?limit=1000" : ""}`, { headers: formatHeaders(c.provider, c.format, c.key), signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    const skip = notTried("the base URL could not be reached");
    return { url: { status: "failed", message: timedOut(err) ? `${host} did not answer within 10 seconds.` : `Could not reach ${host}. Check the address and that the server is running.` }, key: skip, model: skip, text: skip, image: skip };
  }
  const url: Check = { status: "ok", message: `${host} answered in ${Math.round(performance.now() - started)} ms.` };
  const data: any = await res.json().catch(() => null);

  if (REFUSED(res.status)) {
    const reason = reasonOf(data);
    const skip = notTried("the API key was refused");
    return { url, key: { status: "failed", message: `${c.key ? "Refused" : "No key set, and the provider wants one"} (${res.status}${reason ? `: ${reason}` : ""}).` }, model: skip, text: skip, image: skip };
  }
  const list = res.ok ? modelIds(data) : null;
  let key: Check, model: Check;
  if (list?.length) {
    key = { status: "ok", message: c.key ? "Accepted." : "No key set, and the provider does not need one." };
    model = list.includes(c.model)
      ? { status: "ok", message: `Listed among the provider's ${list.length} models.` }
      : { status: "warning", message: `Not among the provider's ${list.length} models. Check the spelling; the text check tries it anyway.` };
  } else {
    key = model = { status: "skipped", message: `Not checked yet: ${res.ok ? "the base URL returned no model list" : `the model list returned ${res.status}`}.` };
  }

  const text = await sendToProfile(c, "Reply with the single word OK.", { maxTokens: 256, timeoutMs: 30_000 });
  if (!text.ok) {
    if (REFUSED(text.status)) key = { status: "failed", message: `Refused by the text request (${text.status}).` };
    const hint = REFUSED(text.status) ? " Check the API key." : text.status === 404 ? " Check the model name, and that the base URL ends at the API root (often /v1)." : text.status === 400 ? " Check the model name." : "";
    return { url, key, model, text: { status: "failed", message: `Failed (${text.error}).${hint}` }, image: notTried("text failed") };
  }
  if (!text.reply) {
    const truncated = text.finishReason === "length" || text.finishReason === "max_tokens" || text.finishReason === "max_output_tokens";
    return { url, key, model, text: { status: "failed", message: `Empty reply${text.finishReason ? ` (finish reason: ${text.finishReason})` : ""}.${truncated ? " A reasoning model may have spent its tokens thinking." : ""}` }, image: notTried("text came back empty") };
  }
  if (key.status === "skipped") key = { status: "ok", message: c.key ? "Accepted by the text request." : "No key set, and the provider does not need one." };
  if (model.status === "skipped") model = { status: "ok", message: "Answered the text request." };
  const textCheck: Check = /\bok\b/i.test(text.reply)
    ? { status: "ok", message: `Replied as asked in ${text.ms} ms.`, reply: text.reply }
    : { status: "warning", message: `Replied in ${text.ms} ms, but not with the word it was asked for.`, reply: text.reply };

  const parts: ContentPart[] = [{ type: "text", text: "What colour is this image? One word." }, { type: "image", mediaType: "image/png", data: PROBE_PNG }];
  const seen = await sendToProfile(c, parts, { maxTokens: 256, timeoutMs: 30_000 });
  const image: Check = !seen.ok ? { status: "failed", message: `Rejected (${seen.error}).` }
    : !seen.reply ? { status: "failed", message: "Accepted, but the reply was empty." }
    : SAW_RED.test(seen.reply) ? { status: "ok", message: "Named the colour of the test image correctly.", reply: seen.reply }
    : { status: "failed", message: `Answered ${quote(seen.reply)}, but the test image is red. The model may not be seeing images.`, reply: seen.reply };
  return { url, key, model, text: textCheck, image };
}
