/**
 * Image fixtures for Discord scenarios: real image bytes behind a stubbed Discord CDN, and a bot profile whose
 * model calls go through the real LLM router to a stubbed provider instead of the scripted model.
 */
import type { Scenario } from "./discordScenario";

// An 8x8 solid PNG; Bun.Image scales it to any size.
const SEED = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mO44GCAFTEMLQkAaplQAWdwh5oAAAAASUVORK5CYII=", "base64");
export const GIF_1PX = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

export const png = (width: number, height: number) => new Bun.Image(SEED).resize(width, height).png().bytes();

let next = 0;
/** A Discord attachment whose CDN download the scenario serves. `bytes: null` leaves the download unstubbed. */
export function attachment(s: Scenario, name: string, bytes: Uint8Array | null, meta: { contentType?: string | null; width?: number; height?: number; size?: number } = {}) {
  const id = `att-${++next}`;
  const url = `https://cdn.discordapp.com/attachments/channel-1/${id}/${name}?ex=1&is=1&hm=1`;
  const contentType = meta.contentType === undefined ? "image/png" : meta.contentType;
  if (bytes) s.http.on(`GET cdn.discordapp.com/attachments/channel-1/${id}/`, () => new Response(bytes as BodyInit, { headers: { "content-type": contentType ?? "application/octet-stream" } }));
  return { id, name, url, proxyURL: url.replace("cdn.discordapp.com", "media.discordapp.net"), contentType, size: meta.size ?? bytes?.length ?? 0, width: meta.width ?? null, height: meta.height ?? null };
}

/** A PNG of this size, attached under `name`. */
export async function image(s: Scenario, name: string, width: number, height: number) {
  return attachment(s, name, await png(width, height), { width, height });
}

/** Attaches a profile to the bot. Model calls then reach the provider over HTTP, unless `scripted` keeps the scripted model. */
export async function useProfile(s: Scenario, profile: { provider: "openai" | "anthropic" | "custom"; model: string; acceptsImages: boolean; baseUrl?: string }, { scripted = false } = {}) {
  const { encryptSecret, repositories } = await import("../../../../packages/db/src/index.ts") as any;
  const { llmRouter } = await import("../../src/llm/router.ts");
  const row = await repositories().profiles.create(s.tenant.id, { name: profile.model, provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl ?? null, apiKeyEncrypted: encryptSecret("profile-key"), acceptsImages: profile.acceptsImages });
  await repositories().bots.update(s.bot.id, { profileId: row.id });
  if (!scripted) delete (llmRouter as any).complete;
}

export const openAIReply = (content: string) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
export const anthropicReply = (text: string) => ({ content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } });
