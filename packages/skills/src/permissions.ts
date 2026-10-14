import type { SkillContext } from "./types.js";

const PERMISSION_NAMES: Record<string, string> = { ViewChannel: "View Channel", ReadMessageHistory: "Read Message History", SendMessages: "Send Messages", SendMessagesInThreads: "Send Messages in Threads", EmbedLinks: "Embed Links", AttachFiles: "Attach Files" };
/** A Discord permission flag as its settings page names it. */
export const permissionName = (flag: string) => PERMISSION_NAMES[flag] ?? flag.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Whether the asker holds any of these Discord permissions; Administrator always passes, no auth never does. */
export const hasPermission = (ctx: Pick<SkillContext, "auth">, ...names: string[]) => !!ctx.auth?.permissions.some((p) => p === "Administrator" || names.includes(p));
