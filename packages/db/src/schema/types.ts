/** Column shapes both dialect schemas store as JSON, declared once so the two schemas cannot drift. */

/** A channel opted in to the daily Digest and the hour (0 to 23, in the guild's zone) it posts at. */
export type DigestChannel = { channelId: string; hour: number };
/** A channel whose talk the bot writes a Daily log of every night; `backfill` asks for the last 30 days to be written when it is turned on. */
export type DailyLogChannel = { channelId: string; backfill: boolean };
