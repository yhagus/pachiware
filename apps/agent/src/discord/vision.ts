import type { PageReader } from "@pachiware/skills";
import { llmRouter } from "../llm/router.js";
import type { ImagePart } from "../llm/types.js";

// What a model that sees images reads for the Workspace (#246): a description of an image someone sent, and the text of scanned PDF pages.

const DESCRIBE = `You describe an image a team member sent, so the team can find it later by searching words. Reply with two short paragraphs and nothing else: the first in Indonesian, the second in English. Say what the image shows and what it is about, and copy exactly any visible text that matters: error messages, titles, labels, numbers, names. Never guess what is not visible.`;
const TRANSCRIBE = `This is one scanned page of a document. Write out every word on it exactly as written, in its own language, keeping line breaks, headings and table rows (as Markdown table rows). Reply with the page's text only, with no comment; reply with nothing when the page holds no text.`;

const png = (bytes: Uint8Array): ImagePart => ({ type: "image", mediaType: "image/png", data: Buffer.from(bytes).toString("base64") });

/** How long one image's description may take, and all the pages of one scanned PDF together: neither may hold a conversation for long. */
export const visionLimits = { describeMs: 45_000, pagesMs: 120_000 };

/** One model call with images, given up at `deadline`; null when it failed, ran out of time, or the Profile refused the images. */
async function seeing(tenantId: string, botId: string | undefined, prompt: string, images: ImagePart[], deadline: number) {
  if (Date.now() >= deadline) return null;
  const answer = await llmRouter.complete([{ role: "system", content: prompt }, { role: "user", content: [{ type: "text", text: "The image:" }, ...images] }], { tenantId, botId, deadline }).catch(() => null);
  return answer && answer.finishReason !== "error" && !answer.imagesRejected ? answer.content?.trim() || null : null;
}

/** What the bot's Profile sees in an image, in Indonesian and English. */
export const describeImage = (tenantId: string, botId: string | undefined, image: ImagePart) => seeing(tenantId, botId, DESCRIBE, [image], Date.now() + visionLimits.describeMs);

/** Reads scanned pages one call each, headed by their page number in the PDF, until the time for the PDF runs out; null when no page gave text. */
export const pageReader = (tenantId: string, botId: string | undefined): PageReader => async (pages) => {
  const read: string[] = [], deadline = Date.now() + visionLimits.pagesMs;
  for (const { page, png: bytes } of pages) {
    const text = await seeing(tenantId, botId, TRANSCRIBE, [png(bytes)], deadline);
    if (text) read.push(`## Page ${page}\n\n${text}`);
  }
  return read.length ? read.join("\n\n") : null;
};
