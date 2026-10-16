/**
 * The shape of every Plane tool that changes something. A tool declares its handler with `planeWrite(tool, prepare)`:
 * `prepare` resolves the account, the Plane project and every name inside the Plane scope, checks the arguments, and
 * returns a summary and `run`. Only `run` changes Plane. Asking queues the change for the asker's Confirm (Write
 * confirmation); the confirmed run calls `prepare` again, so an asker, a Plane project or a name that is no longer
 * valid is refused then too.
 */
import type { SkillContext, ToolHandler } from "../types.js";
import { confirmWrite, type WriteRequest } from "../writeConfirmation.js";
import type { PlaneTarget } from "./projectRef.js";
import { escapeHtml } from "./markdown.js";

type Obj = Record<string, any>;

/** What a Plane write resolved and will do; `t` names the account in the summary. */
export interface PlaneChange<T = unknown> { t: PlaneTarget; summary: string; run: () => Promise<T> }

/** `access: "trusted"` and `ownConfirmation: true` are for danger tools. */
export type PlaneWriteOptions = Pick<WriteRequest, "access" | "ownConfirmation">;

export function planeWrite<T>(tool: string, prepare: (args: Obj, ctx: SkillContext) => Promise<PlaneChange<T>>, options: PlaneWriteOptions = {}): ToolHandler {
  return (args, ctx) => confirmWrite(ctx, { tool, args: args ?? {}, ...options }, async () => {
    const { t, summary, run } = await prepare(args ?? {}, ctx);
    return { summary: `${summary} [Plane account ${t.access.account.name}]`, run };
  });
}

/**
 * The paragraph that ends a work item or comment the bot writes. Plane shows the bot's Plane user as the author, so it
 * names the Discord asker and channel. The confirmed run carries no display names, so they are looked up in Discord.
 */
export async function originLine(ctx: SkillContext): Promise<string> {
  const { discord, userId, channelId, parentChannelId } = ctx;
  const who = ctx.userName || (discord && userId ? await discord.getMember(userId).catch(() => null) : null)?.displayName || "a Discord member";
  const nameOf = async (id: string | undefined) => (discord && id && userId ? (await discord.channelView(id, userId).catch(() => null))?.channel?.name : null) ?? null;
  const here = await nameOf(channelId);
  const parent = parentChannelId && parentChannelId !== channelId ? await nameOf(parentChannelId) : null;
  const where = parent ? `#${parent} (thread: ${here ?? "unnamed"})` : here ? `#${here}` : null;
  return `<p><em>${escapeHtml(`Sent from Discord by ${who}${where ? ` in ${where}` : ""}`)}</em></p>`;
}

/** The origin line at the end of Plane HTML, when there is one. */
export const ORIGIN_LINE = /<p><em>Sent from Discord by [^<]*<\/em><\/p>\s*$/;
