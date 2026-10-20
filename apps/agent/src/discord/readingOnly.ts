import type { DiscordClientAdapter } from "@pachiware/skills";

/** The adapter calls that change Discord. */
const POSTS = new Set(["sendMessage", "createChannel", "archiveChannel", "setChannelTopic", "pinMessage"]);

/** The bot's Discord adapter with every call that would change Discord refused with `refusal`; reads go through. The Playground and Routines run on it. */
export function readingOnly(adapter: DiscordClientAdapter, refusal: string): DiscordClientAdapter {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && POSTS.has(prop)) return async () => { throw new Error(refusal); };
      if (prop === "forGuild") return (guildId: string) => readingOnly(target.forGuild(guildId), refusal);
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
