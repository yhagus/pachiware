import { repositories, type Schedule } from "@pachiware/db";
import { configuredLanguage, hhmm, MESSAGE_LIMIT, shownLanguage, textIn, wallClock } from "@pachiware/skills";
import { agentReActLoop } from "../loop/react.js";
import { loadGuildSettings } from "../loop/prompt.js";
import { memberAuth, type DiscordBotManager } from "./client.js";
import { readingOnly } from "./readingOnly.js";
import { prepareReply } from "./replyStyle.js";
import { placeOfChannel, speakerTurn } from "./routing.js";

const NOT_POSTED = "A Routine only reads: nothing is posted but its own report.";
const NOT_CHANGED = "Not run: a Routine only reads, so nothing was changed. Report what you found, and what its owner could do themselves.";
/** How much of the instruction the post's first line repeats. */
const HEAD_TEXT = 200;
/** One run at a time per bot, so many Routines due in one minute wait their turn instead of starting every model turn at once. */
const chains = new Map<string, Promise<void>>();

/** Queues a Routine's run behind the bot's others, as background work `idle()` waits for. The scheduler has already moved the row on. */
export function queueRoutine(manager: DiscordBotManager, row: Schedule, late: boolean) {
  const run = (chains.get(row.botId) ?? Promise.resolve())
    .then(() => runRoutine(manager, row, late))
    .catch((error) => console.error(`[routine] ${row.id} failed: ${error?.message ?? error}`));
  chains.set(row.botId, run);
  void run.finally(() => { if (chains.get(row.botId) === run) chains.delete(row.botId); });
  manager.background(run);
}

/** Ends a Routine that cannot run as its owner any more, keeping why for the console. */
const end = (row: Schedule, error: string) => repositories().schedules.update(row.id, { status: "done", error });

/**
 * One run of a Routine (ADR 0019): its instruction as one turn of its owner, as they are now. Their roles are read again, and an owner who
 * left or can no longer view the channel ends it unrun. The turn only reads and keeps nothing. Its answer is posted with a ping to the owner
 * and the people named; a provider failure tells the owner instead and keeps the error on the row. `late` adds the Reminder's late note.
 */
export async function runRoutine(manager: DiscordBotManager, row: Schedule, late: boolean) {
  const client = manager.clientOf(row.botId), adapter = manager.adapterOf(row.botId, row.guildId ?? undefined);
  if (!client || !adapter || !row.ownerId) return;
  const channel: any = await client.channels.fetch(row.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) { await end(row, "Not run: the channel is gone or cannot be posted in."); return; }
  let member: any = null;
  if (row.guildId) {
    const view = await adapter.channelView(row.channelId, row.ownerId).catch(() => null);
    if (!view?.canView) { await end(row, "Not run: its owner can no longer view the channel."); return; }
    member = await channel.guild?.members?.fetch(row.ownerId).catch(() => null);
  }
  const [agent, guild] = await Promise.all([repositories().agentConfig.get(row.tenantId), row.guildId ? loadGuildSettings(row.tenantId, row.botId, row.guildId) : null]);
  const shown = shownLanguage(row.text), language = shown ?? configuredLanguage(guild, agent), t = textIn(language);
  const place = placeOfChannel(channel), owner = row.ownerName ?? row.ownerId;
  const output = await agentReActLoop.run({
    tenantId: row.tenantId, botId: row.botId, message: speakerTurn(row.guildId, owner, row.text, undefined, row.ownerId), replyLanguage: language,
    maxIterations: agent?.settings?.maxReActIterations, readOnly: NOT_CHANGED, ephemeral: { history: [], cacheKey: `routine:${row.id}` },
    context: {
      tenantId: row.tenantId, platform: "discord", guildId: row.guildId ?? undefined, guildName: channel.guild?.name, channelId: row.channelId, userId: row.ownerId, userName: owner,
      addressed: true, follows: false, timezone: row.timezone, language: configuredLanguage(guild, agent), answerIn: shown, routine: { setBy: owner },
      skillContext: { member: memberAuth(member), discord: readingOnly(adapter, NOT_POSTED), parentChannelId: place.parentChannelId ?? row.channelId, privateThread: place.privateThread },
    },
  });

  const users = [...new Set([row.ownerId, ...row.mentions])], pings = users.map((id) => `<@${id}>`).join(" ");
  const instruction = row.text.length > HEAD_TEXT ? `${row.text.slice(0, HEAD_TEXT)}…` : row.text;
  if (output.failed) {
    await repositories().schedules.update(row.id, { error: "Could not run: the model provider failed." });
    await channel.send({ content: `${pings} ${t.routineFailed(instruction)}`, allowedMentions: { users } });
    return;
  }
  let head = `${pings} ${t.routine(instruction)}`;
  if (late) { const w = wallClock(row.timezone, row.nextAt.getTime()); head += `\n${t.reminderLate(w.day, w.month, hhmm(w.hour, w.minute))}`; }
  const [first = t.nothingToAdd, ...rest] = prepareReply(output.reply, { language }).messages;
  // The pings go with the first message only; the rest of a long report follows without them.
  if (head.length + 1 + first.length <= MESSAGE_LIMIT) await channel.send({ content: `${head}\n${first}`, allowedMentions: { users } });
  else { await channel.send({ content: head, allowedMentions: { users } }); rest.unshift(first); }
  for (const content of rest) await channel.send({ content, allowedMentions: { parse: [] } });
  if (row.error) await repositories().schedules.update(row.id, { error: null });
}
