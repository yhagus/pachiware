/**
 * Every Plane change is a `planeWrite(tool, prepare)`: `prepare` resolves names in the Plane scope and returns a summary and `run`.
 * Only `run` changes Plane; the confirmed run calls `prepare` again, so whatever stopped being valid is refused then.
 */
import type { SkillContext, ToolHandler } from "../types.js";
import { confirmWrite, DANGER_PREFIX, type WriteRequest } from "../writeConfirmation.js";
import type { PlaneTarget } from "./projectRef.js";
import { escapeHtml } from "./markdown.js";
import { PlaneError, type Obj } from "./client.js";

/** Plane refusals a tool can name in plain words: when Plane's answer matches the pattern, the message replaces it. */
export type PlaneRefusals = [RegExp, string][];

/** What a Plane write resolved and will do. `role` names the Plane role it needs, for when Plane refuses the bot's Plane user. */
export interface PlaneChange<T = unknown> { target: PlaneTarget; summary: string; run: () => Promise<T>; refusals?: PlaneRefusals; role?: string }

/** `access: "trusted"` and `ownConfirmation: true` are for danger tools. */
export type PlaneWriteOptions = Pick<WriteRequest, "access" | "ownConfirmation">;

/** What every Plane danger tool passes: only a Trusted member may ask, and only its own Confirm runs it. */
export const DANGER: PlaneWriteOptions = { access: "trusted", ownConfirmation: true };
/** The end of every Plane write tool's description. */
export const CONFIRM_NOTE = " Waits for the asker's Confirm in Discord before anything changes.";
/** The end of every Plane danger tool's description. */
export const DANGER_NOTE = " Only a Trusted member may ask for it, and it waits for its own Confirm in Discord, which a thread grant does not cover.";

export function planeWrite<T>(tool: string, prepare: (args: Obj, ctx: SkillContext) => Promise<PlaneChange<T>>, options: PlaneWriteOptions = {}): ToolHandler {
  return (args, ctx) => confirmWrite(ctx, { tool, args: args ?? {}, ...options }, async () => {
    const { target, summary, run, refusals = [], role } = await prepare(args ?? {}, ctx);
    const prefix = options.access === "trusted" ? DANGER_PREFIX : "";
    return { summary: `${prefix}${summary} [Plane account ${target.access.name}]`, run: () => inPlainWords(target, run(), refusals, role) };
  });
}

/** Plane's answer when the Plane user's role does not allow the request (a bad key reads "Given API token is not valid"). */
const NOT_PERMITTED = /^Plane answered 403: You do not have permission/;

/** Runs a Plane call and rethrows a refusal it knows in plain words, naming the Plane user when its role is the cause. */
export async function inPlainWords<T>(t: PlaneTarget, call: Promise<T>, refusals: PlaneRefusals = [], role?: string): Promise<T> {
  try { return await call; } catch (e) {
    if (!(e instanceof PlaneError)) throw e;
    for (const [pattern, says] of refusals) if (pattern.test(e.message)) throw new Error(says);
    if (NOT_PERMITTED.test(e.message)) throw new Error(`Plane refused this because the bot's Plane user, ${t.access.account.planeUserName}, lacks the role for it${role ? `: it needs to be ${role}` : ""}.`);
    throw e;
  }
}

/** Plane's refusal to delete something the bot's Plane user did not create, without the Admin role, in plain words. */
export function notCreator(t: PlaneTarget, what: string, project: { identifier: string }): string {
  return `Plane refused this: the bot's Plane user, ${t.access.account.planeUserName}, did not create ${what} and is not an Admin of the Plane project ${project.identifier}.`;
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
