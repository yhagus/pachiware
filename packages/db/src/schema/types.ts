/** Column shapes both dialect schemas store as JSON, declared once so the two schemas cannot drift. */

/** A channel opted in to the daily Digest and the hour (0 to 23, in the guild's zone) it posts at. */
export type DigestChannel = { channelId: string; hour: number };
