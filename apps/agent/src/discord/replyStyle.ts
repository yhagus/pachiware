// The eval reads fillerIn from here, so this file stays free of database imports.
import { textIn, MESSAGE_LIMIT, type Language } from "@pachiware/skills/src/language.js";

/** Replies to `message` without pinging anyone it names; a failed send is dropped. */
export const replyQuietly = (message: { reply(options: { content: string; allowedMentions: { parse: [] } }): Promise<unknown> }) =>
  (content: string) => message.reply({ content, allowedMentions: { parse: [] } }).catch(() => {});
export const MAX_MESSAGES = 3;

/** The model's whole answer when it opts out of a message that does not address the bot. */
export const SILENCE_MARKER = "[[silent]]";
export const reactionMarker = (emoji: string) => `[[react:${emoji}]]`;
const LEADING_MARKER = /^\[\[(silent|react:\s*([^\]]*?)\s*)\]\]/u;
const ANY_MARKER = /\[\[(?:silent|react:[^\]]*)\]\]/gu;
const ONE_EMOJI = /^\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*$/u;

/** Text messages to post, in order, and an optional reaction on the answered message; an empty plan posts nothing. */
export interface ReplyPlan { messages: string[]; reaction?: string }

/**
 * The one step between the agent's reply and Discord: style rules that hold whatever the prompt said.
 * A leading marker decides the plan; an addressed message ignores the silence marker and still gets text.
 */
export function prepareReply(reply: string, { addressed = true, language }: { addressed?: boolean; language?: Language } = {}): ReplyPlan {
  const t = textIn(language);
  const marker = LEADING_MARKER.exec(reply.trim());
  if (marker?.[2] !== undefined) return { messages: [], reaction: ONE_EMOJI.test(marker[2]) ? marker[2] : "👍" };
  if (marker && !addressed) return { messages: [] };
  const text = stripFiller(reply.replace(ANY_MARKER, "").trim());
  const messages = splitReply(text);
  if (!messages.length) return { messages: [marker ? t.nothingToAdd : t.done] };
  if (messages.length <= MAX_MESSAGES) return { messages };
  const cut = splitReply(text, (n) => (n === MAX_MESSAGES - 1 ? MESSAGE_LIMIT - t.cutNote.length - 1 : MESSAGE_LIMIT)).slice(0, MAX_MESSAGES);
  cut[cut.length - 1] += `\n${t.cutNote}`;
  return { messages: cut };
}

/** Lines the plan must carry whatever the cut: they join its last message when they fit, else follow in their own. */
export function withNotes(plan: ReplyPlan, notes: string[]): ReplyPlan {
  if (!notes.length) return plan;
  const text = notes.join("\n"), messages = [...plan.messages], last = messages.length - 1;
  if (last >= 0 && messages[last]!.length + 1 + text.length <= MESSAGE_LIMIT) messages[last] += `\n${text}`;
  else messages.push(...splitReply(text));
  return { ...plan, messages };
}

/** Leads the plan with a ping of `userId`: on its first message when that still fits, else as a message of its own. */
export function withPing(plan: ReplyPlan, userId: string): ReplyPlan {
  const mention = `<@${userId}>`, [first, ...rest] = plan.messages;
  if (first === undefined) return plan;
  return { ...plan, messages: first.length + mention.length + 1 <= MESSAGE_LIMIT ? [`${mention} ${first}`, ...rest] : [mention, first, ...rest] };
}

/**
 * Splits a reply into Discord messages at paragraph breaks, falling back to line breaks.
 * Only a single line longer than a whole message is cut inside, at its last space.
 */
export function splitReply(text: string, limit: number | ((index: number) => number) = MESSAGE_LIMIT): string[] {
  const limitAt = typeof limit === "number" ? () => limit : limit;
  const lines = text.trim().split("\n");
  const out: string[] = [];
  let i = 0, open: string | null = null;
  while (i < lines.length) {
    if (!open) while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) break;
    const max = limitAt(out.length);
    const body: string[] = open ? [open] : [];
    const reopened = body.length;
    let size = open ? open.length : 0, fence: string | null = open, para = -1, paraSize = 0;
    for (; i < lines.length; i++) {
      const next: string | null = FENCE.test(lines[i]) ? (fence ? null : lines[i].trim()) : fence;
      const add = (body.length ? 1 : 0) + lines[i].length;
      if (size + add + (next ? 4 : 0) > max) {
        if (body.length > reopened) break;
        lines.splice(i, 1, ...cutLine(lines[i], max - size - (body.length ? 1 : 0) - 4));
        i--; continue;
      }
      if (!lines[i].trim() && !fence) { para = body.length; paraSize = size; }
      body.push(lines[i]); size += add; fence = next;
    }
    // Prefer the last paragraph break unless it would leave this message less than half full.
    if (i < lines.length && para > reopened && paraSize >= max / 2) { i -= body.length - para; body.length = para; fence = null; }
    while (!fence && body.length && !body.at(-1)!.trim()) body.pop();
    out.push(fence ? `${body.join("\n")}\n${fence.slice(0, 3)}` : body.join("\n"));
    open = fence;
  }
  return out;
}

const FENCE = /^\s*(```|~~~)/;

function cutLine(line: string, room: number): [string, string] {
  room = Math.max(room, 1);
  const space = line.lastIndexOf(" ", room);
  const cut = space > room / 2 ? space : room;
  return [line.slice(0, cut), line.slice(cut).trimStart()];
}

const EMOJI = String.raw`[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}]*`;
const OPENER = new RegExp(String.raw`^(?:great question|good question|excellent question|sure thing|sure|certainly|of course|absolutely|happy to help|pertanyaan (?:yang )?bagus|tentu saja|tentu|baiklah|baik|oke)[!.]+${EMOJI}`, "iu");
const LEAD_IN = /^(?:sure|certainly|of course|okay|ok|baiklah|baik|oke|tentu)[,!.]?\s+(?:here(?:'s| is| are)|berikut(?: ini)?)\b[^\n]*:[ \t]*\n/iu;
const CLOSER = new RegExp(String.raw`(^|[.!?…)\]]\s+|\n\s*)(?:let me know if|let me know whether|(?:i )?hope (?:this|that|it) helps|feel free to (?:ask|reach out|ping)|(?:don't|do not) hesitate to (?:ask|reach out|ping)|is there anything else (?:i can|you need|you'd like)|semoga membantu|semoga bermanfaat|jangan ragu (?:untuk )?(?:bertanya|tanya|menghubungi|hubungi)|(?:kalau|jika) ada pertanyaan lain|ada lagi yang bisa (?:saya|aku) bantu)[^.!?\n]*[.!?…]*${EMOJI}$`, "iu");

/** Removes stock openers and closers (English and Indonesian) from the start and end of a reply. */
export function stripFiller(reply: string): string {
  return strip(reply) || reply.trim();
}

/** The lines of `text` that open or close with listed filler. */
export function fillerIn(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && strip(line) !== line);
}

function strip(reply: string) {
  let text = reply.trim();
  for (let before = ""; before !== text;) {
    before = text;
    text = text.replace(LEAD_IN, "").replace(OPENER, "").replace(CLOSER, "$1").trim();
  }
  return text;
}
