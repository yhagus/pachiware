/** A two-point brief, its round 1, and full drafts for it, shared by the brief scenarios. */
import type { Scenario } from "./discordScenario";

export const POINTS = ["login loops on Safari", "export CSV is slow"];
export const ROUND_1 = {
  points: POINTS,
  drafts: [
    { point: 1, title: "Stop the Safari login loop", summary: "Sessions survive the sign-in redirect on Safari." },
    { point: 2, title: "Stream CSV exports", summary: "Large exports start downloading at once.", blockedBy: [1] },
  ],
  questions: [
    { point: 1, question: "Should Safari 16 be supported?", recommendation: "No, Safari 17 and up." },
    { point: 2, question: "Should exports keep the table's filters?", recommendation: "Yes, export what the table shows." },
  ],
};

export const draft = (n: 1 | 2, extra: Record<string, unknown> = {}) => n === 1
  ? { n: 1, category: "bug", summary: "Signing in on Safari loops back to the sign-in page. Sessions must survive the redirect.", current: "Safari drops the session cookie on the sign-in redirect, so the user lands on sign-in again.", desired: "A user who signs in on Safari 17 or later lands on the page they asked for. An expired session still sends them to sign in once.", acceptance: ["Signing in on Safari 17 lands on the requested page", "An expired session redirects to sign-in exactly once *(added)*", "The fix is covered by a browser test on Safari *(added)*"], outOfScope: ["Safari 16 and older"], ...extra }
  : { n: 2, category: "feature", summary: "Exports stream rows so a large export starts at once.", desired: "An export streams the rows the table shows, filters included, and starts within a second.", acceptance: ["A 100k-row export starts downloading within a second", "The export holds exactly the filtered rows", "An empty table exports a header-only file *(added)*"], outOfScope: ["Scheduled exports"], ...extra };

/** Starts the brief with Draft issues and posts round 1; returns the brief message and its thread. */
export async function startBrief(s: Scenario, round = ROUND_1) {
  s.model.script({ tool: "postBriefRound", args: round }, "ok");
  const brief = await s.discord.send(round.points.map((p) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);
  return { brief, thread: brief.thread!, record: `guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md` };
}

export async function briefFields(s: Scenario, record: string) {
  const { parseFrontmatter } = await import(process.cwd() + "/packages/skills/src/playbooks.ts");
  return parseFrontmatter((await s.workspace.read(record))!)!.fields as Record<string, any>;
}

export const embedsIn = (s: Scenario, threadId: string) => s.discord.botMessages.filter((m) => m.channelId === threadId && m.embeds.length);
